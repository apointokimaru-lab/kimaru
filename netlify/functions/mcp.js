// MCPサーバ（決定31・プレミアム限定）。ユーザー自身の ChatGPT/Claude をキマルの相手データに接続する。
// Streamable HTTP のステートレス実装：POST の JSON-RPC を都度処理し、単一 JSON レスポンスを返す
// （SSE ストリームは持たない。GET は 405）。認証は OAuth アクセストークン（Authorization: Bearer）のみ。
const { json } = require("./_lib/response");
const { sb, eq, findOwnerById } = require("./_lib/supabase");
const { isPremium } = require("./_lib/auth");
const { verifyAccessToken } = require("./_lib/mcp-oauth");
const { appBaseUrl } = require("./_lib/config");

// 新しい順に列挙。クライアントの希望バージョンを知っていればそれを返し、未知なら最新を返す。
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = { name: "kimaru", title: "キマル（日程調整・相手管理）", version: "1.0.0" };
const INSTRUCTIONS = "キマルは1対1の日程調整・面談準備ツールです。ツールでユーザー（ホスト）の予約・相手・事前アンケート回答・プロフィールを読み取れます。面談準備を頼まれたら prepare_meeting プロンプトの手順が参考になります。";

const TOOLS = [
  {
    name: "list_bookings",
    description: "予約の一覧を返す（新しい順）。upcoming=true でこれからの予定のみ（近い順）。ゲストの氏名・メール・トピック・日時・開催方法を含む。",
    inputSchema: {
      type: "object",
      properties: {
        upcoming: { type: "boolean", description: "true でこれからの予定のみ" },
        include_cancelled: { type: "boolean", description: "true でキャンセル済みも含める" },
        limit: { type: "number", description: "最大件数（既定20・上限50）" },
      },
    },
  },
  {
    name: "list_contacts",
    description: "相手（これまで会った人＋手動追加）の一覧を返す。名前・メール・面談回数・最終面談日時・トピックに加え、会話記録（メモ・次の一手・印象スコア）があれば records に含む。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_booking_answers",
    description: "指定した予約の事前アンケート回答（質問と回答）とゲストのメッセージを返す。booking_id は list_bookings で取得。",
    inputSchema: {
      type: "object",
      properties: { booking_id: { type: "string", description: "予約ID" } },
      required: ["booking_id"],
    },
  },
  {
    name: "get_my_profile",
    description: "ユーザー（ホスト）自身のプロフィール（強み・提案スタイル・提供できる価値・大切にしていること・キメたいこと）を返す。",
    inputSchema: { type: "object", properties: {} },
  },
];

const PROMPTS = [
  {
    name: "prepare_meeting",
    description: "面談準備：指定した相手の予約履歴・回答・自分のプロフィールを照合し、次回面談の戦略をまとめる",
    arguments: [{ name: "contact", description: "相手の名前またはメールアドレス", required: true }],
  },
];

// ---- ツール実装（読み取り専用）----

const BOOKING_FIELDS = "id,visitor_name,visitor_email,topic,start_at,end_at,location_type,status,created_at";

async function toolListBookings(owner, args = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  let query = `bookings?owner_id=${eq(owner.id)}&select=${BOOKING_FIELDS}`;
  if (args.upcoming) query += `&start_at=gte.${encodeURIComponent(new Date().toISOString())}&order=start_at.asc`;
  else query += "&order=start_at.desc";
  query += `&limit=${limit}`;
  const rows = await sb(query);
  const bookings = (rows || []).filter((b) => args.include_cancelled || !b.status || b.status === "confirmed");
  return { bookings };
}

// 会話記録（booking_notes）を owner 単位で取得。予約は booking_id、手動相手は manual_contact_id で紐づく。
// manual_contact_id 列が未適用の環境では booking_id のみで取得（graceful degradation）。
async function fetchNotes(owner) {
  const byBooking = {}, byManual = {};
  try {
    let notes;
    try { notes = await sb(`booking_notes?owner_id=${eq(owner.id)}&select=booking_id,manual_contact_id,notes,next_action,keywords,scores`); }
    catch (_) { notes = await sb(`booking_notes?owner_id=${eq(owner.id)}&select=booking_id,notes,next_action,keywords,scores`).catch(() => []); }
    for (const n of notes || []) {
      const rec = { notes: n.notes || "", next_action: n.next_action || "", keywords: n.keywords || "", scores: (n.scores && typeof n.scores === "object") ? n.scores : {} };
      if (n.booking_id) byBooking[n.booking_id] = rec;
      if (n.manual_contact_id) byManual[n.manual_contact_id] = rec;
    }
  } catch (_) { /* 会話記録テーブル未適用: 記録なし扱い */ }
  return { byBooking, byManual };
}
function hasRecord(rec) { return rec && (String(rec.notes).trim() || String(rec.next_action).trim() || Object.keys(rec.scores || {}).length); }

async function toolListContacts(owner) {
  const bookings = await sb(`bookings?owner_id=${eq(owner.id)}&select=${BOOKING_FIELDS}&order=start_at.desc&limit=200`);
  const manual = await sb(`manual_contacts?owner_id=${eq(owner.id)}&order=created_at.desc&limit=100`).catch(() => []);
  const { byBooking, byManual } = await fetchNotes(owner);
  const byKey = new Map();
  for (const b of bookings || []) {
    if (b.status && b.status !== "confirmed") continue;
    const key = (b.visitor_email || b.visitor_name || "").trim().toLowerCase();
    if (!key) continue;
    const entry = byKey.get(key) || { name: b.visitor_name || "", email: b.visitor_email || "", meeting_count: 0, last_meeting_at: null, topics: [], records: [] };
    entry.meeting_count += 1;
    if (!entry.last_meeting_at || (b.start_at && b.start_at > entry.last_meeting_at)) entry.last_meeting_at = b.start_at;
    if (b.topic && !entry.topics.includes(b.topic) && entry.topics.length < 3) entry.topics.push(b.topic);
    const rec = byBooking[b.id];
    if (hasRecord(rec)) entry.records.push({ ...rec, at: b.start_at });
    byKey.set(key, entry);
  }
  for (const m of manual || []) {
    const key = (m.email || m.name || "").trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    const entry = { name: m.name || "", email: m.email || "", meeting_count: 0, last_meeting_at: null, topics: m.topic ? [m.topic] : [], manual: true, records: [] };
    const rec = byManual[m.id];
    if (hasRecord(rec)) entry.records.push(rec);
    byKey.set(key, entry);
  }
  return { contacts: [...byKey.values()] };
}

async function toolGetBookingAnswers(owner, args = {}) {
  const id = String(args.booking_id || "").trim();
  if (!id) throw new Error("booking_id を指定してください");
  const rows = await sb(`bookings?id=${eq(id)}&owner_id=${eq(owner.id)}&select=id,visitor_name,visitor_email,topic,start_at,guest_message&limit=1`);
  const booking = rows && rows[0];
  if (!booking) throw new Error("予約が見つかりません");
  const answers = await sb(`questionnaire_answers?booking_id=${eq(id)}&select=question_text,answer_text`).catch(() => []);
  return { booking, answers: answers || [] };
}

async function toolGetMyProfile(owner) {
  let profile = {};
  try {
    const rows = await sb(`profiles?owner_id=${eq(owner.id)}&limit=1`);
    const row = rows && rows[0];
    if (row) {
      if (row.data && Object.keys(row.data).length) profile = row.data;
      else if (row.bio) { try { profile = JSON.parse(row.bio) || {}; } catch (_) { /* 旧形式は無視 */ } }
    }
  } catch (_) { /* profiles 未作成環境はオーナー基本情報のみ */ }
  return { profile: { profile_name: owner.name || "", profile_email: owner.email || "", ...profile } };
}

const TOOL_HANDLERS = {
  list_bookings: toolListBookings,
  list_contacts: toolListContacts,
  get_booking_answers: toolGetBookingAnswers,
  get_my_profile: toolGetMyProfile,
};

function prepareMeetingPrompt(args = {}) {
  const contact = String(args.contact || "（相手を指定）");
  const text = [
    `キマルのMCPツールを使って、「${contact}」との次回面談の準備をしてください。手順:`,
    "1. get_my_profile で私（ホスト）のプロフィール（強み・スタイル・提供価値・目標）を取得",
    `2. list_contacts と list_bookings で「${contact}」の面談履歴と会話記録（records: メモ・次の一手・印象スコア）を確認`,
    "3. 直近の予約の booking_id で get_booking_answers を呼び、事前アンケート回答とメッセージを取得",
    "その上で、次の4点を日本語で簡潔に提案してください: ①最初の入り方 ②刺さりやすい話題 ③避けた方がいい入り方 ④次の一手（関係を進める具体的アクション）。",
  ].join("\n");
  return { description: `${contact} との面談準備`, messages: [{ role: "user", content: { type: "text", text } }] };
}

// ---- JSON-RPC ----

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolText(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }] };
}

async function handleMessage(message, owner) {
  const isRequest = message && typeof message === "object" && "id" in message;
  const id = isRequest ? message.id : null;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isRequest ? rpcError(id, -32600, "Invalid Request") : null;
  }
  if (message.method.startsWith("notifications/")) return null;

  const params = message.params || {};
  switch (message.method) {
    case "initialize": {
      const requested = String(params.protocolVersion || "");
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const handler = TOOL_HANDLERS[params.name];
      if (!handler) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      try {
        return rpcResult(id, toolText(await handler(owner, params.arguments || {})));
      } catch (error) {
        // ツール実行エラーは JSON-RPC エラーではなく isError 付き結果で返す（MCP仕様）
        return rpcResult(id, { content: [{ type: "text", text: String(error.message || error) }], isError: true });
      }
    }
    case "prompts/list":
      return rpcResult(id, { prompts: PROMPTS });
    case "prompts/get": {
      if (params.name !== "prepare_meeting") return rpcError(id, -32602, `Unknown prompt: ${params.name}`);
      return rpcResult(id, prepareMeetingPrompt(params.arguments));
    }
    default:
      return isRequest ? rpcError(id, -32601, "Method not found") : null;
  }
}

async function authenticate(event) {
  // 認証は OAuth アクセストークン（Authorization: Bearer）のみ。かつての ?t= / パーソナルトークンは
  // URL に資格情報が載って漏洩リスクがあるため廃止（セキュリティ対応）。salt 束縛＝「接続を解除」で失効。
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  const access = verifyAccessToken(token);
  if (!access) {
    return { status: 401, error: "認証が必要です。AIクライアントのコネクタ（OAuth）でキマルに接続してください。" };
  }
  const owner = await findOwnerById(access.o).catch(() => null);
  if (!owner || owner.cat_key_disabled || (owner.mcp_token_salt || "") !== access.k) {
    return { status: 401, error: "トークンが失効しています。AIクライアントから再接続してください。" };
  }
  if (!isPremium(owner.plan)) return { status: 403, error: "MCP連携はプレミアムプランの機能です。" };
  return { owner };
}

// ブラウザ経由のMCPクライアント（claude.ai / ChatGPT 等）向け CORS。プリフライト(OPTIONS)を通し、
// 401 の WWW-Authenticate をブラウザから読めるよう expose する（無いと接続確認がプリフライトで弾かれ「接続できませんでした」になる）。
const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, Accept",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

async function handleRequest(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST のみ対応しています（ステートレスMCP・SSEストリームなし）" }, { Allow: "POST" });
    const auth = await authenticate(event);
    if (auth.error) {
      // 401 には OAuth 発見用の WWW-Authenticate を付ける（MCP クライアントはここから認可フローを開始する）
      const headers = auth.status === 401
        ? { "WWW-Authenticate": `Bearer resource_metadata="${appBaseUrl()}/.well-known/oauth-protected-resource", error="invalid_token"` }
        : {};
      return json(auth.status, { error: auth.error }, headers);
    }

    let body;
    try {
      body = JSON.parse(event.body || "");
    } catch (_) {
      return json(400, rpcError(null, -32700, "Parse error"));
    }
    const messages = Array.isArray(body) ? body : [body];
    const responses = [];
    for (const message of messages) {
      const response = await handleMessage(message, auth.owner);
      if (response) responses.push(response);
    }
    if (!responses.length) return { statusCode: 202, headers: { "Cache-Control": "no-store" }, body: "" };
    return json(200, Array.isArray(body) ? responses : responses[0]);
  } catch (error) {
    return json(500, rpcError(null, -32603, "Internal error"));
  }
}

exports.handler = async (event) => {
  // CORS プリフライトは本体処理・認証なしで即応答。
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ...MCP_CORS, "Cache-Control": "no-store" }, body: "" };
  const res = await handleRequest(event);
  res.headers = { ...(res.headers || {}), ...MCP_CORS }; // 全レスポンスに CORS を付与
  return res;
};
