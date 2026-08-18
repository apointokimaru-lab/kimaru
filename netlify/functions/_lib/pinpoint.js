// ピンポイント日程調整リンク（#303）の共有ロジック。
// 発行API・取得API・予約成立（book.js）・空き枠計算（availability-core）から使う。
const { sb, eq } = require("./supabase");
const { createBufferEvent, deleteCalendarEvent } = require("./google");

// URL に載るトークン。slug と違い推測されては困るので、十分な長さの乱数にする。
// 紛らわしい文字（0/O/1/l）を除いて、口頭やメールで写し間違えないようにする。
const TOKEN_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
function newToken(length = 22) {
  const bytes = require("crypto").randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_CHARS[bytes[i] % TOKEN_CHARS.length];
  return out;
}

// 候補枠の正規化。{start, end} の ISO8601 のみ受け付け、壊れた値・過去・重複は落とす。
// 上限を設けるのは、巨大な配列を送られて空き枠計算が重くなるのを防ぐため。
const MAX_SLOTS = 30;
function normalizeSlots(input, { now = Date.now() } = {}) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((slot) => ({ start: new Date(slot?.start), end: new Date(slot?.end) }))
    .filter((slot) => !isNaN(slot.start) && !isNaN(slot.end))
    .filter((slot) => slot.end > slot.start)
    .filter((slot) => slot.start.getTime() > now) // 過去の候補は打診できない
    .map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() }))
    .filter((slot) => {
      if (seen.has(slot.start)) return false;
      seen.add(slot.start);
      return true;
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, MAX_SLOTS);
}

async function findByToken(token) {
  const value = String(token || "").trim();
  if (!value) return null;
  const rows = await sb(`pinpoint_links?token=${eq(value)}&limit=1`).catch(() => []);
  const link = (rows || [])[0] || null;
  return link && link.is_active !== false ? link : null;
}

// 開始時刻がこのリンクの候補に含まれるか。候補外の時刻をPOSTされても成立させないための検証。
// 秒以下のずれで落とさないよう、分単位に丸めて比較する。
function includesSlot(link, startIso) {
  const minute = (value) => Math.floor(new Date(value).getTime() / 60000);
  const target = minute(startIso);
  if (!isFinite(target)) return false;
  return (Array.isArray(link?.slots) ? link.slots : []).some((slot) => minute(slot.start) === target);
}

// hold_slots=true のリンクが押さえている枠を busy 形式で返す（空き枠計算に混ぜる）。
// exceptId は「自分自身のリンク」。/p/<token> を開いたゲストには自分の候補が出る必要があるため、
// 自分の hold で自分の候補を消してしまわないよう除外する。
// テーブル未適用・取得失敗のときは空配列（＝押さえなし）にデグレードし、予約導線は止めない。
async function heldBusyFor(ownerId, { exceptId = null } = {}) {
  if (!ownerId) return [];
  const rows = await sb(`pinpoint_links?owner_id=${eq(ownerId)}&is_active=is.true&select=id,slots,hold_slots`).catch(() => []);
  return (rows || [])
    .filter((row) => row.hold_slots && row.id !== exceptId)
    .flatMap((row) => (Array.isArray(row.slots) ? row.slots : []))
    .filter((slot) => slot && slot.start && slot.end);
}

// 押さえ予定の予定項目名。Googleカレンダーの summary になるので長さを切る。
const MAX_HOLD_TITLE = 120;
function normalizeHoldTitle(input) {
  return String(input || "").trim().slice(0, MAX_HOLD_TITLE);
}

// 押さえ枠を実際のGoogleカレンダー予定として作る（#325）。
// これが無いと押さえはキマル内部の空き枠計算にしか効かず、ホストが自分のカレンダーを見ても
// その時間が空いて見える＝Google側から直接埋められてしまう。
//
// 戻り値は [{start, end, event_id}]。時間帯も一緒に持つのは、/p/<token> の空き枠判定で
// 「自分自身の押さえ」を busy から差し引くのに要るため（freeBusy はイベントIDを返さない）。
// Google未連携・個々の失敗は握りつぶす。押さえが弱くなるだけで、リンクの発行自体は通す
// （heldBusyFor によるキマル内部の押さえは残るので、無防備にはならない）。
async function createHoldEvents(ownerId, slots, title) {
  const summary = normalizeHoldTitle(title);
  if (!ownerId || !summary) return [];
  const created = [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    const event = await createBufferEvent(ownerId, {
      summary,
      startIso: slot.start,
      endIso: slot.end,
      // カレンダー上でこの予定の正体が分かるようにする。手で消してよいのか迷わせない。
      description: "キマルのピンポイント日程調整で押さえている枠です。リンクの期限切れ・無効化で自動的に削除されます。",
    }).catch(() => null);
    if (event?.id) created.push({ start: slot.start, end: slot.end, event_id: event.id });
  }
  return created;
}

// 押さえ予定をGoogleカレンダーから消す。期限切れ（#326）と手動の無効化（#327）の両方から呼ぶ。
// 消すのは「リンク作成時にできた仮の押さえ予定」だけ。そのリンク経由で成立した実際の予約と
// その予約のGoogle予定には触らない（別のイベントとして作られているので、ここでは辿れない）。
// 戻り値は消した件数。列未適用・失敗は 0 件として静かに流す。
async function releaseHold(link) {
  const events = holdEventsOf(link);
  if (!link?.owner_id || !events.length) return 0;
  let removed = 0;
  for (const event of events) {
    if (!event.event_id) continue;
    const ok = await deleteCalendarEvent(link.owner_id, event.event_id).then(() => true).catch(() => false);
    if (ok) removed += 1;
  }
  return removed;
}

// hold_events 列の値を安全に取り出す。列が未適用の環境では undefined になるので空配列にする。
function holdEventsOf(link) {
  const rows = Array.isArray(link?.hold_events) ? link.hold_events : [];
  return rows.filter((row) => row && row.start && row.end);
}

// busy 区間から「このリンク自身の押さえ」を差し引く。
//
// なぜ要るか: 押さえが本物のGoogleカレンダー予定になると freeBusy がそれを busy として返す。
// そのまま使うと /p/<token> を開いたゲストに候補が1つも出なくなる（自分で押さえた枠を
// 自分で塞いでしまう）。heldBusyFor の exceptId はキマル内部の押さえにしか効かないので、
// Google 由来の busy はここで引く必要がある。
//
// 限界: freeBusy は重なる区間をマージして返すため、実予約と押さえが同時刻だと引きすぎる。
// ただしキマル経由の予約は bookings 由来の busy（ownerBookingBusy）でも独立に busy になるので
// 守られる。残るのは「Google側で手で作った予定が押さえと完全に重なる」場合だけで、これは許容する。
function subtractHold(busy, link) {
  const holds = holdEventsOf(link).map((event) => ({
    start: new Date(event.start).getTime(),
    end: new Date(event.end).getTime(),
  })).filter((hold) => isFinite(hold.start) && isFinite(hold.end) && hold.end > hold.start);
  if (!holds.length) return busy;

  return (busy || []).flatMap((item) => {
    // 1区間を押さえのぶんだけ削る。押さえが真ん中に入ると前後2つに割れるので、
    // 区間の配列を持ち回して順に削る（1回の差し引きで確定させると2つ目以降を取りこぼす）。
    let parts = [{ start: new Date(item.start).getTime(), end: new Date(item.end).getTime() }];
    for (const hold of holds) {
      parts = parts.flatMap((part) => {
        if (hold.end <= part.start || hold.start >= part.end) return [part]; // 重ならない
        const out = [];
        if (part.start < hold.start) out.push({ start: part.start, end: hold.start });
        if (hold.end < part.end) out.push({ start: hold.end, end: part.end });
        return out;
      });
    }
    return parts
      .filter((part) => part.end > part.start)
      .map((part) => ({ start: new Date(part.start).toISOString(), end: new Date(part.end).toISOString() }));
  });
}

module.exports = {
  newToken,
  normalizeSlots,
  normalizeHoldTitle,
  findByToken,
  includesSlot,
  heldBusyFor,
  createHoldEvents,
  releaseHold,
  holdEventsOf,
  subtractHold,
  MAX_SLOTS,
  MAX_HOLD_TITLE,
};
