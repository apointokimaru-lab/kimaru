const { json } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");

function hidePrivateBirthDate(booking) {
  if (!booking.visitor_birth_date_private) return booking;
  const sanitized = { ...booking, visitor_birth_date: null };
  if (!sanitized.filter_request || sanitized.filter_request === "none") return sanitized;
  try {
    const context = JSON.parse(sanitized.filter_request);
    if (context?.kind === "relationship_context") {
      sanitized.filter_request = JSON.stringify({ ...context, birth_date: "非公開", birth_date_private: true });
    }
  } catch (_) {
    // Keep the original text if old data is not JSON.
  }
  return sanitized;
}

// 予約履歴（相手レコード）の閲覧は無料にも開放（決定19・#182）。GETのみ・閲覧専用。
// 面談メモ・印象スコアの編集は Pro/Premium 限定（appointment-log 側で制限）。
// 手動追加の相手（manual_contacts・プレミアム）を予約レコードと同じ形にして相手一覧に混ぜる。
// 予約していない相手なので start_at は無し（一覧では日時「—」）。未マイグレーション環境では空配列。
function manualToBooking(row) {
  return {
    id: `manual-${row.id}`,
    visitor_name: row.name || "",
    visitor_email: row.email || "",
    topic: row.topic || "",
    start_at: null,
    manual: true,
    created_at: row.created_at,
  };
}

exports.handler = async (event) => {
  try {
    const owner = await requireOwner(event);
    const bookings = await sb(`bookings?owner_id=${eq(owner.id)}&order=start_at.desc&limit=50`);
    const manual = await sb(`manual_contacts?owner_id=${eq(owner.id)}&order=created_at.desc&limit=50`).catch(() => []);
    const list = [...(manual || []).map(manualToBooking), ...(bookings || []).map(hidePrivateBirthDate)];
    return json(200, { bookings: list });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
