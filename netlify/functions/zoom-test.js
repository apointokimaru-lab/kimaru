// Zoom 連携の接続テスト。テスト用ミーティングを1件作成し、すぐ削除する（作成/削除の2コール）。
// 目的は2つ: (1) ホストが「本当に発行できる状態か」を予約前に自分で確認できる
// (2) Zoom Marketplace の審査で、アプリ内の操作から meeting:write / meeting:delete の実コールを示せる
//     （実運用のミーティング作成はゲストの予約完了時に起きるため、ホストUIだけでは発生しない）。
const { json } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const zoom = require("./_lib/zoom");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
    const owner = await requireOwner(event);
    if (!zoom.isConfigured()) return json(503, { error: "Zoom連携は現在利用できません。" });

    const connection = await zoom.getConnection(owner.id);
    if (!connection) return json(400, { error: "Zoomと連携していません。「Zoomと連携する」から接続してください。", connected: false });

    // 1時間後・15分のテスト予定を作成（既存の予定と紛れないようトピックを明示）。
    const startIso = new Date(Date.now() + 3600 * 1000).toISOString();
    const meeting = await zoom.createMeetingFor(owner.id, { topic: "キマル 接続テスト（自動削除されます）", startIso, durationMinutes: 15 });
    if (!meeting?.joinUrl) return json(502, { error: "テスト用ミーティングを作成できませんでした。連携を解除して再接続してください。" });

    // 後片付け。削除に失敗してもテスト自体は成功（作成できた事実が確認したいこと）。
    let deleted = false;
    try {
      deleted = await zoom.deleteMeetingById(owner.id, meeting.id);
    } catch (_) {
      deleted = false;
    }
    return json(200, { ok: true, join_url: meeting.joinUrl, deleted, zoom_email: connection.zoom_email || "" });
  } catch (error) {
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : (error.message || "Zoomとの通信に失敗しました。時間をおいて再度お試しください。"),
    });
  }
};
