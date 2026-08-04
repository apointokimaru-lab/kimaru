const crypto = require("crypto");
const { required, optional } = require("./config");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", required("SESSION_SECRET")).update(value).digest("base64url");
}

function sessionCookie(ownerId) {
  const payload = base64url(JSON.stringify({ ownerId, ts: Date.now() }));
  return `kimaru_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`;
}

function clearSessionCookie() {
  return "kimaru_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
}

// 運営セッション（ユーザーの kimaru_session とは完全に別系統の Cookie）。
function adminSessionCookie(operatorId) {
  const payload = base64url(JSON.stringify({ admin: true, operatorId: operatorId || "shared", ts: Date.now() }));
  return `kimaru_admin_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`;
}

function clearAdminSessionCookie() {
  return "kimaru_admin_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part.trim(), ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

const SESSION_MAX_AGE_MS = 2592000000; // 30日（cookie の Max-Age と一致）

function verifyCookieToken(event, cookieName, maxAgeMs = SESSION_MAX_AGE_MS) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || "");
  const raw = cookies[cookieName];
  if (!raw || !raw.includes(".")) return null;
  const [payload, signature] = raw.split(".");
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
  // ts による期限判定：署名が有効でも、30日超過・未来すぎる ts のセッションは無効化する
  // （盗まれた/古い Cookie 値のリプレイを防ぐ。edge 側と同じ TTL を API 側でも強制）。
  if (maxAgeMs) {
    const ts = Number(data && data.ts);
    if (!Number.isFinite(ts) || Date.now() - ts > maxAgeMs || ts - Date.now() > 60000) return null;
  }
  return data;
}

function verifySession(event) {
  return verifyCookieToken(event, "kimaru_session");
}

function verifyAdminSession(event) {
  const session = verifyCookieToken(event, "kimaru_admin_session");
  return session && session.admin ? session : null;
}

// 汎用の定数時間比較（共有シークレット照合などに使用）。
function timingEqual(a, b) {
  const x = Buffer.from(String(a == null ? "" : a));
  const y = Buffer.from(String(b == null ? "" : b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Webhook 署名検証用 HMAC-SHA256（base64）。
function hmacBase64(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64");
}

// OAuth ログインCSRF対策：ランダム state を署名付き短命 cookie に保持し、callback で照合する。
// SameSite=Lax は Google からのトップレベル GET リダイレクトでも送出されるため callback で参照可能。
function oauthStateCookie(state) {
  return `kimaru_oauth_state=${state}.${sign(state)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`;
}
function clearOauthStateCookie() {
  return "kimaru_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
}
function verifyOauthState(event, stateFromQuery) {
  if (!stateFromQuery) return false;
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || "");
  const raw = cookies.kimaru_oauth_state;
  if (!raw) return false;
  // state 自体が "." を含む（連携モードの signBlob 形式 payload.signature）ため、
  // 末尾の "." を署名の区切りとして扱う。verifyBlob と同じ切り出し方。
  const index = raw.lastIndexOf(".");
  if (index <= 0 || index === raw.length - 1) return false;
  const value = raw.slice(0, index);
  if (!timingEqual(raw.slice(index + 1), sign(value))) return false;
  return timingEqual(value, String(stateFromQuery));
}

function encryptionKey() {
  const secret = optional("TOKEN_ENCRYPTION_KEY", required("SESSION_SECRET"));
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function decrypt(value) {
  if (!value) return null;
  const raw = Buffer.from(value, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).startsWith("scrypt$")) return false;
  const [, saltB64, hashB64] = String(stored).split("$");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// 予約の管理（キャンセル/日程変更）リンク用の署名トークン。
// booking id から HMAC で導出するため DB 列は不要。期限は設けない（面談日まで有効）。
function bookingToken(bookingId) {
  return sign(`booking:${bookingId}`);
}

function verifyBookingToken(bookingId, token) {
  if (!bookingId || !token) return false;
  const expected = sign(`booking:${bookingId}`);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 会員同士の相互質問（#20）: ホストが予約者の質問に回答する管理リンク用トークン。
// 予約 id から HMAC で導出。manage トークン（"booking:"）とは別 namespace なので、
// 予約者が持つ manage リンクでは回答ページにアクセスできない（ホスト宛メールにだけ載る）。
function hostAnswerToken(bookingId) {
  return sign(`hostanswer:${bookingId}`);
}
function verifyHostAnswerToken(bookingId, token) {
  if (!bookingId || !token) return false;
  return timingEqual(token, sign(`hostanswer:${bookingId}`));
}

// 汎用の署名付きJSONブロブ（purpose で名前空間分離・発行時刻 ts 内蔵）。
// MCP の OAuth 2.1（client_id・認可コード・アクセス/リフレッシュトークン）など、
// DB を持たないステートレストークンの共通基盤。maxAgeMs=null で無期限。
function signBlob(purpose, data) {
  const payload = base64url(JSON.stringify({ ...data, ts: Date.now() }));
  return `${payload}.${sign(`${purpose}:${payload}`)}`;
}

function verifyBlob(purpose, blob, maxAgeMs) {
  const raw = String(blob || "");
  const index = raw.lastIndexOf(".");
  if (index <= 0 || index === raw.length - 1) return null;
  const payload = raw.slice(0, index);
  if (!timingEqual(raw.slice(index + 1), sign(`${purpose}:${payload}`))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (_) {
    return null;
  }
  const ts = Number(data && data.ts);
  if (!Number.isFinite(ts) || ts - Date.now() > 60000) return null;
  if (maxAgeMs && Date.now() - ts > maxAgeMs) return null;
  return data;
}

// 営業メールのワンクリック解除リンク用の署名トークン。メールアドレスから HMAC で導出（DB列不要・期限なし）。
function mailUnsubToken(email) {
  return sign(`unsub:${String(email || "").trim().toLowerCase()}`);
}

function verifyMailUnsubToken(email, token) {
  if (!email || !token) return false;
  const expected = sign(`unsub:${String(email).trim().toLowerCase()}`);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 期限付き署名トークン（パスワード再設定・メール確認に共用）。`purpose:id:ts` を署名し、ts で期限判定。DB列不要。
function timedToken(purpose, id, ts) {
  return sign(`${purpose}:${id}:${ts}`);
}

function verifyTimedToken(purpose, id, ts, token, maxAgeMs) {
  if (!id || !ts || !token) return false;
  const issued = Number(ts);
  if (!Number.isFinite(issued)) return false;
  // 期限切れ / 未来すぎる ts は拒否。
  if (maxAgeMs && (Date.now() - issued > maxAgeMs || issued - Date.now() > 60000)) return false;
  const expected = sign(`${purpose}:${id}:${ts}`);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sessionCookie, clearSessionCookie, verifySession, adminSessionCookie, clearAdminSessionCookie, verifyAdminSession, encrypt, decrypt, hashPassword, verifyPassword, bookingToken, verifyBookingToken, hostAnswerToken, verifyHostAnswerToken, mailUnsubToken, verifyMailUnsubToken, timedToken, verifyTimedToken, timingEqual, hmacBase64, oauthStateCookie, clearOauthStateCookie, verifyOauthState, signBlob, verifyBlob };
