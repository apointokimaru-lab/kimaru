const crypto = require("crypto");
const { redirect } = require("./_lib/response");
const { googleAuthUrl } = require("./_lib/google");
const { oauthStateCookie } = require("./_lib/crypto");

// ログインCSRF対策：ランダム state を発行し、署名 cookie に保持してから Google へ送る。
// callback で cookie と照合し、攻撃者が用意した code を被害者ブラウザに注入する攻撃を防ぐ。
//
// state の先頭1文字で用途を持ち回る（cookie は署名済みなので改ざん不可）:
//   "c" = 連携（設定画面から。ログイン中ならそのアカウントにカレンダーを繋ぐ＝アカウントを切り替えない）
//   "l" = ログイン／新規登録（login.html・signup.html から。Googleアカウントでログインする）
exports.handler = async (event) => {
  const connect = String((event?.queryStringParameters || {}).connect || "") === "1";
  const state = (connect ? "c" : "l") + crypto.randomBytes(16).toString("hex");
  return redirect(googleAuthUrl(state), { "Set-Cookie": oauthStateCookie(state) });
};
