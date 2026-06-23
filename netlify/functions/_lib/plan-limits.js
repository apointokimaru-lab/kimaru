// プラン別の保存上限（決定27・2026-06-18）。
// free / pro / premium = 予約ページ 1 / 2 / 5、事前アンケート設問 2 / 5 / 5。
// ※ 受付期間（無料2ヶ月 / 有料6ヶ月）は別枠（booking-page-save.js の FREE_RANGE_LIMIT）。
const PLAN_LIMITS = {
  free: { pages: 1, questions: 2 },
  pro: { pages: 2, questions: 5 },
  premium: { pages: 5, questions: 5 },
};

function planLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

module.exports = { PLAN_LIMITS, planLimits };
