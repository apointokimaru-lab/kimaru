const { json, readJson } = require("./_lib/response");
const { requirePremiumOwner } = require("./_lib/auth");
const { sb } = require("./_lib/supabase");

// 手動の相手追加（決定27・2026-06-19）。プレミアム限定。
// 予約していない相手も「相手一覧」に登録できる（owner-bookings がマージして返す）。
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requirePremiumOwner(event, "manual_contact");
    const body = readJson(event);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    if (!name && !email) return json(400, { error: "名前またはメールアドレスを入力してください" });
    const payload = {
      owner_id: owner.id,
      name,
      email,
      topic: String(body.topic || "").trim(),
      note: String(body.note || "").trim(),
    };
    const rows = await sb("manual_contacts", { method: "POST", body: JSON.stringify(payload) });
    return json(200, { ok: true, contact: rows[0] });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
