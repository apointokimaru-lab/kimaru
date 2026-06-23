const { json, readJson } = require("./_lib/response");
const { sb } = require("./_lib/supabase");
const { checkRateLimit, clientIp, RATE_LIMIT_MESSAGE } = require("./_lib/rate-limit");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const body = readJson(event);
    const name = clean(body.name, 100);
    const email = clean(body.email, 254).toLowerCase();
    const language = clean(body.language || "ja", 20);
    if (!name || !email) return json(400, { error: "お名前とメールアドレスは必須です" });
    if (!EMAIL_RE.test(email)) return json(400, { error: "メールアドレスの形式が正しくありません" });
    if (!LANGUAGE_RE.test(language)) return json(400, { error: "言語の指定が正しくありません" });

    // 待機リストへのスパム投稿抑止（IP別）。
    const rl = await checkRateLimit({ bucket: "signup_ip", ident: clientIp(event), limit: 10, windowSec: 3600 });
    if (!rl.allowed) return json(429, { error: RATE_LIMIT_MESSAGE });

    const rows = await sb("free_signups", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        purpose: clean(body.purpose, 2000),
        invite_code: clean(body.invite_code, 80),
        language,
      }),
    });
    return json(200, { ok: true, signup: rows[0] });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
