const { json } = require("./_lib/response");
const { defaultOwner, findOwnerById, sb, eq } = require("./_lib/supabase");
const { freebusy } = require("./_lib/google");
const { isJapaneseHoliday } = require("./_lib/holidays");

const DEFAULT_WEEKLY_AVAILABILITY = [1, 2, 3, 4, 5].map((day) => ({ day_of_week: day, start_time: "10:00", end_time: "18:00" }));
const TOKYO_OFFSET_MINUTES = 9 * 60;

function timeToMinutes(time) {
  const [hours, minutes] = String(time).slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function tokyoParts(date) {
  const shifted = new Date(date.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
  };
}

function tokyoLocalDateToUtc(year, month, date, minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(Date.UTC(year, month, date, hours - 9, mins, 0, 0));
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

// fromTime〜toTime（1週間）の枠を生成（80件上限は廃止＝週送りで全期間カバー）
function generateSlots(weeklySettings, bookingPage, fromTime, toTime) {
  const settings = weeklySettings.length ? weeklySettings : DEFAULT_WEEKLY_AVAILABILITY;
  const byDay = new Map(settings.map((setting) => [Number(setting.day_of_week), setting]));
  const duration = Number(bookingPage?.duration_minutes || 30);
  const bufferBefore = Number(bookingPage?.buffer_before_minutes || 0);
  const bufferAfter = Number(bookingPage?.buffer_after_minutes || 0);
  // 表示間隔: 設定があればそれを採用、なければ「所要＋前後バッファ」を自動間隔に。
  const interval = Number(bookingPage?.slot_interval_minutes || 0);
  const step = interval > 0 ? interval : duration + bufferBefore + bufferAfter;
  // 祝日の受付可否（既定: 受け付ける）。
  const acceptHolidays = bookingPage ? bookingPage.accept_holidays !== false : true;
  // リードタイム: 「今から○時間後」以降の枠のみ提示（既定: 0時間）。
  const leadHours = Math.max(0, Number(bookingPage?.lead_time_hours || 0));
  const now = new Date();
  const earliest = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
  const dayMs = 24 * 60 * 60 * 1000;
  const slots = [];

  for (let t = fromTime; t < toTime; t += dayMs) {
    const parts = tokyoParts(new Date(t));
    const setting = byDay.get(parts.day);
    if (!setting) continue;
    if (!acceptHolidays && isJapaneseHoliday(parts.year, parts.month, parts.date)) continue;

    const open = timeToMinutes(setting.start_time);
    const close = timeToMinutes(setting.end_time);
    // 最初の枠は受付開始時刻ちょうどから。バッファ/表示間隔は枠と枠の間隔（step）に反映する。
    for (let minute = open; minute + duration <= close; minute += step) {
      const start = tokyoLocalDateToUtc(parts.year, parts.month, parts.date, minute);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      if (start <= earliest) continue;
      slots.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }

  return slots;
}

function overlaps(slot, busy) {
  const s = new Date(slot.start).getTime();
  const e = new Date(slot.end).getTime();
  return busy.some((item) => s < new Date(item.end).getTime() && e > new Date(item.start).getTime());
}

async function ownerBookingPage(owner) {
  const rows = await sb(`booking_pages?owner_id=${eq(owner.id)}&slug=${eq(owner.slug || "demo")}&limit=1`);
  return rows[0] || null;
}

async function ownerAvailability(owner) {
  return sb(`availability_settings?owner_id=${eq(owner.id)}&order=day_of_week.asc,start_time.asc`);
}

async function bookingPageQuestions(bookingPage) {
  if (!bookingPage) return [];
  const rows = await sb(`questionnaire_questions?booking_page_id=${eq(bookingPage.id)}&order=sort_order.asc`).catch(() => []);
  // 凍結された質問（無料降格時の上限超過分・#174）はゲストに出さない。未マイグレーション環境では frozen 未定義＝表示。
  return rows.filter((row) => !row.frozen).map((row) => ({ id: row.id, question_text: row.question_text, is_required: Boolean(row.is_required) }));
}

exports.handler = async (event) => {
  try {
    // slug 指定があれば該当の予約ページ＋オーナーを解決（無ければ既定オーナーの先頭ページ）。
    const slug = String(event?.queryStringParameters?.slug || "").trim().toLowerCase();
    let owner = null;
    let bookingPage = null;
    if (slug && slug !== "demo") {
      const pages = await sb(`booking_pages?slug=${eq(slug)}&limit=1`).catch(() => []);
      bookingPage = pages[0] || null;
      if (bookingPage) owner = await findOwnerById(bookingPage.owner_id);
    }
    if (!owner) {
      owner = await defaultOwner();
      bookingPage = owner ? await ownerBookingPage(owner) : null;
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const weekOffset = Math.max(0, parseInt(event?.queryStringParameters?.week || "0", 10) || 0);

    // 利用停止（cat_key_disabled）アカウントの予約ページは表示しない。
    if (owner && owner.cat_key_disabled) {
      return json(200, { slots: [], questions: [], host: null, suspended: true, week: weekOffset, hasPrev: false, hasNext: false });
    }

    if (!owner) {
      const from0 = Date.now() + weekOffset * 7 * dayMs;
      return json(200, { slots: generateSlots(DEFAULT_WEEKLY_AVAILABILITY, null, from0, from0 + 7 * dayMs), questions: [], host: null, week: weekOffset, hasPrev: weekOffset > 0, hasNext: true });
    }

    const questions = await bookingPageQuestions(bookingPage);
    // ゲスト予約ページに表示するホスト・会議情報
    const host = {
      name: owner.name || "",
      title: bookingPage?.title || "",
      description: bookingPage?.description || "",
      duration_minutes: bookingPage?.duration_minutes || 30,
      location_type: bookingPage?.location_type || "google_meet",
    };
    // 受付停止中のページは空き枠を返さない（削除せず一時停止）。
    if (bookingPage && bookingPage.is_active === false) {
      return json(200, { slots: [], questions, host, week: weekOffset, hasPrev: false, hasNext: false, paused: true });
    }
    const weeklySettings = await ownerAvailability(owner).catch(() => []);

    // 週送り：今日からの7日窓を week 単位でずらす。公開範囲（受付期間=月数）内のみ。
    const now = Date.now();
    const rangeMonths = Math.min(Math.max(Number(bookingPage?.booking_range_months || 1), 1), 6);
    const candidateDays = Math.max(0, Number(bookingPage?.candidate_days || 0));
    // 日数指定(7/14/21)があればそこまで、無ければ月数(1-6)先まで。
    const maxTime = candidateDays > 0 ? now + candidateDays * dayMs : addMonths(new Date(), rangeMonths).getTime();
    const fromTime = now + weekOffset * 7 * dayMs;
    const toTime = fromTime + 7 * dayMs;
    const hasPrev = weekOffset > 0;
    const hasNext = toTime < maxTime;
    if (fromTime > maxTime) return json(200, { slots: [], questions, host, week: weekOffset, hasPrev, hasNext: false });

    const weekSlots = generateSlots(weeklySettings, bookingPage, fromTime, Math.min(toTime, maxTime + dayMs));
    let openSlots = weekSlots;
    if (weekSlots.length) {
      const busy = await freebusy(owner.id, new Date(fromTime).toISOString(), new Date(toTime).toISOString()).catch(() => []);
      openSlots = weekSlots.filter((slot) => !overlaps(slot, busy));
    }
    return json(200, { slots: openSlots, questions, host, week: weekOffset, hasPrev, hasNext });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
