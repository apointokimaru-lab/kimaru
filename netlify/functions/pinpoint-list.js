// 発行済みピンポイントリンクの一覧（#327）。ホスト専用・プレミアム限定。
//
// 一覧は「予約ページ横断」で返す。ホストが見たいのは「自分が送ったリンク」であって
// 「このページのリンク」ではないため。どの予約ページのものかは行に出す。
const { json } = require("./_lib/response");
const { requirePremiumOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { appBaseUrl } = require("./_lib/config");
const pinpoint = require("./_lib/pinpoint");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requirePremiumOwner(event);
    // 新しいものから。打診は直近のものを見返すことがほとんど。
    // テーブル未適用の環境では空一覧にデグレードする（画面は「まだありません」を出す）。
    const rows = await sb(`pinpoint_links?owner_id=${eq(owner.id)}&order=created_at.desc&limit=200`).catch(() => []);
    const pages = await sb(`booking_pages?owner_id=${eq(owner.id)}&select=id,title`).catch(() => []);
    const titleOf = new Map((pages || []).map((page) => [page.id, page.title || ""]));

    const base = appBaseUrl().replace(/\/$/, "");
    const links = (rows || []).map((link) => {
      const slots = Array.isArray(link.slots) ? link.slots : [];
      const times = slots.map((slot) => new Date(slot.start).getTime()).filter((time) => isFinite(time)).sort((a, b) => a - b);
      return {
        id: link.id,
        url: `${base}/p/${link.token}`,
        page_title: titleOf.get(link.booking_page_id) || "",
        slot_count: slots.length,
        // 候補の範囲は「最初〜最後」だけ返す。全件返しても一覧では読めないので、
        // どのあたりの日程を打診したのかが分かれば足りる。
        first_slot: times.length ? new Date(times[0]).toISOString() : null,
        last_slot: times.length ? new Date(times[times.length - 1]).toISOString() : null,
        hold_slots: Boolean(link.hold_slots),
        hold_title: link.hold_title || "",
        expires_at: link.expires_at || null,
        // 状態は3つ。無効化は取り消せないので、期限切れより先に判定する。
        status: link.is_active === false ? "disabled" : pinpoint.isExpired(link) ? "expired" : "active",
        created_at: link.created_at || null,
      };
    });
    return json(200, { links });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
