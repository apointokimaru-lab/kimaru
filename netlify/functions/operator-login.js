const crypto = require("crypto");
const { json, readJson } = require("./_lib/response");
const { optional } = require("./_lib/config");
const { adminSessionCookie, clearAdminSessionCookie } = require("./_lib/crypto");
const { isCrossSiteRequest } = require("./_lib/csrf");

// 運営ログイン（ユーザーの /api/auth-login とは完全に別系統）。
// 共有管理キー ADMIN_SECRET を検証し、運営専用セッション kimaru_admin_session を発行する。
function timingEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  // 運営セッションもクロスサイトから発行させない（ユーザー側と同じログインCSRF対策）。
  if (isCrossSiteRequest(event)) return json(403, { error: "不正なリクエストです" });
  const body = readJson(event);

  if (body.action === "logout") {
    return json(200, { ok: true }, { "Set-Cookie": clearAdminSessionCookie() });
  }

  const secret = optional("ADMIN_SECRET", "");
  if (!secret) return json(500, { error: "運営ログインが未設定です（ADMIN_SECRET 未設定）。" });

  const key = String(body.key || "");
  if (!timingEqual(key, secret)) return json(401, { error: "管理者キーが違います。" });

  return json(200, { ok: true }, { "Set-Cookie": adminSessionCookie("shared") });
};
