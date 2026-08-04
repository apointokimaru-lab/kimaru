// 空き枠計算の共有コア。availability.js（5日窓）と availability-days.js（月カレンダー）で共用。
// JST基準・リードタイム・前後バッファ・Google/既存予約の突き合わせをここに集約する。
const { sb, eq, defaultOwner, findOwnerById } = require("./supabase");
const { freebusy } = require("./google");
const { isJapaneseHoliday } = require("./holidays");

const DEFAULT_WEEKLY_AVAILABILITY = [1, 2, 3, 4, 5].map((day) => ({ day_of_week: day, start_time: "10:00", end_time: "18:00" }));
const TOKYO_OFFSET_MINUTES = 9 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function timeToMinutes(time) {
  const [hours, minutes] = String(time).slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function tokyoParts(date) {
  const shifted = new Date(date.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), date: shifted.getUTCDate(), day: shifted.getUTCDay() };
}

// JST の (year, month0, date, 分) を UTC 時刻に変換。
function tokyoLocalDateToUtc(year, month, date, minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(Date.UTC(year, month, date, hours - 9, mins, 0, 0));
}

// JST のその日の 0:00 を表す UTC 時刻(ms)。
function tokyoStartOfDayMs(ms) {
  const p = tokyoParts(new Date(ms));
  return tokyoLocalDateToUtc(p.year, p.month, p.date, 0).getTime();
}

// UTC時刻(ms) → JST日付文字列 "YYYY-MM-DD"。
function isoDate(ms) {
  const p = tokyoParts(new Date(ms));
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.date).padStart(2, "0")}`;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

// fromTime〜toTime の枠を生成（枠間隔＝所要＋前後バッファ or 明示interval、リードタイム以前は除外）。
function generateSlots(weeklySettings, bookingPage, fromTime, toTime) {
  const settings = weeklySettings && weeklySettings.length ? weeklySettings : DEFAULT_WEEKLY_AVAILABILITY;
  const byDay = new Map(settings.map((setting) => [Number(setting.day_of_week), setting]));
  const duration = Number(bookingPage?.duration_minutes || 30);
  const bufferBefore = Number(bookingPage?.buffer_before_minutes || 0);
  const bufferAfter = Number(bookingPage?.buffer_after_minutes || 0);
  const interval = Number(bookingPage?.slot_interval_minutes || 0);
  const step = interval > 0 ? interval : duration + bufferBefore + bufferAfter;
  const acceptHolidays = bookingPage ? bookingPage.accept_holidays !== false : true;
  const leadHours = Math.max(0, Number(bookingPage?.lead_time_hours || 0));
  const earliest = new Date(Date.now() + leadHours * 60 * 60 * 1000);
  const slots = [];
  for (let t = fromTime; t < toTime; t += DAY_MS) {
    const parts = tokyoParts(new Date(t));
    const setting = byDay.get(parts.day);
    if (!setting) continue;
    if (!acceptHolidays && isJapaneseHoliday(parts.year, parts.month, parts.date)) continue;
    const open = timeToMinutes(setting.start_time);
    const close = timeToMinutes(setting.end_time);
    // 「前バッファ＋打合せ＋後バッファ」が受付時間帯[open,close]に収まる枠だけ生成する。
    // 例: 後バッファ20分・close18:00 → 17:00開始(打合せ終了18:00+後20=18:20)は不可、最終は打合せ終了+後バッファ<=18:00。
    for (let minute = open; minute + duration + bufferAfter <= close; minute += step) {
      if (minute - bufferBefore < open) continue; // 前バッファが受付開始より前へはみ出す枠は除外
      const start = tokyoLocalDateToUtc(parts.year, parts.month, parts.date, minute);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      if (start <= earliest) continue;
      slots.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }
  return slots;
}

// 候補枠(=新しい打ち合わせ)を前後バッファ分だけ広げ、既存予定(生の時間)と重なるか判定する。
// 「前バッファ＋打ち合わせ＋後バッファ」が空き時間に収まる枠だけを可とする。
// 前バッファは開始前、後バッファは終了後にだけ効く（before≠after でも取り違えない）。
function overlaps(slot, busy, bufferBeforeMs = 0, bufferAfterMs = 0) {
  const s = new Date(slot.start).getTime() - bufferBeforeMs;
  const e = new Date(slot.end).getTime() + bufferAfterMs;
  return busy.some((item) => {
    const busyStart = new Date(item.start).getTime();
    const busyEnd = new Date(item.end).getTime();
    return s < busyEnd && e > busyStart;
  });
}

async function ownerBookingBusy(ownerId, fromIso, toIso) {
  if (!ownerId) return [];
  try {
    const rows = await sb(
      `bookings?owner_id=${eq(ownerId)}&status=eq.confirmed&start_at=lt.${encodeURIComponent(toIso)}&end_at=gt.${encodeURIComponent(fromIso)}&select=start_at,end_at,start_time,end_time&limit=1000`
    );
    return (rows || [])
      .map((row) => ({ start: row.start_at || row.start_time, end: row.end_at || row.end_time }))
      .filter((item) => item.start && item.end);
  } catch (_) {
    return [];
  }
}

// 指定窓の空き枠（busy＋前後バッファ適用済み）。owner未連携/失敗時は生成枠をそのまま返す。
async function openSlotsForWindow(owner, bookingPage, weeklySettings, fromTime, toTime) {
  const slots = generateSlots(weeklySettings, bookingPage, fromTime, toTime);
  if (!slots.length || !owner?.id) return slots;
  const bufferBeforeMs = Math.max(0, Number(bookingPage?.buffer_before_minutes || 0)) * 60 * 1000;
  const bufferAfterMs = Math.max(0, Number(bookingPage?.buffer_after_minutes || 0)) * 60 * 1000;
  // 候補枠は開始前に bufferBefore、終了後に bufferAfter ぶん広がるので、その方向に取得窓も広げる。
  const busyFromIso = new Date(fromTime - bufferBeforeMs - DAY_MS).toISOString();
  const busyToIso = new Date(toTime + bufferAfterMs + DAY_MS).toISOString();
  const [calendarBusy, bookingBusy] = await Promise.all([
    freebusy(owner.id, busyFromIso, busyToIso).catch(() => []),
    ownerBookingBusy(owner.id, busyFromIso, busyToIso),
  ]);
  const busy = [...calendarBusy, ...bookingBusy];
  return slots.filter((slot) => !overlaps(slot, busy, bufferBeforeMs, bufferAfterMs));
}

// 予約可能な最古日(JST 0:00=minStart)と受付上限(maxTime)を求める。
// minStart＝「今からリードタイム時間後」の当日の0:00（それより過去は表示しない）。
function bookingBounds(bookingPage) {
  const now = Date.now();
  const leadHours = Math.max(0, Number(bookingPage?.lead_time_hours || 0));
  const earliest = now + leadHours * 60 * 60 * 1000;
  const minStart = tokyoStartOfDayMs(earliest);
  const rangeMonths = Math.min(Math.max(Number(bookingPage?.booking_range_months || 1), 1), 6);
  const candidateDays = Math.max(0, Number(bookingPage?.candidate_days || 0));
  const maxTime = candidateDays > 0 ? now + candidateDays * DAY_MS : addMonths(new Date(), rangeMonths).getTime();
  return { minStart, maxTime, earliest };
}

// タイムグリッドの縦軸（稼働時間帯）: weeklySettings の最小open〜最大close（分）。無ければ10:00-18:00。
function axisRange(weeklySettings) {
  const settings = weeklySettings && weeklySettings.length ? weeklySettings : DEFAULT_WEEKLY_AVAILABILITY;
  let min = Infinity, max = -Infinity;
  settings.forEach((x) => { min = Math.min(min, timeToMinutes(x.start_time)); max = Math.max(max, timeToMinutes(x.end_time)); });
  if (!isFinite(min) || !isFinite(max) || min >= max) { min = 600; max = 1080; }
  return { start_min: min, end_min: max };
}

// 枠配列 → 指定月(1-12, JST)で空きがある日番号の配列。
function slotsToMonthDays(slots, year, month) {
  const daySet = new Set();
  (slots || []).forEach((s) => {
    const p = tokyoParts(new Date(s.start));
    if (p.year === year && p.month === month - 1) daySet.add(p.date);
  });
  return [...daySet].sort((a, b) => a - b);
}

// 指定月(1-12, JST)で空き枠のある日一覧。受付範囲外は除外。
async function availabilityDaysForMonth(owner, bookingPage, weeklySettings, year, month) {
  const { minStart, maxTime } = bookingBounds(bookingPage);
  const monthStart = tokyoLocalDateToUtc(year, month - 1, 1, 0).getTime();
  const nextMonthStart = tokyoLocalDateToUtc(year, month, 1, 0).getTime();
  const from = Math.max(monthStart, minStart);
  const to = Math.min(nextMonthStart, maxTime + DAY_MS);
  if (from >= to) return [];
  const slots = await openSlotsForWindow(owner, bookingPage, weeklySettings, from, to);
  return slotsToMonthDays(slots, year, month);
}

async function ownerBookingPage(owner) {
  const rows = await sb(`booking_pages?owner_id=${eq(owner.id)}&slug=${eq(owner.slug || "demo")}&limit=1`);
  return rows[0] || null;
}

async function ownerAvailability(owner) {
  return sb(`availability_settings?owner_id=${eq(owner.id)}&order=day_of_week.asc,start_time.asc`);
}

// 受付時間は予約ページ単位（#263）。ページ専用の行 → 無ければオーナー共有のレガシー行（booking_page_id=null）の順で解決する。
// booking_page_id 列が未マイグレーションの環境ではオーナー単位の旧挙動へデグレードする。
async function pageAvailability(owner, bookingPage) {
  if (!owner) return [];
  const order = "order=day_of_week.asc,start_time.asc";
  if (bookingPage) {
    try {
      const own = await sb(`availability_settings?booking_page_id=${eq(bookingPage.id)}&${order}`);
      if (own && own.length) return own;
      // ページ専用の行が無いときだけ、旧「オーナー共有」行にフォールバックする。
      // ここで owner_id だけで引くと他ページ専用の行まで拾ってしまうため、必ず null 行に限定する。
      const shared = await sb(`availability_settings?owner_id=${eq(owner.id)}&booking_page_id=is.null&${order}`);
      return shared || [];
    } catch (_) {
      // 列が無い＝ページ単位で持てない環境。オーナー単位で返す。
    }
  }
  return ownerAvailability(owner).catch(() => []);
}

// slug から owner＋bookingPage を解決（無ければ既定オーナーの先頭ページ）。
async function resolveOwnerAndPage(slug) {
  const s = String(slug || "").trim().toLowerCase();
  let owner = null;
  let bookingPage = null;
  if (s && s !== "demo") {
    const pages = await sb(`booking_pages?slug=${eq(s)}&limit=1`).catch(() => []);
    bookingPage = pages[0] || null;
    if (bookingPage) owner = await findOwnerById(bookingPage.owner_id);
  }
  if (!owner) {
    owner = await defaultOwner();
    bookingPage = owner ? await ownerBookingPage(owner) : null;
  }
  return { owner, bookingPage };
}

async function bookingPageQuestions(bookingPage) {
  if (!bookingPage) return [];
  const rows = await sb(`questionnaire_questions?booking_page_id=${eq(bookingPage.id)}&order=sort_order.asc`).catch(() => []);
  return rows.filter((row) => !row.frozen).map((row) => ({
    id: row.id,
    question_text: row.question_text,
    is_required: Boolean(row.is_required),
    answer_type: ["text", "select", "checkbox"].includes(row.answer_type) ? row.answer_type : "text",
    options: Array.isArray(row.options) ? row.options : [],
  }));
}

module.exports = {
  DEFAULT_WEEKLY_AVAILABILITY, DAY_MS,
  timeToMinutes, tokyoParts, tokyoLocalDateToUtc, tokyoStartOfDayMs, isoDate, addMonths,
  generateSlots, overlaps, ownerBookingBusy, openSlotsForWindow,
  bookingBounds, axisRange, slotsToMonthDays, availabilityDaysForMonth,
  ownerBookingPage, ownerAvailability, pageAvailability, resolveOwnerAndPage, bookingPageQuestions,
};
