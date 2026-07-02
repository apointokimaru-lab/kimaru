const { sb, eq, findOwnerById } = require("./supabase");

// アカウント完全削除（退会＝物理削除）の共通処理。運営コンソール(invite-apply.js の
// admin delete)とユーザー自身の退会(account-delete.js)の両方から呼ぶ。
//
// owners は多くの子テーブルから `on delete cascade` で参照されているため、
// 本来は owners を消せば予約・相手管理・連携などは連鎖削除される。ただし本プロジェクトは
// マイグレーションが遅延しがちで DB 間で制約が食い違う可能性があるため（CLAUDE.md の
// graceful-degrade 方針）、子テーブルを best-effort で明示削除してから owners を消し、
// どの環境でも孤児データを残さないようにする。
// 監査ログ(cat_key_events)と決済履歴(payment_events)は `on delete set null` で保持する。

// PostgREST の in.(...) フィルタ。値は uuid（安全文字のみ）想定。
const inList = (ids) => `in.(${ids.map((v) => encodeURIComponent(String(v))).join(",")})`;

async function del(path) {
  try {
    await sb(path, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  } catch (_) {
    // テーブル未存在・制約差異があっても退会処理を止めない（best-effort）。
  }
}

// owner を関連データごと削除する。存在しなければ null を返す。削除できたら owner 行を返す。
async function deleteOwnerCascade(ownerId) {
  const owner = await findOwnerById(ownerId);
  if (!owner) return null;

  // bookings / booking_pages 配下の孫テーブルを先に消すため id を集める。
  const bookings = await sb(`bookings?owner_id=${eq(ownerId)}&select=id`).catch(() => []);
  const pages = await sb(`booking_pages?owner_id=${eq(ownerId)}&select=id`).catch(() => []);
  const bookingIds = (bookings || []).map((b) => b.id).filter(Boolean);
  const pageIds = (pages || []).map((p) => p.id).filter(Boolean);

  if (bookingIds.length) {
    const filt = inList(bookingIds);
    await del(`reminder_deliveries?booking_id=${filt}`);
    await del(`thankyou_deliveries?booking_id=${filt}`);
    await del(`birthday_message_deliveries?booking_id=${filt}`);
    await del(`questionnaire_answers?booking_id=${filt}`);
  }
  if (pageIds.length) await del(`questionnaire_questions?booking_page_id=${inList(pageIds)}`);

  // owner_id を直接参照する子テーブル（子→親の順）。
  await del(`bookings?owner_id=${eq(ownerId)}`);
  await del(`booking_pages?owner_id=${eq(ownerId)}`);
  await del(`availability_settings?owner_id=${eq(ownerId)}`);
  await del(`profiles?owner_id=${eq(ownerId)}`);
  await del(`google_connections?owner_id=${eq(ownerId)}`);
  await del(`google_calendar_tokens?owner_id=${eq(ownerId)}`);
  await del(`appointment_logs?owner_id=${eq(ownerId)}`);
  await del(`manual_contacts?owner_id=${eq(ownerId)}`);
  await del(`ai_assist_logs?owner_id=${eq(ownerId)}`);

  // 本体。ここは try で握りつぶさず、失敗したら呼び出し元にエラーを返す。
  await sb(`owners?id=${eq(ownerId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return owner;
}

module.exports = { deleteOwnerCascade };
