const { json } = require("./_lib/response");
const { optional } = require("./_lib/config");
const { addEmailSuppression } = require("./_lib/supabase");
const { rawBody, verifySvixSignature, verifySharedSecret } = require("./_lib/webhook");

// Resend の配信イベント Webhook（決定13: 苦情率0.3%未満維持＋自動サプレッション）。
// bounce / complaint(spam) を受け取った宛先を配信停止リストに登録し、以後の営業メールを止める。
// 認証：Svix 署名（whsec_ シークレット）を生ボディで検証。無ければ共有シークレット（定数時間）にフォールバック。
// RESEND_WEBHOOK_SECRET 未設定なら fail-closed（503）。未設定時に無認証受理すると任意宛先の配信停止を偽装できるため閉じる。

function extractEmail(data) {
  if (!data) return "";
  const candidate = data.email || data.recipient || (Array.isArray(data.to) ? data.to[0] : data.to) || "";
  return String(candidate || "").trim().toLowerCase();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });

  const secret = optional("RESEND_WEBHOOK_SECRET", "");
  if (!secret) return json(503, { error: "Webhookが設定されていません" });
  const raw = rawBody(event);
  if (!verifySvixSignature(event, raw, secret) && !verifySharedSecret(event, secret)) {
    return json(401, { error: "認証が必要です" });
  }

  try {
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
    const type = String(body.type || body.event_type || "").toLowerCase();
    const email = extractEmail(body.data || body);

    let reason = "";
    if (/bounce/.test(type)) reason = "bounce";
    else if (/complain|spam/.test(type)) reason = "complaint";

    if (email && reason) {
      await addEmailSuppression(email, reason).catch(() => null);
    }
    return json(200, { ok: true, suppressed: Boolean(email && reason), reason: reason || null });
  } catch (error) {
    return json(200, { ok: true, suppressed: false });
  }
};
