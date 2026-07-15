// OAuth 動的クライアント登録（RFC 7591）。ChatGPT / claude.ai のコネクタが自動で叩く。
// 登録はステートレス：redirect_uris と名前を署名して client_id に埋め込む（DB 不要）。
const { json, readJson } = require("./_lib/response");
const { issueClientId, isValidRedirectUri } = require("./_lib/mcp-oauth");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "invalid_request" }, CORS);
  const body = readJson(event);
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.slice(0, 5).map(String) : [];
  if (!redirectUris.length || !redirectUris.every(isValidRedirectUri)) {
    return json(400, { error: "invalid_redirect_uri", error_description: "redirect_uris must be https URLs (or http on localhost)" }, CORS);
  }
  const clientName = String(body.client_name || "").slice(0, 100);
  return json(201, {
    client_id: issueClientId({ redirectUris, clientName }),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }, CORS);
};
