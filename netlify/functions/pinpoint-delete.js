// ピンポイントリンクを物理削除する（#336）。ホスト専用・プレミアム限定。
//
// 消せるのは「使えなくなったリンク」だけ＝無効化済み（is_active=false）か期限切れ。
// 有効なリンクは拒否する。相手がまだ開けるリンクを、行を消すだけで黙って死なせないため
// （止めたいなら先に pinpoint-deactivate を通す。あちらは押さえの解除と遮断を伴う）。
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

    // owner_id で必ず絞る。id だけで引くと他人のリンクを消せてしまう。
    const rows = await sb(`pinpoint_links?id=${eq(id)}&owner_id=${eq(owner.id)}&limit=1`).catch(() => []);
    const link = (rows || [])[0];
    if (!link) return json(404, { error: "対象のリンクが見つかりません" });

    const usable = link.is_active !== false && !pinpoint.isExpired(link);
    if (usable) return json(400, { error: "有効なリンクは削除できません。先に無効にしてください" });

    // 行を消す前に押さえを解除する。期限切れ直後は片付けジョブ（#326）がまだ走っておらず
    // hold_events が残っていることがあり、そのまま消すと二度と辿れないGoogle予定が残る。
    // 無効化済みのリンクは解除済みで hold_events も空なので、ここは何もせず素通りする。
    await pinpoint.releaseHold(link).catch(() => 0);

    await sb(`pinpoint_links?id=${eq(link.id)}&owner_id=${eq(owner.id)}`, { method: "DELETE" });
    return json(200, { ok: true });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
