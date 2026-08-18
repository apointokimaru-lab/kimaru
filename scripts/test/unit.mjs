// 軽量単体テスト（フレームワーク無し・Nodeのみ）。
//   node scripts/test/unit.mjs
// 対象:
//  1) i18n 対称性（ja / en / zh-TW のキー集合が一致）
//  2) ダッシュボード「今日の予定/これから」描画ロジック（app.js から関数を抽出して実行）
//  3) escapeHtml による XSS エスケープ
// 注: app.js / i18n.js は「自リポジトリのソース」を vm.runInContext で評価（外部入力ではない）。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0;
let fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("  ✗ " + name); }
}
function section(name) { console.log("\n# " + name); }

// ---------- 1) i18n 対称性 ----------
section("i18n symmetry (ja / en / zh-TW)");
function loadMessages() {
  const src = fs.readFileSync(path.join(repo, "public/i18n.js"), "utf8");
  const ctx = {
    window: {}, navigator: { language: "ja" }, console,
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      addEventListener() {}, readyState: "complete",
      querySelectorAll: () => [], dispatchEvent() {},
      documentElement: { lang: "" }, body: { dataset: {} }, title: "",
    },
    CustomEvent: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.KimaruI18n.messages;
}
const messages = loadMessages();
const langs = ["ja", "en", "zh-TW"];
const keysets = Object.fromEntries(langs.map((l) => [l, new Set(Object.keys(messages[l] || {}))]));
ok("all three dictionaries present", langs.every((l) => messages[l] && Object.keys(messages[l]).length > 0));
const base = keysets.ja;
for (const l of ["en", "zh-TW"]) {
  const missing = [...base].filter((k) => !keysets[l].has(k));
  const extra = [...keysets[l]].filter((k) => !base.has(k));
  ok(`${l}: no missing keys vs ja` + (missing.length ? ` (missing ${missing.length}: ${missing.slice(0, 6).join(", ")}…)` : ""), missing.length === 0);
  ok(`${l}: no extra keys vs ja` + (extra.length ? ` (extra ${extra.length}: ${extra.slice(0, 6).join(", ")}…)` : ""), extra.length === 0);
}
ok("dashboard empty-state keys exist in all langs",
  langs.every((l) => messages[l]["dash.today.empty"] && messages[l]["dash.upcoming.empty"]));

// ---------- 2) ダッシュボード描画ロジック ----------
section("dashboard schedule rendering (app.js)");
function makeRenderer() {
  const app = fs.readFileSync(path.join(repo, "public/app.js"), "utf8");
  const es = app.indexOf("function escapeHtml(value) {");
  const ee = app.indexOf("}[char]));", es);
  const ds = app.indexOf("const DASH_LOCATION_LABELS");
  const de = app.indexOf("function renderBookings(bookings) {");
  if (es < 0 || ee < 0 || ds < 0 || de < 0) throw new Error("could not locate functions in app.js");
  const escapeHtmlSrc = app.slice(es, ee) + "}[char]));\n}";
  const dashSrc = app.slice(ds, de);
  const store = { "today-list": { innerHTML: "" }, "upcoming-list": { innerHTML: "" } };
  const T = { "dash.today.empty": "今日の予定はありません。", "dash.upcoming.empty": "これからの予約はありません。", "dash.appt.join": "参加する", "admin.guest": "ゲスト" };
  const ctx = {
    console,
    t: (k) => T[k] || k,
    URL,
    location: { origin: "https://example.com" },
    window: { KimaruI18n: { getLanguage: () => "ja" } },
    document: { getElementById: (id) => store[id] || null },
  };
  vm.createContext(ctx);
  vm.runInContext(`${escapeHtmlSrc}\n${dashSrc}`, ctx);
  return {
    ctx, // 同じスライスに含まれる他の純粋関数（sortBookingsFor 等）もテストから使う
    render(bookings) {
      store["today-list"].innerHTML = "";
      store["upcoming-list"].innerHTML = "";
      ctx.renderDashboardSchedule(bookings);
      return { today: store["today-list"].innerHTML, upcoming: store["upcoming-list"].innerHTML };
    },
  };
}
const R = makeRenderer();
const render = (b) => R.render(b);
const now = new Date();
const at = (off, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h, m).toISOString();
const sample = [
  { visitor_name: "本日 太郎", start_at: at(0, 14, 0), end_at: at(0, 14, 30), location_type: "google_meet", meeting_url: "https://meet.google.com/abc", status: "confirmed" },
  { visitor_name: "本日 朝子", start_at: at(0, 9, 0), end_at: at(0, 9, 30), location_type: "in_person", status: "confirmed" },
  { visitor_name: "キャンセル 花子", start_at: at(0, 16, 0), end_at: at(0, 16, 30), status: "cancelled" },
  { visitor_name: "手動 次郎", start_at: null, manual: true },
  { visitor_name: "明日 三郎", start_at: at(1, 11, 0), end_at: at(1, 11, 45), location_type: "zoom", status: "confirmed" },
  { visitor_name: "過去 四郎", start_at: at(-2, 10, 0), end_at: at(-2, 10, 30), status: "confirmed" },
];
const r = render(sample);
const cardCount = (html) => (html.match(/class="appt(?:"| appt-now")/g) || []).length;
ok("today shows both confirmed today bookings", cardCount(r.today) === 2);
ok("today is sorted (朝子 09:00 before 太郎 14:00)", r.today.indexOf("本日 朝子") < r.today.indexOf("本日 太郎"));
ok("today excludes cancelled", !r.today.includes("キャンセル 花子"));
ok("today excludes manual contact", !r.today.includes("手動 次郎"));
ok("today excludes past booking", !r.today.includes("過去 四郎"));
ok("today excludes tomorrow booking", !r.today.includes("明日 三郎"));
ok("join button only when meeting_url present", (r.today.match(/参加する/g) || []).length === 1);
ok("location label rendered (Google Meet)", r.today.includes("Google Meet"));
ok("upcoming shows only future non-today (明日 三郎)", r.upcoming.includes("明日 三郎") && !r.upcoming.includes("本日"));
ok("upcoming excludes past/cancelled/manual", !r.upcoming.includes("過去") && !r.upcoming.includes("キャンセル") && !r.upcoming.includes("手動"));

const empty = render([{ manual: true }, { status: "cancelled", start_at: at(0, 9, 0) }]);
ok("empty today state", empty.today.includes("今日の予定はありません。"));
ok("empty upcoming state", empty.upcoming.includes("これからの予約はありません。"));

const upMany = render(Array.from({ length: 8 }, (_, i) => ({ visitor_name: `未来${i}`, start_at: at(2 + i, 10, 0), end_at: at(2 + i, 10, 30), status: "confirmed" })));
ok("upcoming capped at 5", cardCount(upMany.upcoming) === 5);

// ---------- 3) XSS エスケープ ----------
section("XSS escaping");
const xss = render([{ visitor_name: '<img src=x onerror=alert(1)>', start_at: at(0, 12, 0), end_at: at(0, 12, 30), status: "confirmed" }]);
ok("dangerous name is escaped", xss.today.includes("&lt;img") && !xss.today.includes("<img src=x"));

// ---------- 4) href スキーム許可リスト ----------
section("href scheme allowlist (safeHref)");
const jsUrl = render([{ visitor_name: "悪意", start_at: at(0, 13, 0), end_at: at(0, 13, 30), status: "confirmed", meeting_url: "javascript:alert(1)" }]);
ok("javascript: meeting_url rejected (no join button, no js href)", !jsUrl.today.includes("javascript:") && !jsUrl.today.includes("参加する"));
const okUrl = render([{ visitor_name: "正常", start_at: at(0, 13, 0), end_at: at(0, 13, 30), status: "confirmed", meeting_url: "https://meet.google.com/x" }]);
ok("https: meeting_url allowed (join button present)", okUrl.today.includes("参加する") && okUrl.today.includes("https://meet.google.com/x"));

// ---------- 5) MCPサーバ（netlify/functions/mcp.js・決定31） ----------
// Supabase REST への fetch をインメモリ表でスタブし、JSON-RPC の主要フローを検証する。
section("MCP server (mcp.js)");
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "unit-test-secret";
process.env.SUPABASE_URL = "https://sb.unit.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-key";
process.env.APP_BASE_URL = process.env.APP_BASE_URL || "https://kimaru.unit.test";

const requireCjs = createRequire(import.meta.url);
const OWNER = { id: "11111111-1111-1111-1111-111111111111", name: "テスト オーナー", email: "owner@example.com", plan: "premium", mcp_token_salt: "salt1" };
const FREE_OWNER = { id: "22222222-2222-2222-2222-222222222222", name: "無料", email: "free@example.com", plan: "free" };
const DB = {
  owners: [OWNER, FREE_OWNER],
  bookings: [
    { id: "b1", owner_id: OWNER.id, visitor_name: "相手 一郎", visitor_email: "ichiro@example.com", topic: "初回相談", start_at: "2026-07-20T05:00:00Z", end_at: "2026-07-20T05:30:00Z", location_type: "google_meet", status: "confirmed", created_at: "2026-07-01T00:00:00Z" },
    { id: "b2", owner_id: OWNER.id, visitor_name: "取消 花子", visitor_email: "hanako@example.com", topic: "", start_at: "2026-07-21T05:00:00Z", end_at: "2026-07-21T05:30:00Z", location_type: "zoom", status: "cancelled", created_at: "2026-07-02T00:00:00Z" },
  ],
  questionnaire_answers: [{ booking_id: "b1", question_text: "ご予算感", answer_text: "未定" }],
  manual_contacts: [{ id: "m1", owner_id: OWNER.id, name: "手動 次郎", email: "jiro@example.com", topic: "紹介", created_at: "2026-07-03T00:00:00Z" }],
  profiles: [{ id: "p1", owner_id: OWNER.id, data: { profile_strengths: "課題整理・紹介", profile_style: "logical" } }],
};
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
  let rows = DB[table] || [];
  for (const [k, v] of u.searchParams) {
    if (typeof v === "string" && v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
};

const { sessionCookie } = requireCjs(path.join(repo, "netlify/functions/_lib/crypto.js"));
const { issueTokens } = requireCjs(path.join(repo, "netlify/functions/_lib/mcp-oauth.js"));
const mcp = requireCjs(path.join(repo, "netlify/functions/mcp.js"));
const mcpTokenFn = requireCjs(path.join(repo, "netlify/functions/mcp-token.js"));
const validToken = issueTokens(OWNER).access_token; // OAuth アクセストークンのみ（パーソナルトークンは廃止）
const rpc = async (message, token) => {
  const res = await mcp.handler({ httpMethod: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, queryStringParameters: {}, body: JSON.stringify(message) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

ok("no token → 401", (await rpc(init)).status === 401);
ok("bad token → 401", (await rpc(init, "not-a-valid-token")).status === 401);
ok("free plan → 403", (await rpc(init, issueTokens(FREE_OWNER).access_token)).status === 403);
ok("legacy ?t= query token is rejected (personal token path removed)", (await mcp.handler({ httpMethod: "POST", headers: {}, queryStringParameters: { t: validToken }, body: JSON.stringify(init) })).statusCode === 401);
const initRes = await rpc(init, validToken);
ok("initialize → 200 + protocolVersion + tools capability", initRes.status === 200 && initRes.body.result.protocolVersion === "2025-06-18" && !!initRes.body.result.capabilities.tools);
const toolsRes = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, validToken);
ok("tools/list → 4 read-only tools", toolsRes.body.result.tools.length === 4);
const notifRes = await mcp.handler({ httpMethod: "POST", headers: { authorization: `Bearer ${validToken}` }, queryStringParameters: {}, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
ok("notification → 202 no body", notifRes.statusCode === 202 && !notifRes.body);
const listRes = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_bookings", arguments: {} } }, validToken);
const listData = JSON.parse(listRes.body.result.content[0].text);
ok("list_bookings returns confirmed booking, excludes cancelled", listData.bookings.length === 1 && listData.bookings[0].visitor_name === "相手 一郎");
const contactsRes = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_contacts", arguments: {} } }, validToken);
const contactsData = JSON.parse(contactsRes.body.result.content[0].text);
ok("list_contacts merges bookings + manual", contactsData.contacts.length === 2 && contactsData.contacts.some((c) => c.manual));
const ansRes = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_booking_answers", arguments: { booking_id: "b1" } } }, validToken);
const ansData = JSON.parse(ansRes.body.result.content[0].text);
ok("get_booking_answers returns Q&A", ansData.answers.length === 1 && ansData.answers[0].question_text === "ご予算感");
const noRes = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_booking_answers", arguments: { booking_id: "not-mine" } } }, validToken);
ok("unknown booking → isError result (not a crash)", noRes.status === 200 && noRes.body.result.isError === true);
const profRes = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_my_profile", arguments: {} } }, validToken);
const profData = JSON.parse(profRes.body.result.content[0].text);
ok("get_my_profile merges owner + profiles.data", profData.profile.profile_name === "テスト オーナー" && profData.profile.profile_strengths === "課題整理・紹介");
const promptRes = await rpc({ jsonrpc: "2.0", id: 8, method: "prompts/get", params: { name: "prepare_meeting", arguments: { contact: "相手 一郎" } } }, validToken);
ok("prepare_meeting prompt embeds contact", promptRes.body.result.messages[0].content.text.includes("相手 一郎"));
const badRes = await rpc({ jsonrpc: "2.0", id: 9, method: "no/such" }, validToken);
ok("unknown method → -32601", badRes.body.error && badRes.body.error.code === -32601);

// mcp-token.js: セッションCookieで接続エンドポイントを取得（premium のみ）。トークン付きURLは廃止済み。
const cookie = sessionCookie(OWNER.id).split(";")[0];
const tokenRes = await mcpTokenFn.handler({ httpMethod: "GET", headers: { cookie }, queryStringParameters: {} });
const tokenBody = JSON.parse(tokenRes.body);
ok("mcp-token GET returns connector endpoint, no token URL", tokenRes.statusCode === 200 && tokenBody.endpoint.endsWith("/api/mcp") && !tokenBody.url && !tokenBody.token);
const freeCookie = sessionCookie(FREE_OWNER.id).split(";")[0];
const freeTokenRes = await mcpTokenFn.handler({ httpMethod: "GET", headers: { cookie: freeCookie }, queryStringParameters: {} });
ok("mcp-token for free plan → 403", freeTokenRes.statusCode === 403);

// ---------- 6) MCP OAuth 2.1 フロー（発見→登録→認可→交換→利用→失効） ----------
section("MCP OAuth 2.1 flow");
const nodeCrypto = await import("node:crypto");
const metaFn = requireCjs(path.join(repo, "netlify/functions/oauth-metadata.js"));
const registerFn = requireCjs(path.join(repo, "netlify/functions/mcp-oauth-register.js"));
const authFn = requireCjs(path.join(repo, "netlify/functions/mcp-auth.js"));
const tokenEp = requireCjs(path.join(repo, "netlify/functions/mcp-oauth-token.js"));

const resMeta = await metaFn.handler({ httpMethod: "GET", path: "/.well-known/oauth-protected-resource", queryStringParameters: {} });
const metaBody = JSON.parse(resMeta.body);
ok("protected-resource metadata points to /api/mcp", resMeta.statusCode === 200 && metaBody.resource.endsWith("/api/mcp") && metaBody.authorization_servers.length === 1);
const resServer = await metaFn.handler({ httpMethod: "GET", path: "/.well-known/oauth-authorization-server", queryStringParameters: {} });
const serverBody = JSON.parse(resServer.body);
ok("authorization-server metadata has PKCE S256 + endpoints", serverBody.code_challenge_methods_supported.includes("S256") && serverBody.authorization_endpoint.endsWith("/api/mcp-auth") && serverBody.registration_endpoint.endsWith("/api/mcp-oauth-register"));

const REDIRECT = "https://client.example/callback";
const regRes = await registerFn.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "TestGPT" }) });
const regBody = JSON.parse(regRes.body);
ok("dynamic client registration → 201 + client_id", regRes.statusCode === 201 && !!regBody.client_id && regBody.token_endpoint_auth_method === "none");
const badReg = await registerFn.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ redirect_uris: ["ftp://x"] }) });
ok("registration rejects non-https redirect_uri", badReg.statusCode === 400);

const verifier = "unit-test-verifier-0123456789-0123456789-0123456789";
const challenge = nodeCrypto.createHash("sha256").update(verifier).digest("base64url");
const authQuery = { response_type: "code", client_id: regBody.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "st4te" };

const anonAuth = await authFn.handler({ httpMethod: "GET", headers: {}, queryStringParameters: authQuery });
ok("authorize without session → redirect to login with next", anonAuth.statusCode === 302 && anonAuth.headers.Location.includes("/login.html?next="));
const freeAuth = await authFn.handler({ httpMethod: "GET", headers: { cookie: freeCookie }, queryStringParameters: authQuery });
ok("authorize for free plan → 403 page", freeAuth.statusCode === 403);
const consentRes = await authFn.handler({ httpMethod: "GET", headers: { cookie }, queryStringParameters: authQuery });
// CSRFは Cookie ではなく hidden の署名付きトークン（owner.id 束縛・#252 後の決定31運用）。同意HTMLから抽出する。
ok("authorize (premium) → consent page with client name", consentRes.statusCode === 200 && consentRes.body.includes("TestGPT") && consentRes.body.includes('name="consent_sig"'));
ok("consent CSP form-action allows redirect origin (OAuth 302 back)", String(consentRes.headers["Content-Security-Policy"]).includes("form-action 'self' https://client.example"));
const hiddenVal = (name) => (consentRes.body.match(new RegExp(`name="${name}" value="([^"]*)"`)) || [])[1];
const consentNonce = hiddenVal("consent_nonce");
const consentTs = hiddenVal("consent_ts");
const consentSig = hiddenVal("consent_sig");

const approveBody = new URLSearchParams({ ...authQuery, consent_nonce: consentNonce, consent_ts: consentTs, consent_sig: consentSig, decision: "approve" }).toString();
const approveRes = await authFn.handler({ httpMethod: "POST", headers: { cookie }, body: approveBody });
const approveLoc = approveRes.statusCode === 302 ? new URL(approveRes.headers.Location) : null;
ok("consent approve → 302 to redirect_uri with code + state", !!approveLoc && approveLoc.origin + approveLoc.pathname === REDIRECT && !!approveLoc.searchParams.get("code") && approveLoc.searchParams.get("state") === "st4te");
const noCsrf = await authFn.handler({ httpMethod: "POST", headers: { cookie }, body: new URLSearchParams({ ...authQuery, decision: "approve" }).toString() });
ok("consent POST without CSRF token → 400", noCsrf.statusCode === 400);

const code = approveLoc.searchParams.get("code");
const exchange = async (extra) => {
  const res = await tokenEp.handler({ httpMethod: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: regBody.client_id, redirect_uri: REDIRECT, code_verifier: verifier, ...extra }).toString() });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const badPkce = await exchange({ code_verifier: "wrong-verifier" });
ok("token exchange with wrong PKCE verifier → invalid_grant", badPkce.status === 400 && badPkce.body.error === "invalid_grant");
const granted = await exchange({});
ok("token exchange → access + refresh tokens", granted.status === 200 && !!granted.body.access_token && !!granted.body.refresh_token && granted.body.token_type === "Bearer");

const mcpViaOauth = await rpc(init, granted.body.access_token);
ok("MCP initialize with OAuth access token → 200", mcpViaOauth.status === 200 && mcpViaOauth.body.result.protocolVersion === "2025-06-18");
const rawUnauth = await mcp.handler({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(init) });
ok("401 carries WWW-Authenticate resource_metadata", rawUnauth.statusCode === 401 && String(rawUnauth.headers["WWW-Authenticate"]).includes("oauth-protected-resource"));

const refreshed = await tokenEp.handler({ httpMethod: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: granted.body.refresh_token }).toString() });
ok("refresh grant → new access token", refreshed.statusCode === 200 && !!JSON.parse(refreshed.body).access_token);

// salt 再発行で OAuth 接続も全失効すること
OWNER.mcp_token_salt = "rotated-salt";
const revokedAccess = await rpc(init, granted.body.access_token);
const revokedRefresh = await tokenEp.handler({ httpMethod: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: granted.body.refresh_token }).toString() });
ok("salt rotation revokes OAuth access token", revokedAccess.status === 401);
ok("salt rotation revokes refresh token", revokedRefresh.statusCode === 400);
OWNER.mcp_token_salt = "salt1";

// ---------- 7) Zoom ユーザー個別連携（user-level OAuth） ----------
section("Zoom user-level OAuth");
process.env.ZOOM_CLIENT_ID = "zoom-client-id";
process.env.ZOOM_CLIENT_SECRET = "zoom-client-secret";
const cryptoLib = requireCjs(path.join(repo, "netlify/functions/_lib/crypto.js"));
const zoomLib = requireCjs(path.join(repo, "netlify/functions/_lib/zoom.js"));
const zoomStart = requireCjs(path.join(repo, "netlify/functions/zoom-auth-start.js"));
const zoomCallback = requireCjs(path.join(repo, "netlify/functions/zoom-auth-callback.js"));
const meFn = requireCjs(path.join(repo, "netlify/functions/me.js"));

// fetch スタブを Zoom API 対応に拡張（Supabase 分は既存の DB 表ルックアップへ委譲）
DB.zoom_connections = [];
DB.google_connections = [];
let zoomTokenCalls = 0;
const sbFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === "zoom.us" && u.pathname === "/oauth/token") {
    zoomTokenCalls++;
    return { ok: true, status: 200, json: async () => ({ access_token: "zoom-access", refresh_token: "zoom-refresh", expires_in: 3600 }), text: async () => "" };
  }
  if (u.hostname === "api.zoom.us" && u.pathname === "/v2/users/me") {
    return { ok: true, status: 200, json: async () => ({ email: "host@example.com" }), text: async () => "" };
  }
  if (u.hostname === "api.zoom.us" && u.pathname === "/v2/users/me/meetings") {
    return { ok: true, status: 200, json: async () => ({ id: 123, join_url: "https://zoom.us/j/123" }), text: async () => "" };
  }
  return sbFetch(url, options);
};

const startRes = await zoomStart.handler({ httpMethod: "GET", headers: { cookie }, queryStringParameters: {} });
ok("zoom-auth-start → 302 to zoom.us authorize with state", startRes.statusCode === 302 && startRes.headers.Location.startsWith("https://zoom.us/oauth/authorize?") && startRes.headers.Location.includes("state="));
const startState = new URL(startRes.headers.Location).searchParams.get("state");

const cbRes = await zoomCallback.handler({ httpMethod: "GET", headers: { cookie }, queryStringParameters: { code: "auth-code", state: startState } });
ok("zoom-auth-callback → settings.html?zoom=connected", cbRes.statusCode === 302 && cbRes.headers.Location.includes("zoom=connected"));
const wrongState = await zoomCallback.handler({ httpMethod: "GET", headers: { cookie: freeCookie }, queryStringParameters: { code: "auth-code", state: startState } });
ok("state と本人の不一致 → zoom=state_error", wrongState.headers.Location.includes("zoom=state_error"));

// 有効な接続でホスト本人名義のミーティング発行
DB.zoom_connections = [{ id: "z1", owner_id: OWNER.id, access_token: cryptoLib.encrypt("zoom-access"), refresh_token: cryptoLib.encrypt("zoom-refresh"), expires_at: new Date(Date.now() + 3600000).toISOString() }];
const meeting = await zoomLib.createMeetingFor(OWNER.id, { topic: "面談", startIso: new Date().toISOString(), durationMinutes: 30 });
ok("createMeetingFor returns join_url with valid connection", meeting?.joinUrl === "https://zoom.us/j/123");

// 期限切れ接続はリフレッシュしてから発行
zoomTokenCalls = 0;
DB.zoom_connections = [{ id: "z1", owner_id: OWNER.id, access_token: cryptoLib.encrypt("old-access"), refresh_token: cryptoLib.encrypt("zoom-refresh"), expires_at: new Date(Date.now() - 1000).toISOString() }];
const refreshedMeeting = await zoomLib.createMeetingFor(OWNER.id, { topic: "面談", startIso: new Date().toISOString(), durationMinutes: 30 });
ok("expired connection triggers token refresh then issues", refreshedMeeting?.joinUrl === "https://zoom.us/j/123" && zoomTokenCalls === 1);

const noConn = await zoomLib.createMeetingFor(FREE_OWNER.id, { topic: "x", startIso: new Date().toISOString(), durationMinutes: 30 });
ok("no connection → null (booking proceeds without URL)", noConn === null);

const meRes = await meFn.handler({ httpMethod: "GET", headers: { cookie }, queryStringParameters: {} });
const meBody = JSON.parse(meRes.body);
ok("me returns zoom_connected true with connection", meBody.zoom_connected === true && meBody.calendar_connected === false);

// ---------- 8) Zoom のリスケ更新・キャンセル削除（booking-manage 経由） ----------
section("Zoom reschedule/cancel via booking-manage");
const bookingManage = requireCjs(path.join(repo, "netlify/functions/booking-manage.js"));
ok("meetingIdFromUrl parses join_url", zoomLib.meetingIdFromUrl("https://us05web.zoom.us/j/85511122233?pwd=abc") === "85511122233");
ok("meetingIdFromUrl rejects non-zoom URLs", zoomLib.meetingIdFromUrl("https://meet.google.com/abc-defg-hij") === null && zoomLib.meetingIdFromUrl("") === null);

// Zoom API 呼び出しの記録（PATCH/DELETE /v2/meetings/{id}）
const zoomMeetingCalls = [];
const zoomFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === "api.zoom.us" && u.pathname.startsWith("/v2/meetings/")) {
    zoomMeetingCalls.push({ method: options.method, id: u.pathname.split("/").pop() });
    return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
  }
  return zoomFetch(url, options);
};

const futureStart = new Date(Date.now() + 7 * 86400000);
const futureEnd = new Date(futureStart.getTime() + 30 * 60000);
const ZOOM_BOOKING = { id: "zb1", owner_id: OWNER.id, visitor_name: "相手 一郎", visitor_email: "", location_type: "zoom", status: "confirmed", start_at: futureStart.toISOString(), end_at: futureEnd.toISOString(), meeting_url: "https://us05web.zoom.us/j/85511122233?pwd=abc" };
DB.bookings.push(ZOOM_BOOKING);
DB.availability_settings = [];
DB.booking_pages = [];
const manageToken = cryptoLib.bookingToken("zb1");

const newStart = new Date(Date.now() + 8 * 86400000);
const newEnd = new Date(newStart.getTime() + 30 * 60000);
const resched = await bookingManage.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ id: "zb1", t: manageToken, action: "reschedule", start: newStart.toISOString(), end: newEnd.toISOString() }) });
const reschedBody = JSON.parse(resched.body);
ok("reschedule keeps zoom meeting_url", resched.statusCode === 200 && reschedBody.meeting_url === ZOOM_BOOKING.meeting_url);
ok("reschedule PATCHes zoom meeting time", zoomMeetingCalls.some((c) => c.method === "PATCH" && c.id === "85511122233"));

const cancel = await bookingManage.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ id: "zb1", t: manageToken, action: "cancel" }) });
ok("cancel → 200", cancel.statusCode === 200 && JSON.parse(cancel.body).status === "cancelled");
ok("cancel DELETEs zoom meeting", zoomMeetingCalls.some((c) => c.method === "DELETE" && c.id === "85511122233"));

// ---------- 9) book.js: 予約の location_type は予約ページ設定を採用（Zoom発行の回帰） ----------
section("book.js booking uses page location_type");
const bookFn = requireCjs(path.join(repo, "netlify/functions/book.js"));
DB.booking_pages = [{ id: "bp1", owner_id: OWNER.id, slug: "tarou", title: "初回相談", location_type: "zoom", is_active: true }];
DB.rate_limit_hits = [];
DB.zoom_connections = [{ id: "z1", owner_id: OWNER.id, access_token: cryptoLib.encrypt("zoom-access"), refresh_token: cryptoLib.encrypt("zoom-refresh"), expires_at: new Date(Date.now() + 3600000).toISOString() }];
const captured = { posts: [], patches: [] };
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === "sb.unit.test") {
    const table = u.pathname.replace("/rest/v1/", "");
    if (options.method === "POST") {
      const parsed = JSON.parse(options.body || "null");
      captured.posts.push({ table, body: parsed });
      const rows = Array.isArray(parsed) ? parsed : [{ id: `${table}-new`, ...parsed }];
      return { ok: true, status: 201, text: async () => JSON.stringify(rows) };
    }
    if (options.method === "PATCH") captured.patches.push({ table: table.split("?")[0], body: JSON.parse(options.body || "{}") });
  }
  return prevFetch(url, options);
};
const bookStart = new Date(Date.now() + 5 * 86400000);
const bookEnd = new Date(bookStart.getTime() + 30 * 60000);
const bookRes = await bookFn.handler({
  httpMethod: "POST",
  headers: {},
  body: JSON.stringify({ owner_slug: "tarou", visitor_name: "ゲスト 太郎", visitor_email: "guest@example.com", start: bookStart.toISOString(), end: bookEnd.toISOString() }),
});
const insertedBooking = captured.posts.find((p) => p.table.startsWith("bookings"))?.body;
ok("book → 200", bookRes.statusCode === 200);
ok("booking row uses page's location_type (zoom, not body default)", insertedBooking?.location_type === "zoom");
ok("zoom join_url saved to meeting_url", captured.patches.some((p) => p.table === "bookings" && p.body.meeting_url === "https://zoom.us/j/123"));

// ---------- 9b) #304 事前アンケート回答に質問文を控える ----------
// 予約ページを保存するたび questionnaire_questions は全削除→再作成されるため、
// on delete set null で過去の回答の question_id が抜け、質問文を引けなくなる。
// 回答時点の文言を questionnaire_answers.question_text に控えておく。
section("book.js snapshots question_text into answers (#304)");
{
  DB.questionnaire_questions = [
    { id: "q1", booking_page_id: "bp1", question_text: "ご予算感", sort_order: 1 },
    { id: "q2", booking_page_id: "bp1", question_text: "現在のお悩み", sort_order: 2 },
  ];
  const answersOf = (posts) => posts.find((p) => p.table.startsWith("questionnaire_answers"))?.body || [];
  const bookWith = async (extra) => {
    captured.posts.length = 0;
    const s = new Date(Date.now() + 6 * 86400000);
    const res = await bookFn.handler({
      httpMethod: "POST", headers: {},
      body: JSON.stringify({
        owner_slug: "tarou", visitor_name: "ゲスト 花子", visitor_email: "hanako2@example.com",
        start: s.toISOString(), end: new Date(s.getTime() + 30 * 60000).toISOString(), ...extra,
      }),
    });
    return { res, rows: answersOf(captured.posts) };
  };

  const { res, rows } = await bookWith({
    answers: [
      // question_id があるものは質問マスタの文言を採る（送信値は信用しない）
      { question_id: "q1", question_text: "改ざんされた文言", answer_text: "50万円くらい" },
      // id を持たない既定質問（質問未設定ページ）は送信値を使う
      { question_id: null, question_text: "今回お話したい内容", answer_text: "初回のご相談" },
    ],
  });
  ok("book → 200", res.statusCode === 200);
  ok("回答2件が保存される", rows.length === 2);
  ok("question_id 付きは質問マスタの文言を控える（送信値で上書きされない）",
    rows[0]?.question_text === "ご予算感" && rows[0]?.answer_text === "50万円くらい");
  ok("id なしの既定質問は送信された文言を控える",
    rows[1]?.question_text === "今回お話したい内容" && rows[1]?.question_id === null);

  // 列が未マイグレーションの環境: question_text を落として保存し直す（予約は成立させる）。
  const prevFetch2 = globalThis.fetch;
  const attempts = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === "sb.unit.test" && u.pathname.includes("questionnaire_answers") && options.method === "POST") {
      const body = JSON.parse(options.body || "[]");
      attempts.push(body);
      if (attempts.length === 1) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'column questionnaire_answers.question_text does not exist' }) };
      }
      return { ok: true, status: 201, text: async () => JSON.stringify(body) };
    }
    return prevFetch2(url, options);
  };
  const degraded = await bookWith({ answers: [{ question_id: "q1", question_text: "x", answer_text: "テスト回答" }] });
  globalThis.fetch = prevFetch2;
  ok("列が無くても予約は成立する", degraded.res.statusCode === 200);
  ok("1回目は question_text 付きで試す", attempts[0]?.[0]?.question_text === "ご予算感");
  ok("2回目は question_text を落として再送する",
    attempts.length === 2 && !("question_text" in (attempts[1]?.[0] || { question_text: 1 })) && attempts[1]?.[0]?.answer_text === "テスト回答");
}

// ---------- 9c) #307 未回答の任意項目を落とさない ----------
// 空欄を捨てると、質問そのものが記録から消えて「聞いたのに載っていない」ように見える。
section("unanswered optional questions are kept (#307)");
{
  const answered = { question_id: "q1", question_text: "現在の経営課題はありますか？", answer_text: "経営計画の立案" };
  const blank = { question_id: "q3", question_text: "本日話たい内容はございますでしょうか？", answer_text: "" };

  // (1) 保存: 空欄でも行として残る
  DB.questionnaire_questions = [
    { id: "q1", booking_page_id: "bp1", question_text: "現在の経営課題はありますか？", sort_order: 1 },
    { id: "q3", booking_page_id: "bp1", question_text: "本日話たい内容はございますでしょうか？", sort_order: 3 },
  ];
  captured.posts.length = 0;
  const s307 = new Date(Date.now() + 7 * 86400000);
  const res307 = await bookFn.handler({
    httpMethod: "POST", headers: {},
    body: JSON.stringify({
      owner_slug: "tarou", visitor_name: "ゲスト 三郎", visitor_email: "saburo@example.com",
      start: s307.toISOString(), end: new Date(s307.getTime() + 30 * 60000).toISOString(),
      answers: [answered, blank],
    }),
  });
  const saved = captured.posts.find((p) => p.table.startsWith("questionnaire_answers"))?.body || [];
  ok("book → 200", res307.statusCode === 200);
  ok("未回答の任意項目も行として保存される", saved.length === 2);
  ok("未回答は空文字で保存される（質問文は残る）",
    saved[1]?.answer_text === "" && saved[1]?.question_text === "本日話たい内容はございますでしょうか？");

  // (2) メール本文: 未回答と出す
  const { answersSummary } = requireCjs(path.join(repo, "netlify/functions/_lib/booking-format.js"));
  const summary = answersSummary([answered, blank]);
  ok("メールに未回答の質問も載る", summary.includes("本日話たい内容はございますでしょうか？"));
  ok("未回答は「A. 未回答」と出る", /A\. 未回答/.test(summary));
  ok("回答済みはそのまま出る", summary.includes("A. 経営計画の立案"));

  // (3) 質問も答えも無い行は出さない（旧データの空行対策）
  ok("質問も答えも無い行は載せない", answersSummary([{ question_text: "", answer_text: "" }]) === "");
}

// ---------- 9d) #314 停止中の画面はURL直打ちでも開かせない ----------
// Edge Function（auth-gate）は e2e の静的サーバでは動かないので、ハンドラを直接呼んで確かめる。
section("edge auth-gate blocks disabled pages (#314)");
{
  const gate = (await import(new URL("../../netlify/edge-functions/auth-gate.js", import.meta.url))).default;
  const call = async (path, cookie) => {
    const request = new Request(`https://kimaru-co.jp${path}`, { headers: cookie ? { cookie } : {} });
    // context.next() が呼ばれたら「素通り」＝ブロックしていない。
    let passedThrough = false;
    const context = { next: async () => { passedThrough = true; return new Response("ok", { headers: { "content-type": "text/plain" } }); } };
    const res = await gate(request, context);
    return { status: res.status, location: res.headers.get("location") || "", passedThrough };
  };

  const anon = await call("/pending-questions.html");
  ok("未ログインでも回答待ち画面はダッシュボードへ戻す", anon.status === 302 && anon.location.endsWith("/dashboard.html"));
  ok("ログイン画面へは飛ばさない", !anon.location.includes("login"));
  ok("ページ本体を返さない（素通りしない）", anon.passedThrough === false);

  const loggedIn = await call("/pending-questions.html", `kimaru_session=${sessionCookie(OWNER.id).split(";")[0].split("=")[1]}`);
  ok("ログイン中でも回答待ち画面は開かせない", loggedIn.status === 302 && loggedIn.location.endsWith("/dashboard.html"));

  // 停止対象でないページは従来どおり（未ログインならログインへ、それ以外は素通り）。
  const other = await call("/dashboard.html");
  ok("他の保護ページは従来どおりログイン画面へ", other.status === 302 && other.location.includes("/login.html"));
  const pub = await call("/index.html");
  ok("公開ページは素通りする", pub.passedThrough === true);
}

// ---------- 9e) #303 ピンポイント日程調整リンク ----------
section("pinpoint scheduling link (#303)");
{
  const pin = requireCjs(path.join(repo, "netlify/functions/_lib/pinpoint.js"));
  const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
  const H = 3600000;

  // 候補枠の正規化: 過去・壊れた値・重複を落とし、開始が早い順に並べる。
  const slots = pin.normalizeSlots([
    { start: iso(48 * H), end: iso(48 * H + 1800000) },
    { start: iso(24 * H), end: iso(24 * H + 1800000) },
    { start: iso(24 * H), end: iso(24 * H + 1800000) }, // 重複
    { start: iso(-24 * H), end: iso(-24 * H + 1800000) }, // 過去
    { start: "こわれた値", end: iso(72 * H) },
    { start: iso(72 * H), end: iso(71 * H) }, // 終了が開始より前
  ]);
  ok("過去・重複・壊れた候補を落とす", slots.length === 2);
  ok("開始が早い順に並ぶ", new Date(slots[0].start) < new Date(slots[1].start));
  ok("上限を超えない", pin.normalizeSlots(Array.from({ length: 50 }, (_, i) => ({ start: iso((i + 1) * H), end: iso((i + 1) * H + 1800000) }))).length === pin.MAX_SLOTS);

  // 候補に含まれるかの判定（秒のずれは無視する）。
  const link = { id: "pl1", slots: [{ start: "2026-09-01T05:00:00.000Z", end: "2026-09-01T05:30:00.000Z" }] };
  ok("候補と同じ時刻は通す", pin.includesSlot(link, "2026-09-01T05:00:00.000Z"));
  ok("秒のずれは許容する", pin.includesSlot(link, "2026-09-01T05:00:45.000Z"));
  ok("候補外の時刻は弾く", !pin.includesSlot(link, "2026-09-01T06:00:00.000Z"));

  // 押さえ枠: hold のリンクだけ busy になり、自分自身は除外される。
  const TABLES = { pinpoint_links: [
    { id: "pl-hold", owner_id: OWNER.id, hold_slots: true, is_active: true, slots: [{ start: "2026-09-02T01:00:00.000Z", end: "2026-09-02T01:30:00.000Z" }] },
    { id: "pl-free", owner_id: OWNER.id, hold_slots: false, is_active: true, slots: [{ start: "2026-09-03T01:00:00.000Z", end: "2026-09-03T01:30:00.000Z" }] },
  ] };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.replace("/rest/v1/", "").split("?")[0];
    return { ok: true, status: 200, text: async () => JSON.stringify(TABLES[table] || []) };
  };
  const held = await pin.heldBusyFor(OWNER.id);
  ok("hold のリンクだけ busy になる", held.length === 1 && held[0].start === "2026-09-02T01:00:00.000Z");
  ok("hold でないリンクは押さえない", !held.some((b) => b.start.startsWith("2026-09-03")));
  const heldExcept = await pin.heldBusyFor(OWNER.id, { exceptId: "pl-hold" });
  ok("自分自身の押さえは除外される", heldExcept.length === 0);
  globalThis.fetch = prevFetch;
}

// ---------- 9f) #303 候補外の時刻では予約できない ----------
section("pinpoint booking rejects slots outside candidates (#303)");
{
  const okSlot = new Date(Date.now() + 5 * 86400000);
  okSlot.setUTCMinutes(0, 0, 0);
  const ngSlot = new Date(okSlot.getTime() + 3 * 3600000);
  DB.pinpoint_links = [{
    id: "pl-book", owner_id: OWNER.id, booking_page_id: "bp1", token: "tok-abc", is_active: true, hold_slots: false,
    slots: [{ start: okSlot.toISOString(), end: new Date(okSlot.getTime() + 1800000).toISOString() }],
  }];
  const bookVia = async (start, token) => bookFn.handler({
    httpMethod: "POST", headers: {},
    body: JSON.stringify({
      owner_slug: "tarou", visitor_name: "ピン 太郎", visitor_email: "pin@example.com",
      start: start.toISOString(), end: new Date(start.getTime() + 1800000).toISOString(),
      pinpoint_token: token,
    }),
  });
  const bad = await bookVia(ngSlot, "tok-abc");
  ok("候補外の時刻は400で弾く", bad.statusCode === 400 && JSON.parse(bad.body).error.includes("候補"));
  const unknown = await bookVia(okSlot, "存在しないトークン");
  ok("存在しないトークンは404", unknown.statusCode === 404);
  const good = await bookVia(okSlot, "tok-abc");
  ok("候補内の時刻は予約できる", good.statusCode === 200);
  const noToken = await bookVia(ngSlot, "");
  ok("トークン無しの通常予約は従来どおり通る", noToken.statusCode === 200);
}

// ---------- 9g) #325 押さえ枠をGoogleカレンダー予定にする ----------
section("pinpoint hold events on Google Calendar (#325)");
{
  const pin = requireCjs(path.join(repo, "netlify/functions/_lib/pinpoint.js"));

  // 予定項目名: 前後の空白を落とし、Googleの summary に載る長さで切る。
  ok("予定名の前後の空白を落とす", pin.normalizeHoldTitle("  仮おさえ  ") === "仮おさえ");
  ok("予定名は上限で切る", pin.normalizeHoldTitle("あ".repeat(300)).length === pin.MAX_HOLD_TITLE);
  ok("未入力は空文字になる", pin.normalizeHoldTitle(undefined) === "");

  // 自分の押さえの差し引き。ここが壊れると /p/<token> の候補がゲストに1つも出なくなる。
  const hold = (start, end) => ({ start, end, event_id: "ev1" });
  const range = (start, end) => ({ start, end });
  const at = (h) => `2026-09-10T0${h}:00:00.000Z`;

  // 押さえが busy の真ん中にある＝前後2つに割れる（1回の差し引きで確定させると後ろを取りこぼす）
  const split = pin.subtractHold([range(at(1), at(5))], { hold_events: [hold(at(2), at(3))] });
  ok("押さえが真ん中なら前後2つに割れる", split.length === 2);
  ok("割れた前半は押さえの手前まで", split[0].start === at(1) && split[0].end === at(2));
  ok("割れた後半は押さえの後ろから", split[1].start === at(3) && split[1].end === at(5));

  // 押さえと busy がぴったり同じ＝丸ごと消える（この枠は自分で押さえただけなので空いている）
  ok("押さえと同じ区間は丸ごと消える", pin.subtractHold([range(at(2), at(3))], { hold_events: [hold(at(2), at(3))] }).length === 0);

  // 端に重なる場合
  const headCut = pin.subtractHold([range(at(2), at(5))], { hold_events: [hold(at(1), at(3))] });
  ok("先頭に重なると後ろだけ残る", headCut.length === 1 && headCut[0].start === at(3) && headCut[0].end === at(5));

  // 重ならない押さえは busy を削らない
  const untouched = pin.subtractHold([range(at(1), at(2))], { hold_events: [hold(at(4), at(5))] });
  ok("重ならない押さえは削らない", untouched.length === 1 && untouched[0].start === at(1));

  // 押さえが複数あっても順に削れる（1つ削って終わりにしない）
  const many = pin.subtractHold([range(at(1), at(9))], { hold_events: [hold(at(2), at(3)), hold(at(5), at(6))] });
  ok("押さえが複数でも順に削る", many.length === 3);

  // hold_events 列が未適用の環境（undefined）でも落ちず、busy をそのまま返す
  ok("hold_events が無ければ busy はそのまま", pin.subtractHold([range(at(1), at(2))], {}).length === 1);
  ok("hold_events が壊れていても落ちない", pin.holdEventsOf({ hold_events: [null, { start: at(1) }] }).length === 0);
}

// ---------- 9h) #325 押さえるなら予定名は必須 ----------
section("pinpoint hold requires a calendar event name (#325)");
{
  const createFn = requireCjs(path.join(repo, "netlify/functions/pinpoint-create.js"));
  const future = new Date(Date.now() + 5 * 86400000);
  future.setUTCMinutes(0, 0, 0);
  const slots = [{ start: future.toISOString(), end: new Date(future.getTime() + 1800000).toISOString() }];
  const create = (body) => createFn.handler({
    httpMethod: "POST", headers: { cookie }, body: JSON.stringify({ booking_page_id: "bp1", slots, ...body }),
  });

  const missing = await create({ hold_slots: true });
  ok("押さえるのに予定名が空なら400", missing.statusCode === 400 && JSON.parse(missing.body).error.includes("項目名"));
  const blank = await create({ hold_slots: true, hold_title: "   " });
  ok("空白だけの予定名も400", blank.statusCode === 400);
  // 押さえないなら予定名は要らない（カレンダーに何も作らないので聞く意味がない）
  const noHold = await create({ hold_slots: false });
  ok("押さえないなら予定名なしで通る", noHold.statusCode === 200);
  // Google未連携でも発行は通す。押さえはキマル内部（heldBusyFor）だけに効く。
  const held = await create({ hold_slots: true, hold_title: "仮おさえ" });
  ok("Google未連携でも押さえリンクは発行できる", held.statusCode === 200);
  ok("未連携なので作成した予定は0件", JSON.parse(held.body).hold_events_created === 0);
}

// ---------- 9i) #326 リンクの有効期限 ----------
section("pinpoint link expiry (#326)");
{
  const pin = requireCjs(path.join(repo, "netlify/functions/_lib/pinpoint.js"));
  const NOW = Date.parse("2026-09-01T00:00:00.000Z");
  const DAY = 86400000;

  // 選べるのは3日と1週間の2つだけ。選択肢外は既定に寄せる（集合判定で弾くと画面から直せない）。
  ok("3日を選べる", pin.expiresAtFrom(3, { now: NOW }) === new Date(NOW + 3 * DAY).toISOString());
  ok("1週間を選べる", pin.expiresAtFrom(7, { now: NOW }) === new Date(NOW + 7 * DAY).toISOString());
  ok("選択肢外は既定(1週間)に寄せる", pin.expiresAtFrom(99, { now: NOW }) === new Date(NOW + pin.DEFAULT_EXPIRES_DAYS * DAY).toISOString());
  ok("未指定も既定に寄せる", pin.expiresAtFrom(undefined, { now: NOW }) === new Date(NOW + pin.DEFAULT_EXPIRES_DAYS * DAY).toISOString());

  // 期限判定。列が無い/null は無期限（#326 より前に発行済みのリンクを切らないため）。
  ok("期限前は切れていない", !pin.isExpired({ expires_at: new Date(NOW + DAY).toISOString() }, { now: NOW }));
  ok("期限を過ぎたら切れている", pin.isExpired({ expires_at: new Date(NOW - 1).toISOString() }, { now: NOW }));
  ok("expires_at が null なら無期限", !pin.isExpired({ expires_at: null }, { now: NOW }));
  ok("expires_at 列が無ければ無期限", !pin.isExpired({}, { now: NOW }));

  // 期限は「リンクの有効期限」で候補の日時とは独立。候補が10日後でも期限3日なら切れる。
  const link = { expires_at: new Date(NOW + 3 * DAY).toISOString(), slots: [{ start: new Date(NOW + 10 * DAY).toISOString(), end: new Date(NOW + 10 * DAY + 1800000).toISOString() }] };
  ok("候補が未来でも期限が来ればリンクは切れる", pin.isExpired(link, { now: NOW + 4 * DAY }));

  // 期限切れリンクは押さえを解く（枠を他の予約に開放する）。
  const TABLES = { pinpoint_links: [
    { id: "pl-live", owner_id: OWNER.id, hold_slots: true, is_active: true, expires_at: new Date(Date.now() + DAY).toISOString(), slots: [{ start: "2026-10-02T01:00:00.000Z", end: "2026-10-02T01:30:00.000Z" }] },
    { id: "pl-gone", owner_id: OWNER.id, hold_slots: true, is_active: true, expires_at: new Date(Date.now() - DAY).toISOString(), slots: [{ start: "2026-10-03T01:00:00.000Z", end: "2026-10-03T01:30:00.000Z" }] },
    { id: "pl-forever", owner_id: OWNER.id, hold_slots: true, is_active: true, slots: [{ start: "2026-10-04T01:00:00.000Z", end: "2026-10-04T01:30:00.000Z" }] },
  ] };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.replace("/rest/v1/", "").split("?")[0];
    return { ok: true, status: 200, text: async () => JSON.stringify(TABLES[table] || []) };
  };
  const held = await pin.heldBusyFor(OWNER.id);
  ok("期限内のリンクは押さえたまま", held.some((b) => b.start.startsWith("2026-10-02")));
  ok("期限切れのリンクは押さえを解く", !held.some((b) => b.start.startsWith("2026-10-03")));
  ok("expires_at が無いリンクは押さえたまま", held.some((b) => b.start.startsWith("2026-10-04")));
  globalThis.fetch = prevFetch;
}

// ---------- 9j) #326 期限切れの片付けと、ゲスト側の出し分け ----------
section("pinpoint expiry cleanup and guest response (#326)");
{
  const expireFn = requireCjs(path.join(repo, "netlify/functions/pinpoint-expire.js"));
  const getFn = requireCjs(path.join(repo, "netlify/functions/pinpoint.js"));
  const DAY = 86400000;
  const ev = (id) => ({ start: "2026-10-05T01:00:00.000Z", end: "2026-10-05T01:30:00.000Z", event_id: id });

  DB.pinpoint_links = [
    { id: "px-gone", owner_id: OWNER.id, booking_page_id: "bp1", token: "tok-gone", is_active: true, hold_slots: true, slots: [], expires_at: new Date(Date.now() - DAY).toISOString(), hold_events: [ev("g1")] },
    { id: "px-live", owner_id: OWNER.id, booking_page_id: "bp1", token: "tok-live", is_active: true, hold_slots: true, slots: [], expires_at: new Date(Date.now() + DAY).toISOString(), hold_events: [ev("l1")] },
    { id: "px-done", owner_id: OWNER.id, booking_page_id: "bp1", token: "tok-done", is_active: true, hold_slots: true, slots: [], expires_at: new Date(Date.now() - DAY).toISOString(), hold_events: [] },
  ];

  // dry_run は何も消さず、対象だけを挙げる。
  const dry = await expireFn.run(true);
  ok("期限切れで押さえが残るリンクだけを拾う", dry.checked === 1 && dry.results[0].link_id === "px-gone");
  ok("dry_run は消さない", dry.results[0].status === "dry_run");
  ok("片付け済み(hold_events 空)は拾わない", !dry.results.some((r) => r.link_id === "px-done"));
  ok("期限内のリンクは拾わない", !dry.results.some((r) => r.link_id === "px-live"));

  // ゲスト側: 期限切れは404ではなく expired で返し、切れたことが分かるようにする。
  const expired = await getFn.handler({ httpMethod: "GET", queryStringParameters: { token: "tok-gone" } });
  ok("期限切れは200で expired を返す", expired.statusCode === 200 && JSON.parse(expired.body).expired === true);
  ok("期限切れでは候補を返さない", JSON.parse(expired.body).slots.length === 0);
  const missing = await getFn.handler({ httpMethod: "GET", queryStringParameters: { token: "存在しない" } });
  ok("存在しないトークンは従来どおり404", missing.statusCode === 404);

  // 予約側は期限切れを既定で弾く（findByToken の allowExpired 既定 false）。
  const pin = requireCjs(path.join(repo, "netlify/functions/_lib/pinpoint.js"));
  ok("期限切れは findByToken で引けない", (await pin.findByToken("tok-gone")) === null);
  ok("allowExpired なら引ける", (await pin.findByToken("tok-gone", { allowExpired: true }))?.id === "px-gone");
  ok("期限内は普通に引ける", (await pin.findByToken("tok-live"))?.id === "px-live");
}

// ---------- 9k) #327 リンク一覧と手動の無効化 ----------
section("pinpoint link list and manual disable (#327)");
{
  const listFn = requireCjs(path.join(repo, "netlify/functions/pinpoint-list.js"));
  const offFn = requireCjs(path.join(repo, "netlify/functions/pinpoint-deactivate.js"));
  const DAY = 86400000;
  const slot = (offset) => ({ start: new Date(Date.now() + offset).toISOString(), end: new Date(Date.now() + offset + 1800000).toISOString() });

  DB.pinpoint_links = [
    { id: "pv-live", owner_id: OWNER.id, booking_page_id: "bp1", token: "tk-live", is_active: true, hold_slots: true, hold_title: "仮おさえ", created_at: "2026-08-18T00:00:00Z",
      expires_at: new Date(Date.now() + DAY).toISOString(), slots: [slot(2 * DAY), slot(3 * DAY)], hold_events: [{ start: "x", end: "y", event_id: "e1" }] },
    { id: "pv-old", owner_id: OWNER.id, booking_page_id: "bp1", token: "tk-old", is_active: true, hold_slots: false, created_at: "2026-08-17T00:00:00Z",
      expires_at: new Date(Date.now() - DAY).toISOString(), slots: [slot(5 * DAY)], hold_events: [] },
    { id: "pv-off", owner_id: OWNER.id, booking_page_id: "bp1", token: "tk-off", is_active: false, hold_slots: false, created_at: "2026-08-16T00:00:00Z", slots: [], hold_events: [] },
  ];

  const listed = await listFn.handler({ httpMethod: "GET", headers: { cookie } });
  const links = JSON.parse(listed.body).links;
  ok("一覧は自分のリンクを返す", listed.statusCode === 200 && links.length === 3);
  const byId = Object.fromEntries(links.map((l) => [l.id, l]));
  ok("有効なリンクは active", byId["pv-live"].status === "active");
  ok("期限切れは expired", byId["pv-old"].status === "expired");
  ok("無効化済みは disabled", byId["pv-off"].status === "disabled");
  ok("候補の件数を返す", byId["pv-live"].slot_count === 2);
  ok("候補の最初と最後を返す", byId["pv-live"].first_slot < byId["pv-live"].last_slot);
  ok("押さえの予定名を返す", byId["pv-live"].hold_title === "仮おさえ");
  ok("URLは /p/<token> になる", byId["pv-live"].url.endsWith("/p/tk-live"));
  ok("予約ページ名を添える", byId["pv-live"].page_title === "初回相談");
  // トークンそのものは一覧に出さない（URLがあれば足りる）
  ok("生のトークンは返さない", byId["pv-live"].token === undefined);

  // 無料プランは一覧を見られない（発行と同じプレミアム条件）
  const asFree = await listFn.handler({ httpMethod: "GET", headers: { cookie: freeCookie } });
  ok("無料プランは一覧を見られない", asFree.statusCode === 403);

  // 無効化
  const patches = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "PATCH") { patches.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => "[]" }; }
    return prevFetch(url, init);
  };
  const off = await offFn.handler({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify({ id: "pv-live" }) });
  ok("有効なリンクを無効にできる", off.statusCode === 200 && JSON.parse(off.body).ok === true);
  ok("is_active を false にする", patches.some((p) => p.body.is_active === false));

  // 他人のリンクは止められない（owner_id で必ず絞る）
  const other = await offFn.handler({ httpMethod: "POST", headers: { cookie: freeCookie }, body: JSON.stringify({ id: "pv-live" }) });
  ok("他人のリンクは無効にできない", other.statusCode === 403);

  const missing = await offFn.handler({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify({ id: "存在しないid" }) });
  ok("存在しないリンクは404", missing.statusCode === 404);
  const noId = await offFn.handler({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify({}) });
  ok("id なしは400", noId.statusCode === 400);
  globalThis.fetch = prevFetch;
}

// ---------- 9l) 週表の表示日数（スマホ5日 / PC1週間） ----------
section("availability days per view (5 on mobile / 7 on desktop)");
{
  const availFn = requireCjs(path.join(repo, "netlify/functions/availability.js"));
  const call = async (query) => {
    const res = await availFn.handler({ httpMethod: "GET", queryStringParameters: { slug: "tarou", ...query } });
    return JSON.parse(res.body);
  };
  const start = "2026-09-01";
  ok("既定は5日", (await call({ start })).days === 5);
  ok("7日を指定できる", (await call({ start, days: "7" })).days === 7);
  ok("5日を指定できる", (await call({ start, days: "5" })).days === 5);
  // 許可リスト外は既定に落とす。任意の数を通すと枠生成と freeBusy の窓が際限なく広がる。
  ok("許可外の日数は既定に落とす", (await call({ start, days: "365" })).days === 5);
  ok("負の日数も既定に落とす", (await call({ start, days: "-3" })).days === 5);
  ok("数値でない日数も既定に落とす", (await call({ start, days: "abc" })).days === 5);

  // 7日ぶんの窓が実際に広がっていること（5日目以降の枠が返る）を range で見る。
  const wide = await call({ start, days: "7" });
  const narrow = await call({ start, days: "5" });
  ok("7日のほうが後ろまで枠を返す", (wide.slots || []).length >= (narrow.slots || []).length);
  ok("開始日は日数で変わらない", wide.range_start === narrow.range_start);
}

// ---------- 10) Zoom deauthorize webhook（Marketplace公開要件） ----------
section("Zoom deauthorize webhook");
process.env.ZOOM_WEBHOOK_SECRET_TOKEN = "unit-webhook-secret";
const deauthFn = requireCjs(path.join(repo, "netlify/functions/zoom-deauthorize.js"));
const deletedQueries = [];
const beforeDeauthFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === "sb.unit.test" && options.method === "DELETE") {
    deletedQueries.push(u.pathname.replace("/rest/v1/", "") + u.search);
    return { ok: true, status: 204, text: async () => "" };
  }
  return beforeDeauthFetch(url, options);
};
const signedEvent = (bodyObj, secret = "unit-webhook-secret", tsOffsetMs = 0) => {
  const body = JSON.stringify(bodyObj);
  const ts = String(Math.floor((Date.now() + tsOffsetMs) / 1000));
  const sig = `v0=${nodeCrypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
  return { httpMethod: "POST", headers: { "x-zm-request-timestamp": ts, "x-zm-signature": sig }, body };
};
const validation = await deauthFn.handler(signedEvent({ event: "endpoint.url_validation", payload: { plainToken: "abc123" } }));
const validationBody = JSON.parse(validation.body);
ok("url_validation returns plain + encrypted token", validation.statusCode === 200 && validationBody.plainToken === "abc123" && validationBody.encryptedToken === nodeCrypto.createHmac("sha256", "unit-webhook-secret").update("abc123").digest("hex"));
const badSig = await deauthFn.handler(signedEvent({ event: "app_deauthorized", payload: { user_id: "zu1" } }, "wrong-secret"));
ok("wrong signature → 401", badSig.statusCode === 401);
const staleTs = await deauthFn.handler(signedEvent({ event: "app_deauthorized", payload: { user_id: "zu1" } }, "unit-webhook-secret", -10 * 60000));
ok("stale timestamp → 401 (replay protection)", staleTs.statusCode === 401);
const deauth = await deauthFn.handler(signedEvent({ event: "app_deauthorized", payload: { user_id: "zu1", account_id: "za1" } }));
ok("app_deauthorized → 200 and deletes connection by zoom_user_id", deauth.statusCode === 200 && deletedQueries.some((q) => q.startsWith("zoom_connections") && q.includes("zoom_user_id=eq.zu1")));

// ---------- 11) availability-core（5日窓・バッファ・リードタイム・月の空き日） ----------
section("availability-core (5-day window / buffer / lead time)");
const availCore = requireCjs("../../netlify/functions/_lib/availability-core");
{
  const DAY = availCore.DAY_MS;
  const weekly = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: "10:00", end_time: "18:00" }));
  // 未来の7日窓（必ず平日5日を含む・リードタイムの影響も無い）で枠生成:
  // 所要50＋後バッファ30 → 間隔80分 → 平日1日あたり6枠(10:00,11:20,12:40,14:00,15:20,16:40)。
  const from = availCore.tokyoStartOfDayMs(Date.now() + 30 * DAY);
  const page = { duration_minutes: 50, buffer_before_minutes: 0, buffer_after_minutes: 30, booking_range_months: 3 };
  const slots = availCore.generateSlots(weekly, page, from, from + 7 * DAY);
  ok("generateSlots: 7日窓で平日5日×6枠=30", slots.length === 30);
  ok("generateSlots: 枠間隔=80分(所要50+後30)", (new Date(slots[1].start) - new Date(slots[0].start)) === 80 * 60000);

  // overlaps: 候補枠を前後バッファぶん広げて既存予定と突き合わせる（前バッファ=開始前／後バッファ=終了後）。
  const p0 = availCore.tokyoParts(new Date(from));
  const iso = (h, m) => availCore.tokyoLocalDateToUtc(p0.year, p0.month, p0.date, h * 60 + m).toISOString();
  const cand = { start: iso(12, 0), end: iso(12, 50) };        // 候補: 12:00-12:50
  const before = [{ start: iso(11, 0), end: iso(11, 50) }];    // 直前の予定: 11:00-11:50（10分前に終了）
  const after = [{ start: iso(13, 0), end: iso(13, 50) }];     // 直後の予定: 13:00-13:50（10分後に開始）
  // 前バッファ30 → 開始前(11:30-12:00)が直前予定(〜11:50)と重なる → ブロック。後バッファは開始側に効かない。
  ok("overlaps: 前バッファ30で予定直後(30分以内)の開始枠をブロック", availCore.overlaps(cand, before, 30 * 60000, 0) === true);
  ok("overlaps: 後バッファは予定“後”の開始枠を塞がない（前バッファの役割）", availCore.overlaps(cand, before, 0, 30 * 60000) === false);
  // 後バッファ30 → 終了後(12:50-13:20)が直後予定(13:00〜)と重なる → ブロック。前バッファは終了側に効かない。
  ok("overlaps: 後バッファ30で予定直前(30分以内)の終了枠をブロック", availCore.overlaps(cand, after, 0, 30 * 60000) === true);
  ok("overlaps: 前バッファは予定“前”の終了枠を塞がない（後バッファの役割）", availCore.overlaps(cand, after, 30 * 60000, 0) === false);
  ok("overlaps: バッファ0なら重ならない枠はブロックしない", availCore.overlaps(cand, before, 0, 0) === false);

  // シナリオ: 前30/後30/打合せ60/表示30分、空きが14:00-17:00 → 14:30・15:00・15:30 の3枠だけ可
  // （前後バッファ＋打合せのトータルが空きに収まる枠のみ。14:00は前バッファ、16:00以降は後バッファで不可）。
  {
    const dayWeekly = [p0.day].map((d) => ({ day_of_week: d, start_time: "10:00", end_time: "18:00" }));
    const spage = { duration_minutes: 60, buffer_before_minutes: 30, buffer_after_minutes: 30, slot_interval_minutes: 30 };
    const dayStart = availCore.tokyoLocalDateToUtc(p0.year, p0.month, p0.date, 0).getTime();
    const daySlots = availCore.generateSlots(dayWeekly, spage, dayStart, dayStart + DAY);
    const sceneBusy = [{ start: iso(10, 0), end: iso(14, 0) }, { start: iso(17, 0), end: iso(18, 0) }];
    const openHM = daySlots
      .filter((s) => !availCore.overlaps(s, sceneBusy, 30 * 60000, 30 * 60000))
      .map((s) => { const t = new Date(new Date(s.start).getTime() + 9 * 3600000); return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; });
    ok("scenario: 前30/後30/60分/空き14-17時 → 14:30,15:00,15:30 の3枠", JSON.stringify(openHM) === JSON.stringify(["14:30", "15:00", "15:30"]));
  }

  // 受付終了(close)に後バッファが収まること: 打合せ60/後20/表示60/10:00-18:00
  // → 最終枠は16:00開始(17:00終了・後バッファで17:20)。17:00開始(18:20)は close 超過で不可。
  {
    const dayWeekly = [p0.day].map((d) => ({ day_of_week: d, start_time: "10:00", end_time: "18:00" }));
    const wpage = { duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 20, slot_interval_minutes: 60 };
    const dayStart = availCore.tokyoLocalDateToUtc(p0.year, p0.month, p0.date, 0).getTime();
    const wslots = availCore.generateSlots(dayWeekly, wpage, dayStart, dayStart + DAY);
    const wStarts = wslots.map((s) => { const t = new Date(new Date(s.start).getTime() + 9 * 3600000); return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; });
    ok("window: 後バッファが受付終了に収まる(最終16:00・17:00開始は除外)", wStarts[wStarts.length - 1] === "16:00" && !wStarts.includes("17:00"));
    const closeMs = availCore.tokyoLocalDateToUtc(p0.year, p0.month, p0.date, 18 * 60).getTime();
    ok("window: 全枠で打合せ終了+後バッファ<=18:00", wslots.every((s) => new Date(s.end).getTime() + 20 * 60000 <= closeMs));
  }

  // axisRange: 稼働時間帯の最小open〜最大close
  const axis = availCore.axisRange(weekly);
  ok("axisRange: 10:00-18:00 → 600/1080", axis.start_min === 600 && axis.end_min === 1080);

  // slotsToMonthDays: 指定月の空き日抽出（7日窓ぶんの日が入る）
  const daysInMonth = availCore.slotsToMonthDays(slots, p0.year, p0.month + 1);
  ok("slotsToMonthDays: 空き日を抽出する", daysInMonth.length >= 1 && daysInMonth.every((d) => d >= 1 && d <= 31));

  // bookingBounds: リードタイムぶん最古日が繰り下がる（過去非表示の起点）
  const b0 = availCore.bookingBounds({ lead_time_hours: 0, booking_range_months: 1 });
  const b48 = availCore.bookingBounds({ lead_time_hours: 48, booking_range_months: 1 });
  ok("bookingBounds: lead0 の最古日=今日(JST)", availCore.isoDate(b0.minStart) === availCore.isoDate(Date.now()));
  ok("bookingBounds: lead48 の最古日=2日後", availCore.isoDate(b48.minStart) === availCore.isoDate(Date.now() + 2 * DAY));
  ok("bookingBounds: maxTime>minStart", b0.maxTime > b0.minStart);
}

// ---------- 12) profile.js cleanProfile: リンク（表示名＋URL）をバックエンドで連結 ----------
section("profile.js cleanProfile (links concat)");
{
  const prof = requireCjs("../../netlify/functions/profile");
  const items = [{ name: "サイト", url: "https://a.com" }, { name: "ブ\tロ\nグ", url: "https://b.com\n" }, { name: "", url: "" }];
  const outPro = prof.cleanProfile({ profile_links_items: items }, true);
  ok("cleanProfile: items→profile_links を TAB/改行連結", outPro.profile_links === "サイト\thttps://a.com\nブ ロ グ\thttps://b.com");
  ok("cleanProfile: name/url のタブ・改行は空白化（区切り保護・空要素は除外）", outPro.profile_links.split("\n").length === 2 && outPro.profile_links.indexOf("ブ\t") === -1);
  const outFree = prof.cleanProfile({ profile_links_items: items }, false);
  ok("cleanProfile: 無料は profile_links(items)を作らない（Pro限定）", outFree.profile_links == null);
}

// ---------- 13) book.js: 相手（ホスト）プロフィール節（メール/カレンダー） ----------
section("book.js host profile block (email/calendar)");
{
  const book = requireCjs("../../netlify/functions/book");
  const profile = { profile_name: "田中彰吾", profile_title: "肩書", profile_offer: "キマルのプロジェクト説明", profile_strengths: "" };
  const fields = book.hostProfileFields(profile);
  ok("hostProfileFields: 値のある項目だけ（空のstrengthsは除外）", fields.length === 2 && fields.every(([, v]) => v));
  const url = "https://kimaru-co.jp/u/tanaka";
  const lines = book.hostProfileTextLines(profile, "田中彰吾", url);
  ok("hostProfileTextLines: 見出しは「{名前}のプロフィール」", lines[0] === "― 田中彰吾のプロフィール ―");
  ok("hostProfileTextLines: 値のある項目のみ・末尾に公開URL", lines.includes("肩書き・活動内容: 肩書") && lines.includes(url) && !lines.some((l) => /^強み/.test(l)));
  const html = book.linesToHtml(lines, url, "田中彰吾のプロフィール");
  ok("linesToHtml: 公開URLは「{名前}のプロフィール」文言のハイパーリンク", html.includes(`<a href="${url}">田中彰吾のプロフィール</a>`) && html.indexOf("▼ 田中彰吾のプロフィール") === -1);
  const noneProfile = { profile_name: "X" };
  ok("hostProfileTextLines: 値もURLも無ければ空", book.hostProfileTextLines(noneProfile, "X", "").length === 0);
}

// ---------- 14) 受付時間は予約ページ単位（#263: ページBの保存がページAに漏れない） ----------
// Supabase REST を書き込み可のインメモリ表でスタブし、A→B の順に保存して A の公開ページを引く。
section("per-page availability (booking-page-save / availability)");
{
  const OWNER2 = { id: "33333333-3333-3333-3333-333333333333", name: "複数ページ", email: "multi@example.com", plan: "premium", slug: "multi" };
  const TABLES = { owners: [OWNER2], booking_pages: [], availability_settings: [], questionnaire_questions: [], bookings: [], google_connections: [] };
  let seq = 0;
  const matches = (row, params) => {
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      if (v === "is.null") { if (row[k] != null) return false; continue; }
      if (v.startsWith("eq.")) { if (String(row[k]) !== decodeURIComponent(v.slice(3))) return false; continue; }
      // lt./gt. 等は空表の照合に影響しないので無視する。
    }
    return true;
  };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
    // 未マイグレーション環境の再現用に、列名がスタブ表に無ければ PostgREST 相当のエラーを返せるようにしておく。
    const params = [...u.searchParams];
    const rows = TABLES[table] || (TABLES[table] = []);
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    let out = [];
    if (method === "GET") {
      out = rows.filter((r) => matches(r, params));
    } else if (method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      out = list.map((r) => ({ id: `${table}-${++seq}`, ...r }));
      rows.push(...out);
    } else if (method === "PATCH") {
      out = rows.filter((r) => matches(r, params));
      out.forEach((r) => Object.assign(r, body));
    } else if (method === "DELETE") {
      out = rows.filter((r) => matches(r, params));
      TABLES[table] = rows.filter((r) => !out.includes(r));
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };

  const saveFn = requireCjs(path.join(repo, "netlify/functions/booking-page-save"));
  const pagesFn = requireCjs(path.join(repo, "netlify/functions/booking-pages"));
  const availFn = requireCjs(path.join(repo, "netlify/functions/availability"));
  const cookie2 = sessionCookie(OWNER2.id).split(";")[0];
  const avail = (days, start, end) => days.map((d) => ({ day_of_week: d, start_time: start, end_time: end, enabled: true }));
  const save = (payload) => saveFn.handler({ httpMethod: "POST", headers: { cookie: cookie2 }, body: JSON.stringify(payload) });

  // ページA: 月〜金 10:00-18:00 ／ ページB: 土のみ 13:00-17:00
  const resA = await save({ slug: "page-a", title: "A", duration_minutes: 30, availability_settings: avail([1, 2, 3, 4, 5], "10:00", "18:00") });
  ok("ページAを保存できる", resA.statusCode === 200);
  const resB = await save({ slug: "page-b", title: "B", duration_minutes: 60, availability_settings: avail([6], "13:00", "17:00") });
  ok("ページBを保存できる", resB.statusCode === 200);

  const pageAId = JSON.parse(resA.body).booking_page.id;
  const rowsA = TABLES.availability_settings.filter((r) => r.booking_page_id === pageAId);
  ok("保存後もページAの受付時間は月〜金5行のまま（Bの保存で消えない）", rowsA.length === 5 && rowsA.every((r) => r.start_time === "10:00"));
  ok("受付時間の行はページごとに分かれる（合計6行）", TABLES.availability_settings.length === 6);

  // 公開ページ（ゲスト側）: A は平日枠、B は土曜枠。
  const guestA = JSON.parse((await availFn.handler({ queryStringParameters: { slug: "page-a" } })).body);
  ok("公開ページA: 縦軸は10:00-18:00（Bの13:00-17:00に上書きされない）", guestA.axis.start_min === 600 && guestA.axis.end_min === 1080);
  ok("公開ページA: 所要30分・タイトルAで解決される", guestA.host.duration_minutes === 30 && guestA.host.title === "A");
  const guestB = JSON.parse((await availFn.handler({ queryStringParameters: { slug: "page-b" } })).body);
  ok("公開ページB: 縦軸は13:00-17:00（自分の設定）", guestB.axis.start_min === 780 && guestB.axis.end_min === 1020);
  const dows = (data) => new Set((data.slots || []).map((s) => new Date(new Date(s.start).getTime() + 9 * 3600000).getUTCDay()));
  ok("公開ページBの枠は土曜だけ（Aの平日が混ざらない）", [...dows(guestB)].every((d) => d === 6));
  ok("公開ページAの枠に土曜は含まれない", ![...dows(guestA)].includes(6));

  // 設定画面の一覧: 各ページに自分の受付時間がぶら下がる。
  const listBody = JSON.parse((await pagesFn.handler({ httpMethod: "GET", headers: { cookie: cookie2 }, queryStringParameters: {} })).body);
  const byTitle = Object.fromEntries(listBody.pages.map((p) => [p.title, p]));
  ok("一覧API: ページAに月〜金5行", byTitle.A.availability.length === 5);
  ok("一覧API: ページBに土曜1行", byTitle.B.availability.length === 1 && byTitle.B.availability[0].day_of_week === 6);

  // レガシー（booking_page_id=null）の共有行は、自前の設定が無いページのフォールバックとして残る。
  TABLES.booking_pages.push({ id: "legacy-page", owner_id: OWNER2.id, slug: "page-legacy", title: "L", duration_minutes: 30, is_active: true, booking_range_months: 2 });
  TABLES.availability_settings.push({ id: "legacy-av", owner_id: OWNER2.id, booking_page_id: null, day_of_week: 3, start_time: "09:00", end_time: "12:00" });
  const guestL = JSON.parse((await availFn.handler({ queryStringParameters: { slug: "page-legacy" } })).body);
  ok("未移行ページ: 共有(booking_page_id=null)の受付時間にフォールバック", guestL.axis.start_min === 540 && guestL.axis.end_min === 720);
  const guestA2 = JSON.parse((await availFn.handler({ queryStringParameters: { slug: "page-a" } })).body);
  ok("自前の設定があるページは共有行に引きずられない", guestA2.axis.start_min === 600 && guestA2.axis.end_min === 1080);
}

// ---------- 14a) #304 事前アンケートの質問は差分保存（更新/追加/削除）にする ----------
// 全削除→再作成だと保存のたびに質問のUUIDが変わり、過去の回答の question_id が
// on delete set null で切れてしまう。既存行のIDを保つこと。
section("booking-page-save: questions upsert keeps ids (#304)");
{
  const OWNER_Q = { id: "77777777-7777-7777-7777-777777777777", name: "Q", email: "q@example.com", plan: "pro", slug: "q" };
  const TABLES = {
    owners: [OWNER_Q],
    booking_pages: [{ id: "page-q", owner_id: OWNER_Q.id, slug: "q-page", title: "Q", is_active: true }],
    questionnaire_questions: [
      { id: "q-keep", booking_page_id: "page-q", question_text: "ご予算感", sort_order: 1, frozen: false },
      { id: "q-drop", booking_page_id: "page-q", question_text: "消される質問", sort_order: 2, frozen: false },
      { id: "q-frozen", booking_page_id: "page-q", question_text: "凍結ぶん", sort_order: 3, frozen: true },
    ],
    availability_settings: [],
  };
  const calls = [];
  let seq = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    const rows = TABLES[table] || (TABLES[table] = []);
    if (table === "questionnaire_questions") calls.push({ method, query: u.search, body });
    let out = [];
    if (method === "GET") out = rows;
    else if (method === "POST") { const list = Array.isArray(body) ? body : [body]; out = list.map((r) => ({ id: `${table}-${++seq}`, ...r })); rows.push(...out); }
    else if (method === "PATCH") { out = rows; }
    else if (method === "DELETE") { out = rows; }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  const saveFn = requireCjs(path.join(repo, "netlify/functions/booking-page-save"));
  const res = await saveFn.handler({
    httpMethod: "POST",
    headers: { cookie: sessionCookie(OWNER_Q.id).split(";")[0] },
    body: JSON.stringify({
      id: "page-q", slug: "q-page", title: "Q", duration_minutes: 30,
      availability_settings: [{ day_of_week: 1, start_time: "10:00", end_time: "18:00", enabled: true }],
      questions: [
        { id: "q-keep", question_text: "ご予算感（改訂）", is_required: true },  // 既存 → 更新
        { question_text: "新しい質問", is_required: false },                     // id 無し → 追加
        // q-drop は送らない → 削除 ／ q-frozen は画面に出ないので送られない → 温存
      ],
    }),
  });
  ok("保存できる", res.statusCode === 200);
  const patches = calls.filter((c) => c.method === "PATCH");
  const posts = calls.filter((c) => c.method === "POST");
  const deletes = calls.filter((c) => c.method === "DELETE");
  ok("全削除しない（DELETE は booking_page_id 一括ではない）",
    !deletes.some((d) => d.query.includes("booking_page_id")));
  ok("既存の質問は id 指定で更新される", patches.length === 1 && patches[0].query.includes("q-keep"));
  ok("更新時に id 列そのものは書き込まない", patches[0] && !("id" in patches[0].body));
  ok("更新内容が反映される", patches[0]?.body.question_text === "ご予算感（改訂）");
  ok("新規の質問は追加される", posts.length === 1 && posts[0].body.question_text === "新しい質問");
  ok("送信されなかった質問は削除される", deletes.some((d) => d.query.includes("q-drop")));
  ok("凍結行は送信されなくても削除しない", !deletes.some((d) => d.query.includes("q-frozen")));
}

// ---------- 14a-2) #304 受付時間も差分保存にする（全消しの瞬間を作らない） ----------
// 全DELETE→全INSERT だと INSERT 失敗でそのページの受付時間が丸ごと消え、
// 既定（平日10:00-18:00）にフォールバックして設定外の時間で予約を受けてしまう。
section("booking-page-save: availability upsert by weekday (#304)");
{
  const OWNER_A = { id: "88888888-8888-8888-8888-888888888888", name: "A", email: "a@example.com", plan: "pro", slug: "a" };
  const makeTables = () => ({
    owners: [OWNER_A],
    booking_pages: [{ id: "page-a", owner_id: OWNER_A.id, slug: "a-page", title: "A", is_active: true }],
    questionnaire_questions: [],
    availability_settings: [
      { id: "av-mon", owner_id: OWNER_A.id, booking_page_id: "page-a", day_of_week: 1, start_time: "10:00", end_time: "18:00" },
      { id: "av-tue", owner_id: OWNER_A.id, booking_page_id: "page-a", day_of_week: 2, start_time: "10:00", end_time: "18:00" },
    ],
  });
  const run = async (settings) => {
    const TABLES = makeTables();
    const calls = [];
    let seq = 0;
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(url);
      const table = u.pathname.replace("/rest/v1/", "");
      const method = (options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(options.body) : null;
      const rows = TABLES[table] || (TABLES[table] = []);
      if (table === "availability_settings") calls.push({ method, query: u.search, body });
      let out = [];
      if (method === "GET") out = rows;
      else if (method === "POST") { const list = Array.isArray(body) ? body : [body]; out = list.map((r) => ({ id: `${table}-${++seq}`, ...r })); rows.push(...out); }
      else out = rows;
      return { ok: true, status: 200, text: async () => JSON.stringify(out) };
    };
    const saveFn = requireCjs(path.join(repo, "netlify/functions/booking-page-save"));
    const res = await saveFn.handler({
      httpMethod: "POST",
      headers: { cookie: sessionCookie(OWNER_A.id).split(";")[0] },
      body: JSON.stringify({ id: "page-a", slug: "a-page", title: "A", duration_minutes: 30, questions: [], availability_settings: settings }),
    });
    return { res, calls };
  };

  // 画面は7曜日ぶんを enabled 付きで送る。月=時間変更 / 火=オフ / 水=新規オン。
  const week = (over) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    day_of_week: d, start_time: "10:00", end_time: "18:00", enabled: false, ...(over[d] || {}),
  }));
  const a = await run(week({
    1: { start_time: "09:00", end_time: "17:00", enabled: true },
    2: { enabled: false },
    3: { start_time: "13:00", end_time: "16:00", enabled: true },
  }));
  ok("保存できる", a.res.statusCode === 200);
  ok("一括DELETEをしない（ページ単位）", !a.calls.some((c) => c.method === "DELETE" && c.query.includes("booking_page_id")));
  ok("一括DELETEをしない（オーナー単位）", !a.calls.some((c) => c.method === "DELETE" && c.query.includes("owner_id")));
  ok("オフにしても行を消さない（DELETE が1件も出ない）", !a.calls.some((c) => c.method === "DELETE"));
  const patches = a.calls.filter((c) => c.method === "PATCH");
  ok("既存の曜日は id 指定で更新される", patches.some((p) => p.query.includes("av-mon")) && patches.some((p) => p.query.includes("av-tue")));
  ok("月曜の時間が更新される", patches.some((p) => p.query.includes("av-mon") && p.body.start_time === "09:00" && p.body.enabled === true));
  ok("火曜はオフとして残る（時間は保持）", patches.some((p) => p.query.includes("av-tue") && p.body.enabled === false && p.body.start_time === "10:00"));
  const posts = a.calls.filter((c) => c.method === "POST");
  ok("未作成の曜日は追加される（7曜日ぶん揃う）", posts.length === 5 && posts.every((x) => x.body.booking_page_id === "page-a"));
  ok("追加行にも enabled が入る", posts.some((x) => x.body.day_of_week === 3 && x.body.enabled === true) && posts.some((x) => x.body.enabled === false));

  // 全曜日オフは弾く（受付できないページを作らせない）。
  const none = await run(week({}));
  ok("全曜日オフは400で弾く", none.res.statusCode === 400);

  // enabled 列が無い環境: 旧モデル（オフの曜日は行を消す）へデグレードする。
  {
    const TABLES = makeTables();
    const calls = [];
    let seq = 0;
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(url);
      const table = u.pathname.replace("/rest/v1/", "");
      const method = (options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(options.body) : null;
      const rows = TABLES[table] || (TABLES[table] = []);
      if (table === "availability_settings") {
        if (method === "GET" && u.search.includes("enabled")) {
          return { ok: false, status: 400, text: async () => JSON.stringify({ message: "column availability_settings.enabled does not exist" }) };
        }
        calls.push({ method, query: u.search, body });
      }
      let out = [];
      if (method === "GET") out = rows;
      else if (method === "POST") { const list = Array.isArray(body) ? body : [body]; out = list.map((r) => ({ id: `${table}-${++seq}`, ...r })); rows.push(...out); }
      else out = rows;
      return { ok: true, status: 200, text: async () => JSON.stringify(out) };
    };
    const saveFn = requireCjs(path.join(repo, "netlify/functions/booking-page-save"));
    const res = await saveFn.handler({
      httpMethod: "POST",
      headers: { cookie: sessionCookie(OWNER_A.id).split(";")[0] },
      body: JSON.stringify({ id: "page-a", slug: "a-page", title: "A", duration_minutes: 30, questions: [], availability_settings: week({ 1: { enabled: true } }) }),
    });
    ok("enabled 列が無くても保存できる", res.statusCode === 200);
    ok("列が無い環境ではオフの曜日を削除する（旧挙動）", calls.some((c) => c.method === "DELETE" && c.query.includes("av-tue")));
    ok("列が無い環境では enabled を書き込まない", !calls.some((c) => c.body && "enabled" in c.body));
  }
}

// ---------- 14a-3) #304 枠生成はオンの曜日だけを読む ----------
// JS側で絞ると漏れが「オフにした曜日で予約を受ける」事故になるため、クエリで絞る。
section("availability-core reads only enabled weekdays (#304)");
{
  const core = requireCjs(path.join(repo, "netlify/functions/_lib/availability-core.js"));
  const queries = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    queries.push(u.search);
    return { ok: true, status: 200, text: async () => JSON.stringify([{ day_of_week: 1, start_time: "10:00", end_time: "18:00" }]) };
  };
  await core.pageAvailability({ id: "own-1" }, { id: "page-x" });
  ok("ページ単位の取得に enabled=is.true が付く", queries.some((q) => q.includes("booking_page_id=eq.page-x") && q.includes("enabled=is.true")));
  queries.length = 0;
  await core.ownerAvailability({ id: "own-1" });
  ok("オーナー単位の取得にも enabled=is.true が付く", queries.some((q) => q.includes("enabled=is.true")));

  // 列が無い環境ではフィルタ無しへフォールバックする（その時点では全行がオン扱いで正しい）。
  queries.length = 0;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    queries.push(u.search);
    if (u.search.includes("enabled=is.true")) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ message: "column availability_settings.enabled does not exist" }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ day_of_week: 1, start_time: "10:00", end_time: "18:00" }]) };
  };
  const rows = await core.pageAvailability({ id: "own-1" }, { id: "page-x" });
  ok("列が無ければフィルタ無しで読み直す", queries.length >= 2 && rows.length === 1);
}

// ---------- 14b) #300 前後バッファ: 選択肢外の旧データを弾かず保持する ----------
// 本番には bufferBefore/After=15分 のページが存在する（UIの選択肢は10分刻み）。
// 集合で弾くと編集画面から保存できず、設定が消える。範囲クランプで受ける。
section("booking-page-save: buffer clamp (#300)");
{
  const OWNER_B = { id: "55555555-5555-5555-5555-555555555555", name: "バッファ", email: "buf@example.com", plan: "pro", slug: "buf" };
  const TABLES = { owners: [OWNER_B], booking_pages: [], availability_settings: [], questionnaire_questions: [] };
  let seq = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
    const rows = TABLES[table] || (TABLES[table] = []);
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    let out = [];
    if (method === "GET") out = rows;
    else if (method === "POST") { const list = Array.isArray(body) ? body : [body]; out = list.map((r) => ({ id: `${table}-${++seq}`, ...r })); rows.push(...out); }
    else if (method === "PATCH") { out = rows; rows.forEach((r) => Object.assign(r, body)); }
    else if (method === "DELETE") { out = rows; TABLES[table] = []; }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  const saveFn = requireCjs(path.join(repo, "netlify/functions/booking-page-save"));
  const cookieB = sessionCookie(OWNER_B.id).split(";")[0];
  const availability_settings = [{ day_of_week: 1, start_time: "10:00", end_time: "18:00", enabled: true }];
  // 1ページを作ってから id 付きで更新する＝実際の「編集して保存」と同じ経路を通す。
  let pageId = "";
  // バッファを設定するときは予定名も必須になった（#321）ので、既定で入れておく。
  // このセクションで見たいのは「値のクランプ」なので、タイトルの有無で落ちないようにする。
  const save = (over) => saveFn.handler({
    httpMethod: "POST", headers: { cookie: cookieB },
    body: JSON.stringify({ id: pageId || undefined, slug: "buf-page", title: "B", duration_minutes: 60, availability_settings, buffer_before_title: "準備", buffer_after_title: "片付け", ...over }),
  });
  const savedBuffers = (res) => {
    const p = JSON.parse(res.body).booking_page;
    return p ? String([p.buffer_before_minutes, p.buffer_after_minutes]) : `HTTP ${res.statusCode}`;
  };

  const legacy = await save({ buffer_before_minutes: 15, buffer_after_minutes: 15 });
  ok("選択肢外の15分でも保存できる（400にしない）", legacy.statusCode === 200);
  ok("15分がそのまま保存される（0に落ちない）", savedBuffers(legacy) === "15,15");
  pageId = JSON.parse(legacy.body).booking_page.id;

  ok("通常の選択肢はそのまま", savedBuffers(await save({ buffer_before_minutes: 20, buffer_after_minutes: 0 })) === "20,0");
  ok("範囲外は0〜60にクランプする", savedBuffers(await save({ buffer_before_minutes: 999, buffer_after_minutes: -30 })) === "60,0");
  ok("数値でない入力は0になる", savedBuffers(await save({ buffer_before_minutes: "abc", buffer_after_minutes: null })) === "0,0");

  // #321: バッファを設定したら予定名は必須。空だとカレンダーに予定が作られず、
  // 「設定したのに何も起きない」状態になるので、保存させずに知らせる。
  const noTitle = await save({ buffer_before_minutes: 20, buffer_before_title: "", buffer_after_minutes: 0, buffer_after_title: "" });
  ok("バッファありで予定名が空なら400 (#321)", noTitle.statusCode === 400);
  const afterNoTitle = await save({ buffer_before_minutes: 0, buffer_before_title: "", buffer_after_minutes: 30, buffer_after_title: "  " });
  ok("後バッファだけでも予定名は必須 (#321)", afterNoTitle.statusCode === 400);
  ok("バッファ0なら予定名が空でも保存できる (#321)", savedBuffers(await save({ buffer_before_minutes: 0, buffer_before_title: "", buffer_after_minutes: 0, buffer_after_title: "" })) === "0,0");
}

// ---------- 14c) #300 バッファ予定を「予定あり」で作り、空き枠計算の障害物にする ----------
// 以前は transparency:"transparent"（予定なし）で作っていたため freeBusy に出ず、
// キマル自身が作ったバッファ予定の上に次の面談が入っていた。
section("buffer calendar event is busy (#300)");
{
  const OWNER_G = { id: "66666666-6666-6666-6666-666666666666", email: "buf-cal@example.com" };
  process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || "0".repeat(64);
  const { encrypt } = requireCjs(path.join(repo, "netlify/functions/_lib/crypto.js"));
  const sent = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/google_connections")) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        owner_id: OWNER_G.id,
        access_token: encrypt("fake-access-token"),
        refresh_token: encrypt("fake-refresh-token"),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }]) };
    }
    if (u.includes("googleapis.com/calendar/v3/events") || u.includes("calendars/primary/events")) {
      sent.push(JSON.parse(options.body || "{}"));
      return { ok: true, status: 200, json: async () => ({ id: `ev-${sent.length}` }) };
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => ({}) };
  };
  const google = requireCjs(path.join(repo, "netlify/functions/_lib/google.js"));
  await google.createBufferEventsFor(
    OWNER_G.id,
    { start_at: "2026-08-10T01:00:00.000Z", end_at: "2026-08-10T02:00:00.000Z" }, // JST 10:00-11:00
    { buffer_before_minutes: 0, buffer_after_minutes: 30, buffer_before_title: "", buffer_after_title: "空き" }
  );
  ok("後バッファの予定が1件作られる", sent.length === 1);
  ok("バッファ予定は「予定あり(busy)」で作る（freeBusyに出る）", sent[0]?.transparency !== "transparent");
  ok("バッファ予定はホストのみ（ゲストを招待しない）", !sent[0]?.attendees);
  ok("バッファ予定は面談の直後に置かれる", sent[0]?.start?.dateTime === "2026-08-10T02:00:00.000Z"
    && sent[0]?.end?.dateTime === "2026-08-10T02:30:00.000Z");

  // 仕様: 次の予約は「バッファ予定の終了 ＋ その予約ページの前バッファ」以降から入れる。
  const core = requireCjs(path.join(repo, "netlify/functions/_lib/availability-core.js"));
  const weekly = [{ day_of_week: 1, start_time: "10:00", end_time: "18:00" }];
  // generateSlots は現在時刻以前の枠を落とすので、日付を固定するとその日を過ぎた時点で
  // テストが落ちる（実際に落ちた）。常に「4日以上先の月曜」を使って実行日に依存させない。
  const monday = (() => {
    for (let t = Date.now() + 4 * 86400000; ; t += 86400000) {
      const p = core.tokyoParts(new Date(t));
      if (p.day === 1) return p;
    }
  })();
  const jst = (h, m) => new Date(Date.UTC(monday.year, monday.month, monday.date, h - 9, m));
  // 面談 10:00-11:00 ＋ バッファ予定「空き」11:00-11:30 が busy に入っている状態
  const busy = [
    { start: jst(10, 0).toISOString(), end: jst(11, 0).toISOString() },
    { start: jst(11, 0).toISOString(), end: jst(11, 30).toISOString() },
  ];
  const openAfter = (bufferBefore, interval) => {
    const page = { duration_minutes: 60, buffer_before_minutes: bufferBefore, buffer_after_minutes: 30, slot_interval_minutes: interval };
    const slots = core.generateSlots(weekly, page, jst(0, 0).getTime(), jst(24, 0).getTime());
    const bB = bufferBefore * 60000, bA = 30 * 60000;
    return slots
      .filter((s) => !core.overlaps(s, busy, bB, bA) && new Date(s.start) >= jst(11, 0))
      .map((s) => new Date(new Date(s.start).getTime() + 9 * 3600000).toISOString().slice(11, 16));
  };
  // 表示間隔=自動なら、枠のはしごが「所要＋前後バッファ」刻みなので規則どおりの時刻になる。
  ok("自動・前0: バッファ予定の終了と同時(11:30)から予約できる", openAfter(0, null)[0] === "11:30");
  ok("自動・前20分: バッファ予定の終了+20分(11:50)から予約できる", openAfter(20, null)[0] === "11:50");
  // 固定間隔のときは刻みにも乗る必要があるので、規則を満たす最初の「刻み」になる。
  // 肝心なのは、いずれの設定でもバッファ予定(11:00-11:30)の上に枠が出ないこと。
  ok("固定30分・前0: 11:30から（刻みに一致）", openAfter(0, 30)[0] === "11:30");
  ok("固定30分・前20分: 11:50は刻みに無いので12:00から", openAfter(20, 30)[0] === "12:00");
  const invades = (list) => list.some((t) => t >= "11:00" && t < "11:30");
  ok("どの設定でもバッファ予定(11:00-11:30)に枠が出ない",
    ![openAfter(0, null), openAfter(20, null), openAfter(0, 30), openAfter(20, 30)].some(invades));
}

// ---------- 15) Google連携: slug を壊さない／ログイン中はアカウントを切り替えない ----------
// (1) upsertOwner が既存アカウントの slug を上書きしない（公開URL /u/{slug} が切れる・unique違反で500になる）
// (2) 新規は衝突しにくいランダムサフィックス付き slug を採番し、衝突したらリトライする
// (3) 設定画面からの連携(state="c...")でログイン中なら、そのアカウントにカレンダーを繋ぐだけ
section("Google auth: slug preservation / connect vs login");
{
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "unit-test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "unit-test-client-secret";
  const OWNER3 = { id: "44444444-4444-4444-4444-444444444444", email: "mnie427@icloud.com", name: "既存ユーザー", slug: "mnie427-r3a1o", plan: "free" };
  const TABLES = { owners: [OWNER3], google_connections: [], booking_pages: [], availability_settings: [] };
  let seq = 0;
  let failNextInserts = 0; // slug unique 違反を人工的に起こす回数
  const matches = (row, params) => {
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v === "is.null") { if (row[k] != null) return false; continue; }
      if (v.startsWith("eq.") && String(row[k]) !== decodeURIComponent(v.slice(3))) return false;
    }
    return true;
  };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    // Google 側のエンドポイントはスタブ応答を返す（ネットワークに出さない）。google.js は response.json() を使う。
    const reply = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (u.hostname === "oauth2.googleapis.com") return reply({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    if (u.hostname === "www.googleapis.com" && u.pathname.startsWith("/oauth2/v2/userinfo")) {
      return reply({ email: "another.google@gmail.com", name: "別のGoogle", picture: "https://x/p.png" });
    }
    const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
    const params = [...u.searchParams];
    const rows = TABLES[table] || (TABLES[table] = []);
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    let out = [];
    if (method === "GET") out = rows.filter((r) => matches(r, params));
    else if (method === "POST") {
      if (table === "owners" && failNextInserts > 0) {
        failNextInserts -= 1;
        return { ok: false, status: 409, text: async () => JSON.stringify({ message: 'duplicate key value violates unique constraint "owners_slug_unique"' }) };
      }
      const list = Array.isArray(body) ? body : [body];
      out = list.map((r) => ({ id: `${table}-${++seq}`, ...r }));
      rows.push(...out);
    } else if (method === "PATCH") {
      out = rows.filter((r) => matches(r, params));
      out.forEach((r) => Object.assign(r, body));
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };

  const { upsertOwner, ownerSlugCandidate } = requireCjs(path.join(repo, "netlify/functions/_lib/supabase"));

  // (1) 既存アカウント: slug は据え置き、name/avatar だけ更新される
  await upsertOwner({ email: OWNER3.email, name: "Googleの表示名", avatar_url: "https://x/a.png", slug: "mnie427" });
  ok("既存アカウントの slug は上書きされない（公開URLが切れない）", TABLES.owners[0].slug === "mnie427-r3a1o");
  ok("既存アカウントの name/avatar は Google の値で更新される", TABLES.owners[0].name === "Googleの表示名" && TABLES.owners[0].avatar_url === "https://x/a.png");

  // (2) 新規アカウント: ランダムサフィックス付き＋衝突時リトライ
  ok("ownerSlugCandidate: ローカル部＋サフィックス", /^info-[a-z0-9]{1,5}$/.test(ownerSlugCandidate("info@example.com")));
  ok("ownerSlugCandidate: 同じメールでも毎回違う", ownerSlugCandidate("info@example.com") !== ownerSlugCandidate("info@example.com"));
  const created = await upsertOwner({ email: "info@example.com", name: "新規" });
  ok("新規アカウントの slug はローカル部そのままではない（他ドメインの同名と衝突しない）", created.slug !== "info" && created.slug.startsWith("info-"));
  failNextInserts = 2; // 最初の2回は unique 違反 → 3回目で成功するはず
  const retried = await upsertOwner({ email: "info@other.co.jp", name: "衝突" });
  ok("slug 衝突時は候補を変えてリトライし、ログインを 500 にしない", Boolean(retried && retried.slug.startsWith("info-")));

  // (3) 連携モード: ログイン中は「別のGoogleアカウント」を選んでもアカウントが切り替わらない
  const startFn = requireCjs(path.join(repo, "netlify/functions/google-auth-start"));
  const ownerCookie = sessionCookie(OWNER3.id).split(";")[0];
  const connectRes = await startFn.handler({ queryStringParameters: { connect: "1" }, headers: { cookie: ownerCookie } });
  const loginRes = await startFn.handler({ queryStringParameters: {}, headers: {} });
  const stateOf = (res) => decodeURIComponent(String(res.headers.Location).match(/[?&]state=([^&]+)/)[1]);
  const connectState = stateOf(connectRes);
  ok("google-auth-start: connect=1 の state は 'c'＋署名ブロブ", connectState.startsWith("c") && connectState.includes("."));
  ok("google-auth-start: 通常ログインの state は 'l' で始まる", stateOf(loginRes).startsWith("l"));
  const noSessionConnect = await startFn.handler({ queryStringParameters: { connect: "1" }, headers: {} });
  ok("google-auth-start: 未ログインで connect=1 は通常ログインへフォールバック", stateOf(noSessionConnect).startsWith("l"));

  const cbFn = requireCjs(path.join(repo, "netlify/functions/google-auth-callback"));
  const stateCookie = String(connectRes.headers["Set-Cookie"]).split(";")[0];
  const ownersBefore = TABLES.owners.length;
  const cb = await cbFn.handler({
    queryStringParameters: { code: "x", state: connectState },
    headers: { cookie: `${ownerCookie}; ${stateCookie}` },
  });
  ok("連携モード: 別のGoogleアカウントを選んでも owner が増えない（アカウント切替が起きない）", TABLES.owners.length === ownersBefore);
  ok("連携モード: カレンダーはログイン中のアカウントに紐づく", TABLES.google_connections.length === 1 && TABLES.google_connections[0].owner_id === OWNER3.id);
  ok("連携モード: 設定画面へ戻す", String(cb.headers.Location).includes("/settings.html"));
  ok("連携モード: セッションを張り直さない（既に有効なため）", !String(cb.multiValueHeaders["Set-Cookie"].join(" ")).includes("kimaru_session="));

  // 【セキュリティ】アカウント連携CSRF: 攻撃者のセッションを植えられた被害者が連携を完了しても、
  // 被害者のGoogleトークンが攻撃者のアカウントへ保存されてはいけない。
  const ATTACKER = { id: "66666666-6666-6666-6666-666666666666", email: "attacker@evil.example", plan: "free", slug: "attacker" };
  TABLES.owners.push(ATTACKER);
  const connCountBefore = TABLES.google_connections.length;
  const attacked = await cbFn.handler({
    queryStringParameters: { code: "x", state: connectState }, // 被害者が正規に開始した state
    headers: { cookie: `${sessionCookie(ATTACKER.id).split(";")[0]}; ${stateCookie}` }, // ただしセッションは攻撃者
  });
  ok("連携CSRF: state の owner とセッションの owner が不一致なら中断する", String(attacked.headers.Location).includes("calendar=state_error"));
  ok("連携CSRF: トークンを保存しない", TABLES.google_connections.length === connCountBefore
    && !TABLES.google_connections.some((c) => c.owner_id === ATTACKER.id));
  ok("連携CSRF: ログイン扱いへフォールバックしない（owner を作らない）", !TABLES.owners.some((o) => o.email === "another.google@gmail.com"));

  // ログインモード（state="l...") は従来どおり Google のメールで解決して新規作成する
  const loginState = stateOf(loginRes);
  const loginCookie = String(loginRes.headers["Set-Cookie"]).split(";")[0];
  const before2 = TABLES.owners.length;
  const cb2 = await cbFn.handler({ queryStringParameters: { code: "x", state: loginState }, headers: { cookie: loginCookie } });
  ok("ログインモード: Googleのメールでアカウントを作成する", TABLES.owners.length === before2 + 1 && TABLES.owners.some((o) => o.email === "another.google@gmail.com"));
  ok("ログインモード: ホームへ遷移する", String(cb2.headers.Location).includes("/dashboard.html"));

  // (4) booking_pages.updated_at が保存で更新される（plan-freeze の「直近更新順」が効くように）
  const saveFn = requireCjs(path.join(repo, "netlify/functions/booking-page-save"));
  TABLES.owners.push({ id: "55555555-5555-5555-5555-555555555555", email: "up@example.com", plan: "premium", slug: "up" });
  const upCookie = sessionCookie("55555555-5555-5555-5555-555555555555").split(";")[0];
  const saved = await saveFn.handler({
    httpMethod: "POST", headers: { cookie: upCookie },
    body: JSON.stringify({ slug: "up-page", title: "U", duration_minutes: 30, availability_settings: [{ day_of_week: 1, start_time: "10:00", end_time: "18:00", enabled: true }] }),
  });
  ok("booking-page-save: updated_at を書き込む", saved.statusCode === 200 && Boolean(JSON.parse(saved.body).booking_page.updated_at));

  // (5) ログインCSRF: セッションを発行するエンドポイントはクロスサイト送信を拒否する。
  //     これを許すと「攻撃者のアカウントで被害者をログイン状態にする」→ 連携フローの乗っ取りが成立する。
  const { hashPassword } = requireCjs(path.join(repo, "netlify/functions/_lib/crypto"));
  TABLES.owners.push({ id: "77777777-7777-7777-7777-777777777777", email: "csrf@example.com", plan: "free", slug: "csrf", password_hash: hashPassword("password123") });
  const loginFn = requireCjs(path.join(repo, "netlify/functions/auth-login"));
  const creds = JSON.stringify({ email: "csrf@example.com", password: "password123" });
  const jsonHeaders = { "content-type": "application/json", origin: "https://kimaru-co.jp", host: "kimaru-co.jp" };

  const sameSite = await loginFn.handler({ httpMethod: "POST", headers: jsonHeaders, body: creds });
  ok("auth-login: 同一オリジンからの正規ログインは通る", sameSite.statusCode === 200);
  const crossOrigin = await loginFn.handler({
    httpMethod: "POST", headers: { ...jsonHeaders, origin: "https://evil.example" }, body: creds,
  });
  ok("auth-login: クロスオリジンの Origin は 403", crossOrigin.statusCode === 403);
  const crossFetchSite = await loginFn.handler({
    httpMethod: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site", host: "kimaru-co.jp" }, body: creds,
  });
  ok("auth-login: Sec-Fetch-Site: cross-site は 403", crossFetchSite.statusCode === 403);
  const noOrigin = await loginFn.handler({ httpMethod: "POST", headers: { "content-type": "application/json", host: "kimaru-co.jp" }, body: creds });
  ok("auth-login: Origin 無し（curl等の非ブラウザ）は従来どおり通る", noOrigin.statusCode === 200);

  // readJson: <form enctype="text/plain"> が作る「JSONとして妥当な」本文を解釈しない。
  const { readJson } = requireCjs(path.join(repo, "netlify/functions/_lib/response"));
  const formBody = '{"email":"attacker@evil.example","password":"pw","x":"="}'; // text/plain フォームが生成できる形
  ok("readJson: application/json は従来どおりパースする",
    readJson({ headers: { "content-type": "application/json" }, body: formBody }).email === "attacker@evil.example");
  ok("readJson: text/plain は解釈しない（CSRFでJSON APIを叩けない）",
    Object.keys(readJson({ headers: { "content-type": "text/plain" }, body: formBody })).length === 0);
  ok("readJson: form-urlencoded / multipart も解釈しない",
    Object.keys(readJson({ headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody })).length === 0
    && Object.keys(readJson({ headers: { "content-type": "multipart/form-data; boundary=x" }, body: formBody })).length === 0);
  ok("readJson: content-type 無し（サーバ間）は従来どおり",
    readJson({ headers: {}, body: formBody }).email === "attacker@evil.example");
}

// ---------- 18) 管理リンク: 1パラメータ化（?k=<id>.<token>）と旧形式の後方互換 ----------
// プレーンテキストメールで `&` を切るメールクライアントがあり、t が欠けるとキャンセル不能に
// なっていた。新リンクは `&` を含まない。送信済みメールの ?id=&t= も引き続き開けること。
section("manage link: single-param ?k= (mail-safe) + legacy ?id=&t=");
{
  const fmt = requireCjs(path.join(repo, "netlify/functions/_lib/booking-format"));
  const manageLink = fmt.manageUrl("aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
  ok("manageUrl に & が含まれない（メールでのリンク切断対策）", !manageLink.includes("&"));
  ok("manageUrl は ?k=<id>.<token> 形式", /\?k=aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb\.[A-Za-z0-9_-]+$/.test(manageLink));

  const MB = { id: "mb1", owner_id: OWNER.id, visitor_name: "管理 太郎", visitor_email: "", location_type: "google_meet", status: "confirmed", start_at: new Date(Date.now() + 86400000).toISOString(), end_at: new Date(Date.now() + 86400000 + 1800000).toISOString() };
  const TB = { bookings: [MB], owners: [OWNER], booking_pages: [] };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
    const rows = TB[table] || [];
    const id = (u.searchParams.get("id") || "").replace("eq.", "");
    const out = id ? rows.filter((r) => String(r.id) === decodeURIComponent(id)) : rows;
    if ((options.method || "GET").toUpperCase() === "PATCH") out.forEach((r) => Object.assign(r, JSON.parse(options.body)));
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };

  const bm = requireCjs(path.join(repo, "netlify/functions/booking-manage.js"));
  const tok = cryptoLib.bookingToken("mb1");
  const viaK = await bm.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { k: `mb1.${tok}` } });
  ok("新形式 ?k=<id>.<token> で予約を開ける", viaK.statusCode === 200 && JSON.parse(viaK.body).booking.id === "mb1");
  const viaLegacy = await bm.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { id: "mb1", t: tok } });
  ok("旧形式 ?id=&t= も引き続き開ける（送信済みメール）", viaLegacy.statusCode === 200);
  const tampered = await bm.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { k: "mb1.wrong-token" } });
  ok("トークン改ざんは 404", tampered.statusCode === 404);
  const noDot = await bm.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { k: "mb1" } });
  ok("k にトークンが無ければ 404（id だけでは開けない）", noDot.statusCode === 404);
  const cancelViaK = await bm.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ k: `mb1.${tok}`, action: "cancel" }) });
  ok("新形式でキャンセルできる", cancelViaK.statusCode === 200 && MB.status === "cancelled");
}

// ---------- 19) owner-bookings: 一覧上限から溢れた予約も ?id= 指定なら返す ----------
// meeting.html は ?id をこの一覧から探すため、溢れると詳細が「見つかりません」になり
// キャンセル・日程変更の導線ごと消えていた。
section("owner-bookings: ?id= includes a booking beyond the list cap");
{
  const OWNER4 = { id: "77777777-7777-7777-7777-777777777777", name: "多数予約", email: "many@example.com", plan: "free", slug: "many" };
  const many = Array.from({ length: 205 }, (_, i) => ({
    id: `bk-${String(i).padStart(3, "0")}`,
    owner_id: OWNER4.id,
    visitor_name: `相手${i}`,
    status: "confirmed",
    // i が小さいほど過去（start_at 降順の一覧では後ろに落ちる）
    start_at: new Date(Date.now() - (205 - i) * 3600000).toISOString(),
  }));
  const TB2 = { bookings: many, owners: [OWNER4], manual_contacts: [], questionnaire_answers: [] };
  // PostgREST 相当（order/limit を実際に効かせる）
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
    let rows = (TB2[table] || []).slice();
    for (const [k, v] of u.searchParams) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
      if (v.startsWith("in.")) rows = rows.filter((r) => v.slice(4, -1).split(",").includes(String(r[k])));
    }
    if (u.searchParams.get("order") === "start_at.desc") rows.sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
    const limit = Number(u.searchParams.get("limit"));
    if (limit) rows = rows.slice(0, limit);
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
  };

  const ob = requireCjs(path.join(repo, "netlify/functions/owner-bookings.js"));
  const cookie4 = sessionCookie(OWNER4.id).split(";")[0];
  const plain = JSON.parse((await ob.handler({ httpMethod: "GET", headers: { cookie: cookie4 }, queryStringParameters: {} })).body);
  ok("一覧は上限で打ち切られる（全件は返さない）", plain.bookings.length === 200 && !plain.bookings.some((b) => b.id === "bk-000"));
  const targeted = JSON.parse((await ob.handler({ httpMethod: "GET", headers: { cookie: cookie4 }, queryStringParameters: { id: "bk-000" } })).body);
  const hit = targeted.bookings.find((b) => b.id === "bk-000");
  ok("?id= 指定なら上限外の予約も含まれる（詳細画面が開ける）", Boolean(hit));
  ok("上限外の予約にも管理リンクが付く（キャンセル導線が出る）", Boolean(hit && hit.manage_url && hit.manage_url.includes("?k=")));
  const other = JSON.parse((await ob.handler({ httpMethod: "GET", headers: { cookie: cookie4 }, queryStringParameters: { id: "manual-xxx" } })).body);
  ok("存在しない id を渡しても一覧は壊れない", other.bookings.length === 200);
}

// ---------- 20) 相手一覧の並び替え（app.js sortBookingsFor） ----------
// 現状の一覧は「1行＝1予約」（顧客単位の集約は基盤刷新後）。予約行のままの並びを検証する。
section("contacts list sorting (app.js)");
{
  const sortRows = R.ctx.sortBookingsFor;
  const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const rows = [
    { visitor_name: "過去 太郎", start_at: iso(-3), created_at: iso(-10) },
    { visitor_name: "未来 花子", start_at: iso(5), created_at: iso(-2) },
    { visitor_name: "直近 次郎", start_at: iso(1), created_at: iso(-1) },
    { visitor_name: "手動 三郎", start_at: null, manual: true, created_at: iso(-4) },
    { visitor_name: "昨日 四郎", start_at: iso(-1), created_at: iso(-9) },
  ];
  const names = (mode) => sortRows(rows, mode).map((b) => b.visitor_name);

  ok("upcoming: これからの面談が近い順で先頭", names("upcoming").slice(0, 2).join(",") === "直近 次郎,未来 花子");
  ok("upcoming: 過ぎた面談は新しい順で後ろ", names("upcoming").slice(2, 4).join(",") === "昨日 四郎,過去 太郎");
  ok("upcoming: 面談日が無い相手（手動追加）は末尾", names("upcoming")[4] === "手動 三郎");
  ok("recent: 面談日の新しい順", names("recent").slice(0, 4).join(",") === "未来 花子,直近 次郎,昨日 四郎,過去 太郎");
  ok("oldest: 面談日の古い順", names("oldest").slice(0, 4).join(",") === "過去 太郎,昨日 四郎,直近 次郎,未来 花子");
  ok("oldest でも面談日が無い相手は末尾", names("oldest")[4] === "手動 三郎");
  ok("created: 登録が新しい順", names("created").join(",") === "直近 次郎,未来 花子,手動 三郎,昨日 四郎,過去 太郎");
  ok("並び替えは元の配列を壊さない", rows[0].visitor_name === "過去 太郎" && rows.length === 5);

  const byName = sortRows([
    { visitor_name: "", created_at: iso(-1) },
    { visitor_name: "さくら", created_at: iso(-2) },
    { visitor_name: "あおい", created_at: iso(-3) },
  ], "name").map((b) => b.visitor_name);
  ok("name: 名前順（空欄は末尾）", byName.join(",") === "あおい,さくら,");

  const broken = sortRows([
    { visitor_name: "壊れ 日付", start_at: "not-a-date", created_at: iso(-1) },
    { visitor_name: "正常", start_at: iso(2), created_at: iso(-2) },
  ], "upcoming").map((b) => b.visitor_name);
  ok("不正な日時は面談日なし扱いで末尾（一覧を壊さない）", broken.join(",") === "正常,壊れ 日付");
  ok("未知の並び順キーでも落ちない", Array.isArray(sortRows(rows, "unknown-mode")));
}

// ---------- 結果 ----------
console.log(`\n${fail === 0 ? "✅" : "❌"} unit: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
