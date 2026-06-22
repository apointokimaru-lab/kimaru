const { json, readJson } = require("./_lib/response");
const { findOwnerByEmail } = require("./_lib/supabase");
const { sessionCookie, verifyPassword } = require("./_lib/crypto");
const { checkRateLimit, clientIp, RATE_LIMIT_MESSAGE } = require("./_lib/rate-limit");

// メール+パスワードでログイン（決定3）。
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const body = readJson(event);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json(400, { error: "メールアドレスとパスワードを入力してください" });

    // ブルートフォース対策：メール別＋IP別のレート制限（どちらか超過で 429）。
    const perEmail = await checkRateLimit({ bucket: "login", ident: email, limit: 8, windowSec: 600 });
    const perIp = await checkRateLimit({ bucket: "login_ip", ident: clientIp(event), limit: 40, windowSec: 600 });
    if (!perEmail.allowed || !perIp.allowed) return json(429, { error: RATE_LIMIT_MESSAGE });

    const owner = await findOwnerByEmail(email);
    if (!owner || !owner.password_hash || !verifyPassword(password, owner.password_hash)) {
      return json(401, { error: "メールアドレスまたはパスワードが違います" });
    }
    // 利用停止アカウントはログイン不可（セッションを発行しない）。
    if (owner.cat_key_disabled) {
      return json(403, { error: "このアカウントは現在ご利用いただけません。運営にお問い合わせください。" });
    }
    return json(200, { ok: true, owner: { id: owner.id, email: owner.email, name: owner.name, plan: owner.plan } }, { "Set-Cookie": sessionCookie(owner.id) });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
