const { json } = require("./_lib/response");
const { optional } = require("./_lib/config");
const { sb, findOwnerByEmail } = require("./_lib/supabase");
const { rawBody, verifySharedSecret } = require("./_lib/webhook");

// 議事録ツール等からの汎用 inbound Webhook（#24）。共有シークレット（定数時間）で認証し、面談メモ(appointment_logs)へ保存。
// MEETING_NOTES_WEBHOOK_SECRET 未設定なら無効（503・fail-closed）。外部サービス連携が決まるまでの汎用受け口。
// 注意: 認証はオーナー単位ではなく単一の共有シークレットのため、保有者は owner_email 指定で任意ホストにメモを書き込める。
//       将来は per-owner トークンへ移行すること（連携方式確定後）。

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  const secret = optional("MEETING_NOTES_WEBHOOK_SECRET", "");
  if (!secret) return json(503, { error: "議事録連携は設定されていません" });
  if (!verifySharedSecret(event, secret)) return json(401, { error: "認証が必要です" });

  try {
    const body = readJson(event);
    const ownerEmail = String(body.owner_email || "").trim().toLowerCase();
    const visitorEmail = String(body.visitor_email || body.guest_email || "").trim().toLowerCase();
    const notes = String(body.notes || body.summary || body.transcript || "").slice(0, 20000);
    if (!ownerEmail || !notes) return json(400, { error: "owner_email と notes（または summary/transcript）は必須です" });

    const owner = await findOwnerByEmail(ownerEmail);
    if (!owner) return json(404, { error: "該当するオーナーが見つかりません" });

    const rows = await sb("appointment_logs", {
      method: "POST",
      body: JSON.stringify({
        owner_id: owner.id,
        visitor_email: visitorEmail || "(議事録連携)",
        notes,
        keywords: String(body.keywords || "議事録").slice(0, 500),
        next_action: String(body.next_action || "").slice(0, 2000),
      }),
    });
    return json(200, { ok: true, log_id: rows[0]?.id || null });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
