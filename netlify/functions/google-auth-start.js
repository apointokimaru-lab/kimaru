const crypto = require("crypto");
const { redirect } = require("./_lib/response");
const { googleAuthUrl } = require("./_lib/google");
const { oauthStateCookie, signBlob } = require("./_lib/crypto");
const { currentOwner } = require("./_lib/auth");

// ログインCSRF対策：state を署名 cookie に保持してから Google へ送る。
// callback で cookie と照合し、攻撃者が用意した code を被害者ブラウザに注入する攻撃を防ぐ。
//
// state の先頭1文字で用途を持ち回る:
//   "c" + signBlob("gconnect", {o: ownerId})
//        = 連携（設定画面から）。owner id を署名して載せ、callback で「フローを始めた本人が
//          完了しているか」を検証する。zoom-auth-start.js と同じ方式。
//          これが無いと、攻撃者のセッションを被害者のブラウザに植え付けたうえで連携させることで、
//          被害者のGoogleトークンを攻撃者のアカウントに紐づけられる（アカウント連携CSRF）。
//   "l" + ランダム
//        = ログイン／新規登録（login.html・signup.html から）。未ログインで連携を開始した場合も
//          こちら（＝通常のGoogleログイン）にフォールバックする。
exports.handler = async (event) => {
  const connect = String((event?.queryStringParameters || {}).connect || "") === "1";
  const owner = connect ? await currentOwner(event).catch(() => null) : null;
  const state = owner
    ? `c${signBlob("gconnect", { o: owner.id })}`
    : `l${crypto.randomBytes(16).toString("hex")}`;
  return redirect(googleAuthUrl(state), { "Set-Cookie": oauthStateCookie(state) });
};
