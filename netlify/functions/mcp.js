// MCPサーバ（決定31・プレミアム限定）。ユーザー自身の ChatGPT/Claude をキマルの相手データに接続する。
// Streamable HTTP のステートレス実装：POST の JSON-RPC を都度処理し、単一 JSON レスポンスを返す
// （SSE ストリームは持たない。GET は 405）。認証はパーソナルトークン（_lib/crypto.js の mcpToken）。
const { json } = require("./_lib/response");
const { parseMcpToken, verifyMcpToken } = require("./_lib/crypto");
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
    description: "相手（これまで会った人＋手動追加）の一覧を返す。名前・メール・面談回数・最終面談日時・トピック。",
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

async function toolListContacts(owner) {
  const bookings = await sb(`bookings?owner_id=${eq(owner.id)}&select=${BOOKING_FIELDS}&order=start_at.desc&limit=200`);
  const manual = await sb(`manual_contacts?owner_id=${eq(owner.id)}&order=created_at.desc&limit=100`).catch(() => []);
  const byKey = new Map();
  for (const b of bookings || []) {
    if (b.status && b.status !== "confirmed") continue;
    const key = (b.visitor_email || b.visitor_name || "").trim().toLowerCase();
    if (!key) continue;
    const entry = byKey.get(key) || { name: b.visitor_name || "", email: b.visitor_email || "", meeting_count: 0, last_meeting_at: null, topics: [] };
    entry.meeting_count += 1;
    if (!entry.last_meeting_at || (b.start_at && b.start_at > entry.last_meeting_at)) entry.last_meeting_at = b.start_at;
    if (b.topic && !entry.topics.includes(b.topic) && entry.topics.length < 3) entry.topics.push(b.topic);
    byKey.set(key, entry);
  }
  for (const m of manual || []) {
    const key = (m.email || m.name || "").trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { name: m.name || "", email: m.email || "", meeting_count: 0, last_meeting_at: null, topics: m.topic ? [m.topic] : [], manual: true });
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
    `2. list_contacts と list_bookings で「${contact}」の面談履歴を確認`,
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
  const header = event.headers.authorization || event.headers.Authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const token = bearer || (event.queryStringParameters && event.queryStringParameters.t) || "";

  // 1) OAuth アクセストークン（コネクタ経由・signBlob 形式）。salt 束縛＝「URLを再発行」で失効。
  const access = verifyAccessToken(token);
  if (access) {
    const owner = await findOwnerById(access.o).catch(() => null);
    if (!owner || owner.cat_key_disabled || (owner.mcp_token_salt || "") !== access.k) {
      return { status: 401, error: "トークンが失効しています。AIクライアントから再接続してください。" };
    }
    if (!isPremium(owner.plan)) return { status: 403, error: "MCP連携はプレミアムプランの機能です。" };
    return { owner };
  }

  // 2) パーソナルトークン（OAuth 非対応クライアント向けの ?t= / Bearer）
  const parsed = parseMcpToken(token);
  if (!parsed) return { status: 401, error: "認証が必要です。コネクタ（OAuth）で接続するか、ai-assist の「自分のAIとつなぐ」で発行した接続URL（?t=）を使ってください。" };
  const owner = await findOwnerById(parsed.ownerId).catch(() => null);
  if (!owner || owner.cat_key_disabled || !verifyMcpToken(owner.id, owner.mcp_token_salt || "", parsed.signature)) {
    return { status: 401, error: "トークンが無効です。接続URLを再発行してください。" };
  }
  if (!isPremium(owner.plan)) return { status: 403, error: "MCP連携はプレミアムプランの機能です。" };
  return { owner };
}

exports.handler = async (event) => {
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
};
