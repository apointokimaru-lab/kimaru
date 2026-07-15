// Zoom 連携の解除（zoom_connections の行を削除）。
const { json } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const zoom = require("./_lib/zoom");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
    const owner = await requireOwner(event);
    await zoom.deleteConnection(owner.id);
    return json(200, { ok: true });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
