// OAuth メタデータ（/.well-known/* → netlify.toml のリダイレクトでここに来る）。
// MCPクライアントの自動発見用（RFC 9728 / RFC 8414）。認証不要・CORS 許可。
const { json } = require("./_lib/response");
const { metadataResource, metadataServer } = require("./_lib/mcp-oauth");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version" };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const path = event.path || "";
  const doc = (event.queryStringParameters && event.queryStringParameters.doc) ||
    (path.includes("authorization-server") ? "server" : path.includes("protected-resource") ? "resource" : "");
  if (doc === "server") return json(200, metadataServer(), CORS);
  if (doc === "resource") return json(200, metadataResource(), CORS);
  return json(404, { error: "unknown metadata document" }, CORS);
};
