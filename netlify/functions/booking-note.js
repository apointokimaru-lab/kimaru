const { json, readJson } = require("./_lib/response");
const { requireProOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");

// 会話記録（Pro）: 相手一覧の各行(=予約1回)と1対1。GET で取得、POST で booking_id 単位に upsert。
// booking_notes テーブル/列が未マイグレーションの環境では GET は空・POST はエラーで返す（他機能は壊さない）。

const TRAITS = [
  "trait_first_impression", "trait_speaking", "trait_listening", "trait_proactive", "trait_giver",
  "trait_positive", "trait_logical", "trait_empathy", "trait_decisive", "trait_referral",
];

function clampScore(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

async function ownsBooking(ownerId, bookingId) {
  const rows = await sb(`bookings?id=${eq(bookingId)}&owner_id=${eq(ownerId)}&select=id&limit=1`).catch(() => []);
  return !!(rows && rows[0]);
}

exports.handler = async (event) => {
  try {
    const owner = await requireProOwner(event);

    if (event.httpMethod === "GET") {
      const bookingId = String(event.queryStringParameters?.booking_id || "").trim();
      if (!bookingId) {
        // 会話記録のある予約IDの一覧（相手一覧のバッジ用）。テーブル未作成なら空。
        const rows = await sb(`booking_notes?owner_id=${eq(owner.id)}&select=booking_id`).catch(() => []);
        return json(200, { booking_ids: (rows || []).map((r) => r.booking_id).filter(Boolean) });
      }
      const rows = await sb(`booking_notes?booking_id=${eq(bookingId)}&owner_id=${eq(owner.id)}&limit=1`).catch(() => []);
      return json(200, { note: (rows && rows[0]) || null });
    }

    if (event.httpMethod === "POST") {
      const body = readJson(event);
      const bookingId = String(body.booking_id || "").trim();
      if (!bookingId) return json(400, { error: "予約が指定されていません" });
      if (!(await ownsBooking(owner.id, bookingId))) return json(404, { error: "対象の予約が見つかりません" });

      const scores = {};
      TRAITS.forEach((k) => { if (body[k] != null && body[k] !== "") scores[k] = clampScore(body[k]); });
      const payload = {
        owner_id: owner.id,
        booking_id: bookingId,
        notes: String(body.notes || "").slice(0, 4000),
        next_action: String(body.next_action || "").slice(0, 2000),
        keywords: String(body.keywords || "").slice(0, 500),
        scores,
        updated_at: new Date().toISOString(),
      };
      // 既存なら PATCH、無ければ POST（booking_id は unique）。
      const existing = await sb(`booking_notes?booking_id=${eq(bookingId)}&owner_id=${eq(owner.id)}&select=id&limit=1`).catch(() => []);
      const rows = (existing && existing[0])
        ? await sb(`booking_notes?id=${eq(existing[0].id)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await sb("booking_notes", { method: "POST", body: JSON.stringify(payload) });
      return json(200, { ok: true, note: rows[0] });
    }

    return json(405, { error: "許可されていない操作です" });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
