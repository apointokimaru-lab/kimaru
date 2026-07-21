// OAuth 認可エンドポイント（MCPコネクタ用・決定31）。
// GET: パラメータ検証 → 未ログインなら /login.html?next= へ → プレミアム確認 → 同意画面を返す。
// POST: 同意画面からの許可/拒否 → 認可コードを redirect_uri へ 302。
// CSRF: 同意フォームには署名付き nonce（cookie ＋ hidden の二重）を要求する。
const crypto = require("crypto");
const { json, redirect } = require("./_lib/response");
const { currentOwner, isPremium } = require("./_lib/auth");
const { timedToken, verifyTimedToken } = require("./_lib/crypto");
const { verifyClientId, issueCode, SCOPE } = require("./_lib/mcp-oauth");
const { appBaseUrl } = require("./_lib/config");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function html(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...headers,
    },
    body,
  };
}

function page(title, inner) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | キマル</title><style>
  body{margin:0;font-family:"Zen Kaku Gothic New","Hiragino Sans",sans-serif;background:#fff;color:#191A1C;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
  .card{max-width:440px;width:100%;border:1px solid #E7E7E2;border-radius:14px;padding:28px;box-shadow:0 1px 2px rgba(25,26,28,.07),0 14px 32px -16px rgba(25,26,28,.24)}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.06em;color:#B23A22;margin:0 0 10px}
  h1{font-size:20px;margin:0 0 10px;line-height:1.4}
  p{color:#3C3E44;font-size:14px;line-height:1.7;margin:0 0 10px}
  ul{margin:10px 0 18px;padding-left:20px;color:#3C3E44;font-size:13.5px;line-height:1.8}
  .actions{display:flex;gap:10px;margin-top:18px}
  button,a.btn{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:46px;border-radius:999px;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;box-sizing:border-box}
  .approve{background:#DE4A2E;color:#fff;border:1.5px solid #DE4A2E}
  .deny{background:#fff;color:#3C3E44;border:1.5px solid #D8D8D2}
  .note{font-size:12px;color:#73757C;margin-top:14px}
  </style></head><body><div class="card">${inner}</div></body></html>`;
}

function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body || ""));
}

// redirect_uri へ返してよいのは client_id・redirect_uri の検証が済んだ後だけ（OAuth の鉄則）
function redirectWithParams(redirectUri, params) {
  const url = new URL(redirectUri);
  Object.entries(params).forEach(([key, value]) => { if (value != null && value !== "") url.searchParams.set(key, value); });
  return redirect(url.toString());
}

function validateClient(params) {
  const client = verifyClientId(params.client_id);
  if (!client) return { errorPage: page("接続エラー", `<p class="eyebrow">MCP CONNECT</p><h1>クライアントを確認できません</h1><p>client_id が不正です。AIクライアント側から接続をやり直してください。</p>`) };
  if (!client.r.includes(params.redirect_uri)) return { errorPage: page("接続エラー", `<p class="eyebrow">MCP CONNECT</p><h1>リダイレクト先が一致しません</h1><p>redirect_uri が登録内容と一致しないため中断しました。</p>`) };
  return { client };
}

exports.handler = async (event) => {
  const method = event.httpMethod;
  const params = method === "POST" ? parseForm(event.body) : (event.queryStringParameters || {});

  // client_id / redirect_uri が検証できない限り、redirect_uri へは何も返さない
  const { client, errorPage } = validateClient(params);
  if (errorPage) return html(400, errorPage);

  if (params.response_type !== "code" && method === "GET") {
    return redirectWithParams(params.redirect_uri, { error: "unsupported_response_type", state: params.state });
  }
  if (!params.code_challenge || (params.code_challenge_method || "S256") !== "S256") {
    return redirectWithParams(params.redirect_uri, { error: "invalid_request", error_description: "code_challenge (S256) is required", state: params.state });
  }

  const owner = await currentOwner(event);
  if (!owner) {
    // ログイン後に認可フローへ戻す（POST 中のセッション切れも GET の認可URLとして再開）
    const retryParams = new URLSearchParams({ response_type: "code", client_id: params.client_id, redirect_uri: params.redirect_uri, code_challenge: params.code_challenge, code_challenge_method: "S256" });
    if (params.state) retryParams.set("state", params.state);
    if (params.scope) retryParams.set("scope", params.scope);
    return redirect(`${appBaseUrl()}/login.html?next=${encodeURIComponent(`/api/mcp-auth?${retryParams}`)}`);
  }
  if (!isPremium(owner.plan)) {
    return html(403, page("プレミアム限定", `<p class="eyebrow">MCP CONNECT</p><h1>MCP連携はプレミアムプランの機能です</h1><p>AIコネクタ接続はプレミアムプラン（¥2,200/月）でご利用いただけます。</p><div class="actions"><a class="btn deny" href="${escapeHtml(appBaseUrl())}/plan.html">プランを見る</a></div>`));
  }

  const clientLabel = client.n || "AIクライアント";

  if (method === "POST") {
    // CSRF: hidden の署名付きトークン（nonce/ts/sig）を検証する。署名は owner.id に束縛するので
    // 別ユーザーのトークンでは通らない。Cookie に依存しないのは、OAuth コネクタ（claude.ai / ChatGPT）の
    // ポップアップ/リダイレクト遷移では Cookie 分割（パーティション）やパスの都合で同意 Cookie が POST 時に
    // 届かず「セッション切れ」になっていたため。クロスサイト POST 自体は kimaru_session(=Lax) が送出されず
    // owner=null で弾かれる（＝本来のCSRF防御はセッション Cookie 側が担っている）。
    const csrfOk = params.consent_nonce
      && verifyTimedToken("mcpconsent", `${params.consent_nonce}:${owner.id}`, params.consent_ts, params.consent_sig, 600000);
    if (!csrfOk) return html(400, page("接続エラー", `<p class="eyebrow">MCP CONNECT</p><h1>セッションの有効期限が切れました</h1><p>AIクライアント側から接続をやり直してください。</p>`));
    if (params.decision !== "approve") {
      return redirectWithParams(params.redirect_uri, { error: "access_denied", state: params.state });
    }
    const code = issueCode({ ownerId: owner.id, clientId: params.client_id, redirectUri: params.redirect_uri, codeChallenge: params.code_challenge, scope: params.scope || SCOPE });
    return redirectWithParams(params.redirect_uri, { code, state: params.state });
  }

  // GET: 同意画面。CSRF は Cookie ではなく hidden の署名付きトークン（owner.id 束縛）で担保する。
  const nonce = crypto.randomBytes(16).toString("base64url");
  const ts = Date.now();
  const sig = timedToken("mcpconsent", `${nonce}:${owner.id}`, ts);
  const hidden = (name, value) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value || "")}">`;
  const inner = `
    <p class="eyebrow">MCP CONNECT</p>
    <h1>「${escapeHtml(clientLabel)}」がキマルへの接続を求めています</h1>
    <p>${escapeHtml(owner.name || owner.email || "")} さんのアカウントで、次のデータの<strong>読み取りのみ</strong>を許可します：</p>
    <ul>
      <li>予約の一覧（ゲスト名・日時・トピック）</li>
      <li>相手の一覧と事前アンケート回答</li>
      <li>あなたのプロフィール</li>
    </ul>
    <form method="POST" action="/api/mcp-auth">
      ${hidden("client_id", params.client_id)}${hidden("redirect_uri", params.redirect_uri)}${hidden("state", params.state)}${hidden("code_challenge", params.code_challenge)}${hidden("code_challenge_method", "S256")}${hidden("scope", params.scope || SCOPE)}${hidden("consent_nonce", nonce)}${hidden("consent_ts", String(ts))}${hidden("consent_sig", sig)}
      <div class="actions">
        <button class="deny" type="submit" name="decision" value="deny">拒否</button>
        <button class="approve" type="submit" name="decision" value="approve">許可する</button>
      </div>
    </form>
    <p class="note">許可すると、接続したAIサービスにこれらのデータが送信されます。ai-assist の「URLを再発行」でいつでも全接続を無効化できます。</p>`;
  return html(200, page("接続の確認", inner));
};
