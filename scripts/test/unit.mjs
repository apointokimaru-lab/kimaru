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

const { mcpToken, sessionCookie } = requireCjs(path.join(repo, "netlify/functions/_lib/crypto.js"));
const mcp = requireCjs(path.join(repo, "netlify/functions/mcp.js"));
const mcpTokenFn = requireCjs(path.join(repo, "netlify/functions/mcp-token.js"));
const validToken = mcpToken(OWNER.id, OWNER.mcp_token_salt);
const rpc = async (message, token) => {
  const res = await mcp.handler({ httpMethod: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, queryStringParameters: {}, body: JSON.stringify(message) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

ok("no token → 401", (await rpc(init)).status === 401);
ok("bad token → 401", (await rpc(init, mcpToken(OWNER.id, "wrong-salt"))).status === 401);
ok("free plan → 403", (await rpc(init, mcpToken(FREE_OWNER.id, ""))).status === 403);
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

// mcp-token.js: セッションCookieで接続URLを取得（premium のみ）
const cookie = sessionCookie(OWNER.id).split(";")[0];
const tokenRes = await mcpTokenFn.handler({ httpMethod: "GET", headers: { cookie }, queryStringParameters: {} });
const tokenBody = JSON.parse(tokenRes.body);
ok("mcp-token GET returns personal connect URL", tokenRes.statusCode === 200 && tokenBody.url.includes("/api/mcp?t=") && tokenBody.token === validToken);
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
ok("authorize (premium) → consent page with client name", consentRes.statusCode === 200 && consentRes.body.includes("TestGPT") && String(consentRes.headers["Set-Cookie"]).includes("kimaru_mcp_consent="));
const consentCookieValue = String(consentRes.headers["Set-Cookie"]).split(";")[0];
const consentNonce = consentCookieValue.split("=")[1].split(":")[0];

const approveBody = new URLSearchParams({ ...authQuery, consent_nonce: consentNonce, decision: "approve" }).toString();
const approveRes = await authFn.handler({ httpMethod: "POST", headers: { cookie: `${cookie}; ${consentCookieValue}` }, body: approveBody });
const approveLoc = approveRes.statusCode === 302 ? new URL(approveRes.headers.Location) : null;
ok("consent approve → 302 to redirect_uri with code + state", !!approveLoc && approveLoc.origin + approveLoc.pathname === REDIRECT && !!approveLoc.searchParams.get("code") && approveLoc.searchParams.get("state") === "st4te");
const noCsrf = await authFn.handler({ httpMethod: "POST", headers: { cookie }, body: approveBody });
ok("consent POST without CSRF cookie → 400", noCsrf.statusCode === 400);

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

// ---------- 結果 ----------
console.log(`\n${fail === 0 ? "✅" : "❌"} unit: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
