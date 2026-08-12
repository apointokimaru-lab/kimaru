// ピンポイント日程調整リンクの発行（#303）。ホスト専用。
// 予約ページの設定（所要・バッファ・質問・開催方法）を流用し、提示する候補枠だけを絞る。
const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { appBaseUrl } = require("./_lib/config");
const pinpoint = require("./_lib/pinpoint");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requireOwner(event);
    const body = readJson(event);

    // 予約ページは必ず自分のものに限定する（他人のページの設定でリンクを作らせない）。
    const pageId = String(body.booking_page_id || "").trim();
    if (!pageId) return json(400, { error: "予約ページを選択してください" });
    const pages = await sb(`booking_pages?id=${eq(pageId)}&owner_id=${eq(owner.id)}&limit=1`);
    const page = (pages || [])[0];
    if (!page) return json(404, { error: "対象の予約ページが見つかりません" });
    if (page.is_active === false) return json(400, { error: "受付を停止している予約ページではリンクを作成できません" });

    const slots = pinpoint.normalizeSlots(body.slots);
    if (!slots.length) return json(400, { error: "候補の日程を1つ以上選んでください" });

    const row = {
      owner_id: owner.id,
      booking_page_id: page.id,
      token: pinpoint.newToken(),
      slots,
      hold_slots: body.hold_slots === true || body.hold_slots === "true",
      is_active: true,
    };

    let saved;
    try {
      saved = await sb("pinpoint_links", { method: "POST", body: JSON.stringify(row) });
    } catch (error) {
      // token は unique。万一衝突したら一度だけ引き直す（乱数22桁なので実際にはまず起きない）。
      if (!/duplicate|unique/i.test(String(error.message || ""))) throw error;
      saved = await sb("pinpoint_links", { method: "POST", body: JSON.stringify({ ...row, token: pinpoint.newToken() }) });
    }
    const link = (saved || [])[0];
    if (!link) return json(500, { error: "リンクの作成に失敗しました" });

    return json(200, {
      ok: true,
      token: link.token,
      url: `${appBaseUrl().replace(/\/$/, "")}/p/${link.token}`,
      slots: link.slots,
      hold_slots: link.hold_slots,
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
