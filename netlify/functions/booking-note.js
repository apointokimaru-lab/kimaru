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

// 手動追加の相手（manual_contacts）。相手一覧では id="manual-<uuid>" で表現されるため prefix で判定する。
const MANUAL_PREFIX = "manual-";
async function ownsManualContact(ownerId, manualId) {
  const rows = await sb(`manual_contacts?id=${eq(manualId)}&owner_id=${eq(ownerId)}&select=id&limit=1`).catch(() => []);
  return !!(rows && rows[0]);
}

exports.handler = async (event) => {
  try {
    const owner = await requireProOwner(event);

    if (event.httpMethod === "GET") {
      const bookingId = String(event.queryStringParameters?.booking_id || "").trim();
      if (!bookingId) {
        // 会話記録のある相手ID一覧（相手一覧のバッジ用）。手動相手は "manual-<uuid>" で返す。
        // manual_contact_id 列が未適用の環境では booking_id のみの select にフォールバック。
        let rows;
        try {
          rows = await sb(`booking_notes?owner_id=${eq(owner.id)}&select=booking_id,manual_contact_id`);
        } catch (_) {
          rows = await sb(`booking_notes?owner_id=${eq(owner.id)}&select=booking_id`).catch(() => []);
        }
        const ids = [];
        (rows || []).forEach((r) => {
          if (r.booking_id) ids.push(r.booking_id);
          if (r.manual_contact_id) ids.push(`${MANUAL_PREFIX}${r.manual_contact_id}`);
        });
        return json(200, { booking_ids: ids });
      }
      const isManualGet = bookingId.startsWith(MANUAL_PREFIX);
      const keyGet = isManualGet ? `manual_contact_id=${eq(bookingId.slice(MANUAL_PREFIX.length))}` : `booking_id=${eq(bookingId)}`;
      const rows = await sb(`booking_notes?${keyGet}&owner_id=${eq(owner.id)}&limit=1`).catch(() => []);
      return json(200, { note: (rows && rows[0]) || null });
    }

    if (event.httpMethod === "POST") {
      const body = readJson(event);
      const bookingId = String(body.booking_id || "").trim();
      if (!bookingId) return json(400, { error: "相手が指定されていません" });
      const isManual = bookingId.startsWith(MANUAL_PREFIX);
      const manualId = isManual ? bookingId.slice(MANUAL_PREFIX.length) : null;
      const owned = isManual ? await ownsManualContact(owner.id, manualId) : await ownsBooking(owner.id, bookingId);
      if (!owned) return json(404, { error: "対象の相手が見つかりません" });

      const scores = {};
      TRAITS.forEach((k) => { if (body[k] != null && body[k] !== "") scores[k] = clampScore(body[k]); });
      const payload = {
        owner_id: owner.id,
        ...(isManual ? { manual_contact_id: manualId, booking_id: null } : { booking_id: bookingId }),
        notes: String(body.notes || "").slice(0, 4000),
        next_action: String(body.next_action || "").slice(0, 2000),
        keywords: String(body.keywords || "").slice(0, 500),
        scores,
        updated_at: new Date().toISOString(),
      };
      // 既存なら PATCH、無ければ POST（booking_id / manual_contact_id ともに unique）。
      const keyPost = isManual ? `manual_contact_id=${eq(manualId)}` : `booking_id=${eq(bookingId)}`;
      const existing = await sb(`booking_notes?${keyPost}&owner_id=${eq(owner.id)}&select=id&limit=1`).catch(() => []);
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
