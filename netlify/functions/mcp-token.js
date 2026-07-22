// MCP接続情報の取得（GET）と「すべての接続を解除」（POST）。プレミアム限定（決定31）。
// GET はコネクタ接続用エンドポイント（OAuth）を返す。POST は owners.mcp_token_salt を更新して、
// 発行済みの OAuth アクセス/リフレッシュトークンを全て失効させる（AIクライアントの再接続が必要）。
// 認証は OAuth のみ（URLにトークンを載せるパーソナルトークン方式はセキュリティ上廃止）。
const crypto = require("crypto");
const { json } = require("./_lib/response");
const { requirePremiumOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { appBaseUrl } = require("./_lib/config");

exports.handler = async (event) => {
  try {
    const owner = await requirePremiumOwner(event);

    if (event.httpMethod === "POST") {
      // salt を更新＝発行済みの全 OAuth 接続を失効させる（「すべての接続を解除」）。
      const salt = crypto.randomBytes(12).toString("base64url");
      try {
        await sb(`owners?id=${eq(owner.id)}`, { method: "PATCH", body: JSON.stringify({ mcp_token_salt: salt }) });
        owner.mcp_token_salt = salt;
      } catch (_) {
        return json(409, { error: "接続解除にはデータベース更新（owners.mcp_token_salt）が必要です。supabase-schema.sql を適用してください。" });
      }
    } else if (event.httpMethod !== "GET") {
      return json(405, { error: "許可されていない操作です" });
    }

    return json(200, { endpoint: `${appBaseUrl()}/api/mcp` });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
