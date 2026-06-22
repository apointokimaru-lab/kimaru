const crypto = require("crypto");
const { timingEqual, hmacBase64 } = require("./crypto");
const { optional, appBaseUrl } = require("./config");

// Webhook 認証ヘルパ。各 provider の正規 HMAC 署名を生ボディで検証し、
// 設定が無い場合は従来の共有シークレットヘッダ（定数時間）にフォールバックする。
// いずれの認証情報も未設定なら呼び出し側で fail-closed（503）にする。

function rawBody(event) {
  if (!event || event.body == null) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function headerOf(event, name) {
  const h = event.headers || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || "";
}

// Square: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)) === x-square-hmacsha256-signature
function verifySquareSignature(event, raw) {
  const key = optional("SQUARE_WEBHOOK_SIGNATURE_KEY", "");
  if (!key) return false;
  const sig = headerOf(event, "x-square-hmacsha256-signature");
  if (!sig) return false;
  const url = optional("SQUARE_WEBHOOK_URL", `${appBaseUrl()}/api/square-webhook`);
  return timingEqual(sig, hmacBase64(key, url + raw));
}

// Svix（Resend が採用）: secret は 'whsec_<base64>'。署名対象は `${id}.${ts}.${raw}`。
// ヘッダ svix-signature は 'v1,<b64> v1,<b64>...' のスペース区切り。timestamp で±5分のリプレイ防止。
function verifySvixSignature(event, raw, secret) {
  if (!secret || !secret.startsWith("whsec_")) return false;
  const id = headerOf(event, "svix-id");
  const ts = headerOf(event, "svix-timestamp");
  const sigHeader = headerOf(event, "svix-signature");
  if (!id || !ts || !sigHeader) return false;
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 300000) return false;
  let key;
  try { key = Buffer.from(secret.slice(6), "base64"); } catch (_) { return false; }
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return sigHeader.split(" ").some((part) => {
    const v = part.includes(",") ? part.split(",")[1] : part;
    return timingEqual(v, expected);
  });
}

// 共有シークレットヘッダ（後方互換／中継経由）。定数時間で比較。
function verifySharedSecret(event, secret) {
  if (!secret) return false;
  return timingEqual(headerOf(event, "x-kimaru-webhook-secret"), secret);
}

module.exports = { rawBody, headerOf, verifySquareSignature, verifySvixSignature, verifySharedSecret };
