// プラン別の保存上限（決定27・2026-06-18）。
// free / pro / premium = 予約ページ 1 / 2 / 5、事前アンケート設問 2 / 5 / 5。
// ※ 受付期間（無料2ヶ月 / 有料6ヶ月）は別枠（booking-page-save.js の FREE_RANGE_LIMIT）。
//
// pinpoint はピンポイント日程調整リンク（#303）の上限（#338・2026-08-24）。
// links = 「有効なリンクの同時保有数」（累計の発行回数ではない。累計にすると無料は生涯1本しか
//   作れず、試すこともできなくなる）。期限切れ・無効化済みは数えない。
// slots = 1リンクあたりの候補数。expiresDays = 選べる有効期限（末尾が既定）。
// hold  = 枠の押さえ（Googleカレンダーに仮押さえ予定を作る）を使えるか＝Pro以上。
const PLAN_LIMITS = {
  free: { pages: 1, questions: 2, pinpoint: { links: 1, slots: 3, expiresDays: [3], hold: false } },
  pro: { pages: 2, questions: 5, pinpoint: { links: 3, slots: 7, expiresDays: [3, 7], hold: true } },
  premium: { pages: 5, questions: 5, pinpoint: { links: 5, slots: 30, expiresDays: [3, 7], hold: true } },
};

function planLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

// ピンポイントの上限だけを取り出す。未知のプランは free に寄る（planLimits と同じ扱い）。
function pinpointLimits(plan) {
  return planLimits(plan).pinpoint;
}

module.exports = { PLAN_LIMITS, planLimits, pinpointLimits };
