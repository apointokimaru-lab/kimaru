// Zoom user-level OAuth の開始。ログイン中ユーザーを Zoom の認可画面へ送る。
// state は owner id を署名した短命ブロブ（callback で本人一致を検証＝CSRF対策）。
const { json, redirect } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { signBlob } = require("./_lib/crypto");
const zoom = require("./_lib/zoom");

exports.handler = async (event) => {
  try {
    const owner = await requireOwner(event);
    if (!zoom.isConfigured()) return json(503, { error: "Zoom連携は現在利用できません（ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET 未設定）。" });
    return redirect(zoom.authorizeUrl(signBlob("zoomstate", { o: owner.id })));
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
