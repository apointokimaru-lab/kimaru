// MCP の OAuth 2.1 対応（決定31 次段）。ChatGPT / claude.ai のコネクタが
// .well-known で発見 → 動的クライアント登録（RFC 7591）→ PKCE 認可コード → トークン交換、
// の順で「ログインと許可だけ」で接続できるようにする。
// 全トークンは signBlob によるステートレス署名（DB テーブル不要）。
// アクセス/リフレッシュトークンは owners.mcp_token_salt に束縛し、
// ai-assist.html の「URLを再発行」で OAuth 接続もまとめて失効する。
// 制約（ステートレスの割り切り）: 認可コードの一回使用は追跡しない（10分期限＋PKCE で緩和）。
const crypto = require("crypto");
const { signBlob, verifyBlob } = require("./crypto");
const { appBaseUrl } = require("./config");

const ACCESS_TTL_MS = 30 * 86400000; // 30日
const REFRESH_TTL_MS = 180 * 86400000; // 180日
const CODE_TTL_MS = 10 * 60000; // 認可コード10分

const SCOPE = "kimaru:read";

// クライアント登録はステートレス：登録内容（redirect_uris・名前）を署名して client_id にする。
function issueClientId({ redirectUris, clientName }) {
  return signBlob("mcpclient", { r: redirectUris, n: clientName || "" });
}

function verifyClientId(clientId) {
  const data = verifyBlob("mcpclient", clientId, null);
  return data && Array.isArray(data.r) && data.r.length ? data : null;
}

function clientHash(clientId) {
  return crypto.createHash("sha256").update(String(clientId)).digest("base64url").slice(0, 22);
}

function issueCode({ ownerId, clientId, redirectUri, codeChallenge, scope }) {
  return signBlob("mcpcode", { o: ownerId, c: clientHash(clientId), r: redirectUri, cc: codeChallenge, sc: scope || SCOPE });
}

function verifyCode(code) {
  return verifyBlob("mcpcode", code, CODE_TTL_MS);
}

function verifyPkce(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  return crypto.createHash("sha256").update(String(codeVerifier)).digest("base64url") === String(codeChallenge);
}

function issueTokens(owner) {
  const bind = { o: owner.id, k: owner.mcp_token_salt || "" };
  return {
    access_token: signBlob("mcpaccess", bind),
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: signBlob("mcprefresh", bind),
    scope: SCOPE,
  };
}

function verifyAccessToken(token) {
  return verifyBlob("mcpaccess", token, ACCESS_TTL_MS);
}

function verifyRefreshToken(token) {
  return verifyBlob("mcprefresh", token, REFRESH_TTL_MS);
}

function isValidRedirectUri(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (_) {
    return false;
  }
  if (url.protocol === "https:") return true;
  // ネイティブクライアント（Claude Desktop 等）の loopback リダイレクトは http を許可（OAuth 2.1）
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

// RFC 9728（保護リソースメタデータ）: MCPクライアントはここから認可サーバを発見する
function metadataResource() {
  const base = appBaseUrl();
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
}

// RFC 8414（認可サーバメタデータ）
function metadataServer() {
  const base = appBaseUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/mcp-auth`,
    token_endpoint: `${base}/api/mcp-oauth-token`,
    registration_endpoint: `${base}/api/mcp-oauth-register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

module.exports = { SCOPE, issueClientId, verifyClientId, clientHash, issueCode, verifyCode, verifyPkce, issueTokens, verifyAccessToken, verifyRefreshToken, isValidRedirectUri, metadataResource, metadataServer };
