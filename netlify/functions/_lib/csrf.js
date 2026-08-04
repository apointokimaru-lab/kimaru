// クロスサイトからのブラウザ送信を弾く（ログインCSRF対策）。
//
// 背景: セッションを発行するエンドポイント（auth-login / auth-register / operator-login）に
// CSRF 対策が無いと、攻撃サイトが被害者のブラウザを「攻撃者のアカウント」でログイン状態にできる。
// そのセッションを土台に、Google連携などの後続フローを攻撃者のアカウントへ紐づけられてしまう。
//
// 判定方針:
//  - Sec-Fetch-Site: cross-site → 拒否（現代のブラウザは必ず送る）
//  - Origin があればホスト一致を要求（カスタムドメイン / netlify.app / localhost のいずれでも通るよう
//    リクエスト自身の Host を許可リストに入れる）
//  - Origin も Sec-Fetch-Site も無い（curl・サーバ間呼び出し）ものは通す。
//    止めたいのは「ブラウザ発のクロスサイト送信」だけで、非ブラウザ経路を塞ぐ意図は無い。
const { appBaseUrl } = require("./config");

function header(event, name) {
  const headers = (event && event.headers) || {};
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return String(headers[key] || "");
  }
  return "";
}

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch (_) {
    return "";
  }
}

function isCrossSiteRequest(event) {
  const site = header(event, "sec-fetch-site").toLowerCase();
  if (site === "cross-site") return true;
  const origin = header(event, "origin");
  // Origin: null（sandbox iframe や一部のリダイレクト）は同一サイトの証明にならないので拒否する。
  if (origin === "null") return true;
  if (!origin) return false;
  const originHost = hostOf(origin);
  if (!originHost) return true;
  const allowed = new Set(
    [header(event, "host"), header(event, "x-forwarded-host"), hostOf(appBaseUrl())]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean)
  );
  return !allowed.has(originHost);
}

module.exports = { isCrossSiteRequest };
