const crypto = require("crypto");
const { redirect } = require("./_lib/response");
const { googleAuthUrl } = require("./_lib/google");
const { oauthStateCookie } = require("./_lib/crypto");

// ログインCSRF対策：ランダム state を発行し、署名 cookie に保持してから Google へ送る。
// callback で cookie と照合し、攻撃者が用意した code を被害者ブラウザに注入する攻撃を防ぐ。
exports.handler = async () => {
  const state = crypto.randomBytes(16).toString("hex");
  return redirect(googleAuthUrl(state), { "Set-Cookie": oauthStateCookie(state) });
};
