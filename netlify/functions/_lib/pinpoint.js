// ピンポイント日程調整リンク（#303）の共有ロジック。
// 発行API・取得API・予約成立（book.js）・空き枠計算（availability-core）から使う。
const { sb, eq } = require("./supabase");

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

module.exports = { newToken, normalizeSlots, findByToken, includesSlot, heldBusyFor, MAX_SLOTS };
