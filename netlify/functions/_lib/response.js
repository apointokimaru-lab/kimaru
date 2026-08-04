const defaultHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...defaultHeaders, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function redirect(location, headers = {}) {
  return {
    statusCode: 302,
    headers: { ...defaultHeaders, Location: location, ...headers },
    body: "",
  };
}

// HTMLフォームがクロスサイトで送信できる content-type。ここを JSON として解釈しない。
// <form enctype="text/plain"> はフィールド名にJSONの前半・値に後半を置くことで、混入する "=" を
// 文字列リテラルの中に収めた「正しいJSON」を作れてしまう（＝CSRFでJSON APIを叩けてしまう）。
const FORM_CONTENT_TYPES = ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"];

// 本文が無い/壊れている場合と同じく {} を返す（呼び出し側は既存のバリデーションで 400 になる）。
// ※ mcp-oauth-token.js は RFC 6749 の form-urlencoded を自前で URLSearchParams で処理しており、
//    content-type が application/json のときしか readJson を呼ばないのでこの制限の影響を受けない。
function readJson(event) {
  if (!event.body) return {};
  const headers = (event && event.headers) || {};
  let type = "";
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") { type = String(headers[key] || "").toLowerCase(); break; }
  }
  if (FORM_CONTENT_TYPES.some((value) => type.includes(value))) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return {};
  }
}

module.exports = { json, redirect, readJson };
