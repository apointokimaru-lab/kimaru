const { json, readJson } = require("./_lib/response");
const { findOwnerByEmail } = require("./_lib/supabase");
const { timedToken } = require("./_lib/crypto");
const { appBaseUrl } = require("./_lib/config");
const { sendMail } = require("./_lib/mail");
const { checkRateLimit, clientIp } = require("./_lib/rate-limit");

// パスワード再設定の申請（#72）。メール列挙対策として、存在有無に関わらず常に 200 を返す。
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const body = readJson(event);
    const email = String(body.email || "").trim().toLowerCase();
    if (email) {
      // メールボム対策：レート超過時は送信を抑止しつつ、列挙対策のため常に 200 を返す（429 にしない）。
      const perEmail = await checkRateLimit({ bucket: "pwreset", ident: email, limit: 5, windowSec: 3600 });
      const perIp = await checkRateLimit({ bucket: "pwreset_ip", ident: clientIp(event), limit: 20, windowSec: 3600 });
      const owner = (perEmail.allowed && perIp.allowed) ? await findOwnerByEmail(email).catch(() => null) : null;
      // パスワード未設定（Googleのみ）アカウントには送らない。
      if (owner && owner.password_hash) {
        const ts = Date.now();
        const token = timedToken("pwreset", owner.id, ts);
        const link = `${appBaseUrl()}/reset-password.html?id=${encodeURIComponent(owner.id)}&ts=${ts}&t=${encodeURIComponent(token)}`;
        const text = [
          `${owner.name || ""}様`,
          "",
          "キマルのパスワード再設定のご依頼を受け付けました。",
          "下記のリンクから新しいパスワードを設定してください（1時間有効）。",
          "",
          link,
          "",
          "心当たりがない場合は、このメールは破棄してください。パスワードは変更されません。",
        ].join("\n");
        await sendMail({ to: owner.email, subject: "【キマル】パスワード再設定のご案内", text, category: "transactional" }).catch(() => null);
      }
    }
    return json(200, { ok: true });
  } catch (_) {
    return json(200, { ok: true });
  }
};
