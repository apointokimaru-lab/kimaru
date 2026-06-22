// 認証ミドルウェア（Netlify Edge Function）
// 1) 未ログイン/無効セッションでアプリページ → /login.html、運営ページ → /operator-login.html（ルート保護）
// 2) すべてのHTMLの <body> に data-auth="authed|guest" を注入 → CSSでナビ等を出し分け（チラつき無し）
// 3) 共通ヘッダー <!-- site-header --> / 共通フッター <!-- site-footer --> を注入
//
// 判定は Cookie の「署名＋有効期限」を検証する（サーバ側 _lib/crypto.js と同方式）。
// これにより、別 SESSION_SECRET / 期限切れ / 改ざんの Cookie は guest 扱いとなり、
// 「Cookie はあるが API は未ログイン扱い」という宙ぶらり状態を入口で解消する。
// 無効 Cookie はリダイレクト時に Set-Cookie で消去する。
// ユーザー用 kimaru_session と 運営用 kimaru_admin_session は完全に別系統。

// ユーザー向け要ログイン画面（docs/screen-flow.md：無登録=−）
const PROTECTED_PATHS = [
  "/dashboard.html",
  "/contacts.html",
  "/booking-settings.html",
  "/profile.html",
  "/ai-assist.html",
  "/settings.html",
  "/square.html",
  "/schedule.html",
  "/answers.html",
  "/meeting.html",
];

// 運営向け画面：運営セッション（kimaru_admin_session）が必須。ユーザーログインとは無関係。
const OPERATOR_PATHS = [
  "/cat-key-admin.html",
  "/operators.html",
];

// 共通ヘッダー（単一ソース）。各ページの目印 <!-- site-header --> をこれで置換する。
// 表示の出し分けは body[data-auth] + CSS（.app-only / .guest-only）が担当。
// 朱印ヘッダー。ナビ表示は body[data-auth]（.app-only/.guest-only）が担当。
// <900px は CSS のみのハンバーガー（#km-nav-toggle チェックボックスハック）で開閉する（JSなし）。
const SITE_HEADER = `<header class="site-header">
    <a class="brand" href="/" data-i18n="common.brand"><span class="brand-dot"></span>キマル</a>
    <input type="checkbox" id="km-nav-toggle">
    <label class="nav-burger" for="km-nav-toggle" aria-label="Menu"><span></span><span></span><span></span></label>
    <nav>
      <a class="guest-only" href="/plan.html" data-i18n="nav.pricing">料金</a>
      <a class="guest-only" href="/signup.html" data-i18n="nav.signup">無料登録</a>
      <a class="guest-only" href="/login.html" data-i18n="nav.signin">ログイン</a>
      <a class="app-only" href="/dashboard.html" data-i18n="nav.dashboard">ホーム</a>
      <a class="app-only" href="/booking-settings.html" data-i18n="nav.bookingSettings">予約設定</a>
      <a class="app-only" href="/profile.html" data-i18n="nav.profile">プロフィール設定</a>
      <a class="app-only" href="/contacts.html" data-i18n="nav.admin">相手管理</a>
      <a class="app-only" href="/ai-assist.html" data-i18n="nav.aiAssist">AIアシスト</a>
      <a class="app-only" href="/settings.html" data-i18n="nav.settings">設定</a>
      <select class="lang-select" data-language-select aria-label="Language"></select>
      <a class="app-only nav-avatar" href="/settings.html" aria-hidden="true">キ</a>
    </nav>
  </header>`;

// 共通フッター（法務リンク・全ページ共通）。目印 <!-- site-footer --> を置換。
const SITE_FOOTER = `<footer class="foot footer">
    <div class="foot-in">
      <nav class="footer-nav">
        <a href="/terms.html" data-i18n="footer.terms">利用規約</a>
        <a href="/privacy.html" data-i18n="footer.privacy">プライバシーポリシー</a>
        <a href="/tokushoho.html" data-i18n="footer.tokushoho">特定商取引法に基づく表記</a>
      </nav>
      <p class="footer-copy" data-i18n="footer.copy">© 2026 キマル</p>
    </div>
  </footer>`;

const SESSION_MAX_AGE_MS = 2592000 * 1000; // 30日（Cookie の Max-Age と一致）

function getSecret() {
  try {
    if (globalThis.Netlify?.env?.get) return globalThis.Netlify.env.get("SESSION_SECRET") || "";
  } catch (_) { /* noop */ }
  try {
    if (globalThis.Deno?.env?.get) return globalThis.Deno.env.get("SESSION_SECRET") || "";
  } catch (_) { /* noop */ }
  return "";
}

function readCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : "";
}

function bytesToBase64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacBase64url(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64url(new Uint8Array(sig));
}

function decodePayload(payload) {
  try {
    let b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(atob(b64));
  } catch (_) {
    return null;
  }
}

// Cookie の署名＋有効期限を検証（サーバ側 _lib/crypto.js と同方式）。
// 秘密鍵が取得できない異常時のみ、存在ベースにフォールバック（可用性優先）。
async function verifyCookie(request, name, mustBeAdmin) {
  const raw = readCookie(request, name);
  if (!raw || !raw.includes(".")) return false;
  const secret = getSecret();
  if (!secret) return true; // フォールバック：鍵未設定時は存在を認証扱い
  const [payload, signature] = raw.split(".");
  const expected = await hmacBase64url(payload, secret);
  if (signature !== expected) return false;
  const data = decodePayload(payload);
  if (!data || !data.ts || (Date.now() - data.ts) > SESSION_MAX_AGE_MS) return false;
  if (mustBeAdmin && data.admin !== true) return false;
  return true;
}

// 無効 Cookie を消去しつつリダイレクト（Cookie が存在する場合のみ Set-Cookie を付ける）。
function redirectClearing(location, request, clearName) {
  const headers = new Headers({ Location: location });
  if (readCookie(request, clearName)) {
    headers.append("Set-Cookie", `${clearName}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
  }
  return new Response(null, { status: 302, headers });
}

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const authed = await verifyCookie(request, "kimaru_session", false);
  const operator = await verifyCookie(request, "kimaru_admin_session", true);

  // ① 運営ページの保護（ユーザーログインではなく運営セッションを要求）
  if (OPERATOR_PATHS.includes(path) && !operator) {
    const loginUrl = new URL("/operator-login.html", url.origin);
    loginUrl.searchParams.set("next", path);
    return redirectClearing(loginUrl.toString(), request, "kimaru_admin_session");
  }

  // ② ユーザーアプリページの保護
  if (PROTECTED_PATHS.includes(path) && !authed) {
    const loginUrl = new URL("/login.html", url.origin);
    loginUrl.searchParams.set("next", path);
    return redirectClearing(loginUrl.toString(), request, "kimaru_session");
  }

  // ③ HTMLに認証状態・共通ヘッダー・共通フッターを注入
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const original = await response.text();
  let html = original.replace(/<body(?=[\s>])/i, `<body data-auth="${authed ? "authed" : "guest"}"`);
  if (html.includes("<!-- site-header -->")) {
    html = html.replace("<!-- site-header -->", SITE_HEADER);
  }
  if (html.includes("<!-- site-footer -->")) {
    html = html.replace("<!-- site-footer -->", SITE_FOOTER);
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, { status: response.status, headers });
};

export const config = {
  path: "/*",
  excludedPath: [
    "/api/*",
    "/.netlify/*",
    "/*.css",
    "/*.js",
    "/*.png",
    "/*.jpg",
    "/*.jpeg",
    "/*.svg",
    "/*.ico",
    "/*.webp",
    "/*.woff",
    "/*.woff2",
    "/*.json",
    "/*.txt",
    "/*.xml",
  ],
};
