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

// ---------- 結果 ----------
console.log(`\n${fail === 0 ? "✅" : "❌"} unit: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
