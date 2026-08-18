// ピンポイントリンクを手動で無効にする（#327）。ホスト専用・プレミアム限定。
//
// 無効化は取り消せない。押さえていたGoogleカレンダーの予定を消してしまうので、
// is_active を戻しても同じ状態には復元できないため（画面のモーダルでもそう宣言している）。
// 復活の導線を作ると宣言と食い違うので、この関数にも「戻す」経路は無い。
const { json, readJson } = require("./_lib/response");
const { requirePremiumOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const pinpoint = require("./_lib/pinpoint");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requirePremiumOwner(event);
    const body = readJson(event);
    const id = String(body.id || "").trim();
    if (!id) return json(400, { error: "対象のリンクを指定してください" });

    // owner_id で必ず絞る。id だけで引くと他人のリンクを止められてしまう。
    const rows = await sb(`pinpoint_links?id=${eq(id)}&owner_id=${eq(owner.id)}&limit=1`).catch(() => []);
    const link = (rows || [])[0];
    if (!link) return json(404, { error: "対象のリンクが見つかりません" });
    if (link.is_active === false) return json(200, { ok: true, already: true });

    // 押さえの解除は期限切れ（#326）と同じ releaseHold を使う。消すのは押さえ予定だけで、
    // このリンク経由で成立した実際の予約とその予定には触らない。
    const removed = await pinpoint.releaseHold(link);

    // 予定の削除に失敗しても無効化そのものは進める。リンクを止めたいのが主目的で、
    // 止まらないほうが困る。消し残した予定は hold_events に残るので手で消せる。
    const patch = { is_active: false };
    // 消せたぶんは hold_events から落とす（#326 の片付けジョブが再度消しにいかないように）。
    if (removed > 0) patch.hold_events = [];
    try {
      await sb(`pinpoint_links?id=${eq(link.id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (error) {
      // hold_events 列が未適用の環境では is_active だけ落として無効化する。
      if (!/hold_events/.test(String(error.message || ""))) throw error;
      await sb(`pinpoint_links?id=${eq(link.id)}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
    }
    return json(200, { ok: true, released: removed });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
