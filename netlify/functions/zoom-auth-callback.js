// Zoom user-level OAuth のコールバック。code をトークンに交換し zoom_connections へ暗号化保存。
// 結果は settings.html?zoom=<connected|denied|state_error|error> で通知する。
const { redirect } = require("./_lib/response");
const { currentOwner } = require("./_lib/auth");
const { verifyBlob } = require("./_lib/crypto");
const { appBaseUrl } = require("./_lib/config");
const zoom = require("./_lib/zoom");

const back = (result) => redirect(`${appBaseUrl()}/settings.html?zoom=${result}#integrations`);

exports.handler = async (event) => {
  try {
    const owner = await currentOwner(event);
    if (!owner) return redirect(`${appBaseUrl()}/login.html?next=${encodeURIComponent("/settings.html#integrations")}`);
    const q = event.queryStringParameters || {};
    const state = verifyBlob("zoomstate", q.state, 600000);
    if (!state || state.o !== owner.id) return back("state_error");
    if (!q.code) return back("denied"); // ユーザーが Zoom 側で拒否
    const tokens = await zoom.exchangeCode(q.code);
    const zoomUser = await zoom.zoomUserInfo(tokens.access_token);
    await zoom.saveConnection(owner.id, tokens, zoomUser);
    return back("connected");
  } catch (_) {
    // トークン交換失敗・zoom_connections 未適用など。詳細はUI側で一般エラーとして表示。
    return back("error");
  }
};
