const { json, readJson } = require("./_lib/response");
const { sb, eq, findOwnerByEmail } = require("./_lib/supabase");
const { sessionCookie, hashPassword, timedToken } = require("./_lib/crypto");
const { appBaseUrl } = require("./_lib/config");
const { sendMail } = require("./_lib/mail");
const { isCrossSiteRequest } = require("./_lib/csrf");

// メール確認メール（任意・非ブロッキング）。確認しなくても利用可。送信失敗は無視。
async function sendVerifyEmail(owner) {
  try {
    const ts = Date.now();
    const token = timedToken("emailverify", owner.id, ts);
    const link = `${appBaseUrl()}/api/verify-email?id=${encodeURIComponent(owner.id)}&ts=${ts}&t=${encodeURIComponent(token)}`;
    const text = `${owner.name || ""}様\n\nキマルへのご登録ありがとうございます。\n下記のリンクからメールアドレスをご確認ください（任意・7日間有効）。\n\n${link}`;
    await sendMail({ to: owner.email, subject: "【キマル】メールアドレスのご確認", text, category: "transactional" });
  } catch (_) {
    // 確認メール送信失敗は登録自体を妨げない。
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max = 254) {
  return String(value || "").trim().slice(0, max);
}

function makeSlug(email) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "user";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

// メール+パスワードでアカウント登録（決定3）。ログインとカレンダー連携は分離（[features/25]）。
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    // 登録も成功時にセッションを発行するので、ログインCSRFと同じ経路で悪用できる。
    if (isCrossSiteRequest(event)) return json(403, { error: "不正なリクエストです" });
    const body = readJson(event);
    const name = clean(body.name, 100);
    const email = clean(body.email).toLowerCase();
    const password = String(body.password || "");
    if (!email || !EMAIL_RE.test(email)) return json(400, { error: "メールアドレスの形式が正しくありません" });
    if (password.length < 8) return json(400, { error: "パスワードは8文字以上にしてください" });

    const existing = await findOwnerByEmail(email);
    if (existing && existing.password_hash) return json(409, { error: "このメールアドレスは既に登録済みです" });

    const passwordHash = hashPassword(password);
    let owner;
    if (existing) {
      // Google等で作成済みのアカウントにパスワードを設定（ログイン方式の追加）
      const rows = await sb(`owners?id=${eq(existing.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ password_hash: passwordHash, name: name || existing.name }),
      });
      owner = rows[0];
    } else {
      const rows = await sb("owners", {
        method: "POST",
        body: JSON.stringify({ email, name, plan: "free", slug: makeSlug(email), password_hash: passwordHash }),
      });
      owner = rows[0];
    }
    await sendVerifyEmail(owner);
    return json(200, { ok: true, owner: { id: owner.id, email: owner.email, name: owner.name, plan: owner.plan } }, { "Set-Cookie": sessionCookie(owner.id) });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
