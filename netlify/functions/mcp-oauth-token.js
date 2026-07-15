// OAuth トークンエンドポイント（MCPコネクタ用・決定31）。public client（auth method "none"）前提。
// authorization_code（PKCE S256 必須）と refresh_token の2グラント。
// トークンは owners.mcp_token_salt に束縛：ai-assist の「URLを再発行」で全接続が失効する。
const { json, readJson } = require("./_lib/response");
const { findOwnerById } = require("./_lib/supabase");
const { isPremium } = require("./_lib/auth");
const { verifyClientId, clientHash, verifyCode, verifyPkce, issueTokens, verifyRefreshToken } = require("./_lib/mcp-oauth");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function parseBody(event) {
  const type = String(event.headers["content-type"] || event.headers["Content-Type"] || "");
  if (type.includes("application/json")) return readJson(event);
  return Object.fromEntries(new URLSearchParams(event.body || ""));
}

const oauthError = (error, description) => json(400, { error, ...(description ? { error_description: description } : {}) }, CORS);

async function premiumOwnerOrNull(ownerId, salt) {
  const owner = await findOwnerById(ownerId).catch(() => null);
  if (!owner || owner.cat_key_disabled || !isPremium(owner.plan)) return null;
  if (salt != null && (owner.mcp_token_salt || "") !== salt) return null; // 再発行済み＝失効
  return owner;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "invalid_request" }, CORS);
  const params = parseBody(event);

  if (params.grant_type === "authorization_code") {
    const client = verifyClientId(params.client_id);
    if (!client) return oauthError("invalid_client");
    const code = verifyCode(params.code);
    if (!code) return oauthError("invalid_grant", "authorization code is invalid or expired");
    if (code.c !== clientHash(params.client_id)) return oauthError("invalid_grant", "code was issued to another client");
    if (code.r !== params.redirect_uri) return oauthError("invalid_grant", "redirect_uri mismatch");
    if (!verifyPkce(params.code_verifier, code.cc)) return oauthError("invalid_grant", "PKCE verification failed");
    const owner = await premiumOwnerOrNull(code.o, null);
    if (!owner) return oauthError("invalid_grant", "account is not eligible");
    return json(200, issueTokens(owner), CORS);
  }

  if (params.grant_type === "refresh_token") {
    const data = verifyRefreshToken(params.refresh_token);
    if (!data) return oauthError("invalid_grant", "refresh token is invalid or expired");
    const owner = await premiumOwnerOrNull(data.o, data.k);
    if (!owner) return oauthError("invalid_grant", "token has been revoked");
    return json(200, issueTokens(owner), CORS);
  }

  return oauthError("unsupported_grant_type");
};
