const { json } = require("./_lib/response");
const core = require("./_lib/availability-core");

// 月カレンダー用: 指定月(JST)で「空き枠のある日」の一覧＋予約可能な範囲(min_date/max_date)を返す。
// 予約ページの範囲ボタン/日付タップで開くカレンダーが、朱ドット表示と過去日の無効化に使う。
exports.handler = async (event) => {
  try {
    const query = event?.queryStringParameters || {};
    const { owner, bookingPage } = await core.resolveOwnerAndPage(query.slug);
    const { minStart, maxTime } = core.bookingBounds(bookingPage);
    const nowParts = core.tokyoParts(new Date());
    let year = parseInt(query.year, 10);
    let month = parseInt(query.month, 10);
    if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) {
      year = nowParts.year;
      month = nowParts.month + 1;
    }
    const base = { year, month, min_date: core.isoDate(minStart), max_date: core.isoDate(maxTime) };

    if (!owner || owner.cat_key_disabled || (bookingPage && bookingPage.is_active === false)) {
      return json(200, { ...base, days: [] });
    }
    const weekly = await core.ownerAvailability(owner).catch(() => []);
    const days = await core.availabilityDaysForMonth(owner, bookingPage, weekly, year, month);
    return json(200, { ...base, days });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
