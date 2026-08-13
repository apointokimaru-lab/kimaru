// ピンポイント日程調整リンクの取得（#303）。ゲスト向け・ログイン不要。
// /p/<token> の画面が「提示された候補のうち、まだ空いているもの」を出すために使う。
const { json } = require("./_lib/response");
const { sb, eq, findOwnerById } = require("./_lib/supabase");
const core = require("./_lib/availability-core");
const pinpoint = require("./_lib/pinpoint");

exports.handler = async (event) => {
  try {
    const token = String((event?.queryStringParameters || {}).token || "").trim();
    const link = await pinpoint.findByToken(token);
    // 存在しない・停止済みは同じ応答にする（トークンの当たり外れを外から探れないようにする）。
    if (!link) return json(404, { error: "この日程調整リンクは見つかりませんでした" });

    const owner = await findOwnerById(link.owner_id);
    if (!owner || owner.cat_key_disabled) return json(404, { error: "この日程調整リンクは現在ご利用いただけません" });
    const pages = await sb(`booking_pages?id=${eq(link.booking_page_id)}&limit=1`).catch(() => []);
    const page = (pages || [])[0] || null;
    if (!page) return json(404, { error: "この日程調整リンクは現在ご利用いただけません" });
    if (page.is_active === false) return json(200, { paused: true, slots: [], questions: [], host: null });

    // 候補のうち、まだ空いているものだけを出す。リンクは何人でも使えるので、
    // 先に埋まった候補は残さない。判定は通常の予約と同じ突き合わせ（既存予約＋Googleカレンダー）。
    const slots = Array.isArray(link.slots) ? link.slots : [];
    const open = await openOf(owner, page, link, slots);

    return json(200, {
      token: link.token,
      slots: open,
      // 提示した候補が全部埋まった／過ぎた場合、画面は「空いている候補がありません」を出す。
      exhausted: open.length === 0,
      questions: await core.bookingPageQuestions(page),
      host: {
        slug: page.slug,
        title: page.title,
        description: page.description,
        duration_minutes: page.duration_minutes,
        location_type: page.location_type,
        location_value: page.location_value,
        name: owner.name || "",
      },
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};

// 候補枠から「まだ空いているもの」を絞る。
// 自分自身の hold は除外する（自分で押さえた枠を自分の画面から消してしまわないため）。
async function openOf(owner, page, link, slots) {
  const future = slots.filter((slot) => new Date(slot.start).getTime() > Date.now());
  if (!future.length) return [];
  const times = future.map((slot) => new Date(slot.start).getTime());
  const from = Math.min(...times) - core.DAY_MS;
  const to = Math.max(...times) + core.DAY_MS;
  try {
    // openSlotsForWindow は「枠を生成して絞る」関数なので、ここでは候補を直接突き合わせる。
    const busy = await core.busyForWindow(owner, page, from, to, { exceptPinpointId: link.id });
    const bufferBeforeMs = Math.max(0, Number(page.buffer_before_minutes || 0)) * 60000;
    const bufferAfterMs = Math.max(0, Number(page.buffer_after_minutes || 0)) * 60000;
    return future.filter((slot) => !core.overlaps(slot, busy, bufferBeforeMs, bufferAfterMs));
  } catch (_) {
    // 突き合わせに失敗したら、候補をそのまま出す（予約時に book.js 側で再検証される）。
    return future;
  }
}
