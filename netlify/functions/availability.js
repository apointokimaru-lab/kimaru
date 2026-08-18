const { json } = require("./_lib/response");
const core = require("./_lib/availability-core");

// 予約枠は「横並びの日単位」。start=YYYY-MM-DD(JST) の日からその日数ぶんを返す。
// 過去（＝リードタイム後の最古日 minStart より前）は見せない（hasPrev/クランプで制御）。
//
// 日数は画面幅で決まる（スマホ5日 / PC1週間）。サーバで固定していたのを可変にしたのは、
// PCでは横に余白があるのに5日しか出ず、週の見通しが悪かったため。
// 値は許可リストで受ける。任意の数を通すと、大きな値で枠生成と freeBusy の窓が際限なく広がる。
const DAYS_PER_VIEW = 5;
const ALLOWED_DAYS = new Set([5, 7]);
function resolveDays(query) {
  const value = parseInt(query.days, 10);
  return ALLOWED_DAYS.has(value) ? value : DAYS_PER_VIEW;
}

// 要求された開始日(ms)を決める。start指定 → その日、無ければ最古日。過去は最古日にクランプ。
function resolveFromTime(query, minStart) {
  const raw = String(query.start || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const ms = core.tokyoLocalDateToUtc(y, m - 1, d, 0).getTime();
    return Math.max(ms, minStart);
  }
  // 後方互換: week（5日ページ番号）でも受ける。ここは days に連動させない。
  // week は「5日で1ページ」と決めて配ったページ番号なので、日数を変えると同じ ?week=2 が
  // 別の日を指すようになる。既に出回っているURLの指す先を動かさない。
  const page = Math.max(0, parseInt(query.week, 10) || 0);
  return minStart + page * DAYS_PER_VIEW * core.DAY_MS;
}

exports.handler = async (event) => {
  try {
    const query = event?.queryStringParameters || {};
    const { owner, bookingPage } = await core.resolveOwnerAndPage(query.slug);
    const { minStart, maxTime } = core.bookingBounds(bookingPage);
    const fromTime = resolveFromTime(query, minStart);
    const days = resolveDays(query);
    const toTime = fromTime + days * core.DAY_MS;
    const rangeStart = core.isoDate(fromTime);
    const base = { range_start: rangeStart, days, min_date: core.isoDate(minStart), max_date: core.isoDate(maxTime) };

    // 利用停止アカウントは表示しない。
    if (owner && owner.cat_key_disabled) {
      return json(200, { slots: [], questions: [], host: null, suspended: true, ...base, hasPrev: false, hasNext: false });
    }

    // オーナー未設定（デモ）: 既定稼働時間で枠だけ返す。
    if (!owner) {
      const weekly = core.DEFAULT_WEEKLY_AVAILABILITY;
      const slots = core.generateSlots(weekly, null, fromTime, toTime);
      return json(200, { slots, questions: [], host: null, axis: core.axisRange(weekly), ...base, hasPrev: fromTime > minStart, hasNext: toTime < maxTime });
    }

    const questions = await core.bookingPageQuestions(bookingPage);
    const host = {
      name: owner.name || "",
      title: bookingPage?.title || "",
      description: bookingPage?.description || "",
      duration_minutes: bookingPage?.duration_minutes || 30,
      location_type: bookingPage?.location_type || "google_meet",
    };
    const weekly = await core.pageAvailability(owner, bookingPage).catch(() => []);
    const axis = core.axisRange(weekly);

    // 受付停止中のページは空き枠を返さない。
    if (bookingPage && bookingPage.is_active === false) {
      return json(200, { slots: [], questions, host, axis, ...base, hasPrev: false, hasNext: false, paused: true });
    }

    const hasPrev = fromTime > minStart;
    const hasNext = toTime < maxTime;
    if (fromTime > maxTime) {
      return json(200, { slots: [], questions, host, axis, ...base, hasPrev, hasNext: false });
    }
    const slots = await core.openSlotsForWindow(owner, bookingPage, weekly, fromTime, Math.min(toTime, maxTime + core.DAY_MS));
    return json(200, { slots, questions, host, axis, ...base, hasPrev, hasNext });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
