// ピンポイント日程調整リンクの発行（#303）。ホスト専用。
// 予約ページの設定（所要・バッファ・質問・開催方法）を流用し、提示する候補枠だけを絞る。
const { json, readJson } = require("./_lib/response");
// 当面はプレミアム限定で配信する（#303）。発行だけを絞り、ゲスト側の /p/ は絞らない
// ＝すでに送ったリンクは、あとでプランが下がっても相手の画面で切れないようにする。
const { requirePremiumOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { appBaseUrl } = require("./_lib/config");
const pinpoint = require("./_lib/pinpoint");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requirePremiumOwner(event);
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

    const holdSlots = body.hold_slots === true || body.hold_slots === "true";
    const holdTitle = pinpoint.normalizeHoldTitle(body.hold_title);
    // 押さえるなら予定項目名は必須（#325）。空のまま発行できると Google カレンダーに予定が作られず、
    // 「押さえたのにカレンダーには何も出ない」状態になる（画面側でも required にしている）。
    if (holdSlots && !holdTitle) return json(400, { error: "押さえる予定の項目名を入力してください" });

    // 押さえ予定は行を入れる前に作る。逆順にすると、hold_events 列が未適用でイベントIDを
    // 保存できなかったときに、あとから消せない予定がカレンダーに残る。先に作っておけば
    // 保存に失敗した時点でこちらで片付けられる（下の releaseHold）。
    // Google未連携・作成失敗のときは空配列が返るだけで、発行自体は通す
    // （heldBusyFor によるキマル内部の押さえは効くので、押さえが無防備になるわけではない）。
    const holdEvents = holdSlots ? await pinpoint.createHoldEvents(owner.id, slots, holdTitle) : [];
    const cleanupHoldEvents = () => pinpoint.releaseHold({ owner_id: owner.id, hold_events: holdEvents }).catch(() => 0);

    const row = {
      owner_id: owner.id,
      booking_page_id: page.id,
      token: pinpoint.newToken(),
      slots,
      hold_slots: holdSlots,
      hold_title: holdTitle,
      hold_events: holdEvents,
      is_active: true,
    };

    // token は unique。万一衝突したら一度だけ引き直す（乱数22桁なので実際にはまず起きない）。
    const insert = async (payload) => {
      try {
        return await sb("pinpoint_links", { method: "POST", body: JSON.stringify(payload) });
      } catch (error) {
        if (!/duplicate|unique/i.test(String(error.message || ""))) throw error;
        return sb("pinpoint_links", { method: "POST", body: JSON.stringify({ ...payload, token: pinpoint.newToken() }) });
      }
    };

    let saved;
    try {
      saved = await insert(row);
    } catch (error) {
      // hold_title/hold_events 列が未マイグレーションの環境では、その2列を落として保存する。
      // ただし作った予定は追跡できなくなる＝期限切れ・無効化でも消せないので、ここで消しておく。
      // 押さえ自体は heldBusyFor（キマル内部）で効くため、リンクとしては成立する。
      if (!/hold_title|hold_events/.test(String(error.message || ""))) {
        await cleanupHoldEvents();
        throw error;
      }
      await cleanupHoldEvents();
      const { hold_title, hold_events, ...rest } = row;
      saved = await insert(rest);
    }
    const link = (saved || [])[0];
    if (!link) {
      await cleanupHoldEvents();
      return json(500, { error: "リンクの作成に失敗しました" });
    }

    return json(200, {
      ok: true,
      token: link.token,
      url: `${appBaseUrl().replace(/\/$/, "")}/p/${link.token}`,
      slots: link.slots,
      hold_slots: link.hold_slots,
      hold_title: link.hold_title || "",
      // 押さえを選んだのに0件なら、Google未連携か作成失敗。画面はこれを見て注意書きを出す。
      hold_events_created: pinpoint.holdEventsOf(link).length,
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
