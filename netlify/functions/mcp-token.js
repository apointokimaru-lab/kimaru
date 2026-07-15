// MCP接続URLの取得（GET）と再発行（POST）。プレミアム限定（決定31）。
// トークンは owner id + owners.mcp_token_salt から HMAC 導出（DB保存しない）。
// POST は salt を更新して旧トークンを無効化する。mcp_token_salt 列が未適用の環境では
// GET は salt="" の固定トークンで動き、POST（再発行）だけがエラーになる（劣化動作）。
const crypto = require("crypto");
const { json } = require("./_lib/response");
const { requirePremiumOwner } = require("./_lib/auth");
const { mcpToken } = require("./_lib/crypto");
const { sb, eq } = require("./_lib/supabase");
const { appBaseUrl } = require("./_lib/config");

exports.handler = async (event) => {
  try {
    const owner = await requirePremiumOwner(event);

    if (event.httpMethod === "POST") {
      const salt = crypto.randomBytes(12).toString("base64url");
      try {
        await sb(`owners?id=${eq(owner.id)}`, { method: "PATCH", body: JSON.stringify({ mcp_token_salt: salt }) });
        owner.mcp_token_salt = salt;
      } catch (_) {
        return json(409, { error: "再発行にはデータベース更新（owners.mcp_token_salt）が必要です。supabase-schema.sql を適用してください。" });
      }
    } else if (event.httpMethod !== "GET") {
      return json(405, { error: "許可されていない操作です" });
    }

    const token = mcpToken(owner.id, owner.mcp_token_salt || "");
    const endpoint = `${appBaseUrl()}/api/mcp`;
    return json(200, { endpoint, token, url: `${endpoint}?t=${encodeURIComponent(token)}` });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
