// Zoom ミーティングの自動発行（#23 を 2026-07-15 指示でユーザー個別連携に刷新）。
// ホスト本人が自分の Zoom アカウントを user-level OAuth で接続し（zoom_connections・トークン暗号化保存）、
// 本人名義でミーティングを発行する。運営名義の Server-to-Server 方式は廃止（ZOOM_ACCOUNT_ID 不要に）。
// 環境変数 ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET 未設定なら連携機能ごと無効（既存動作を壊さない）。
const { optional, required, appBaseUrl } = require("./config");
const { encrypt, decrypt } = require("./crypto");
const { sb, eq } = require("./supabase");

function isConfigured() {
  return Boolean(optional("ZOOM_CLIENT_ID", "") && optional("ZOOM_CLIENT_SECRET", ""));
}

function redirectUri() {
  return optional("ZOOM_REDIRECT_URI", `${appBaseUrl()}/api/zoom-auth-callback`);
}

function authorizeUrl(state) {
  const params = new URLSearchParams({ response_type: "code", client_id: required("ZOOM_CLIENT_ID"), redirect_uri: redirectUri(), state });
  return `https://zoom.us/oauth/authorize?${params}`;
}

async function tokenRequest(params) {
  const basic = Buffer.from(`${required("ZOOM_CLIENT_ID")}:${required("ZOOM_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch(`https://zoom.us/oauth/token?${new URLSearchParams(params)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || data.error_description || data.error || "Zoom認証に失敗しました");
  return data;
}

function exchangeCode(code) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
}

async function getConnection(ownerId) {
  try {
    const rows = await sb(`zoom_connections?owner_id=${eq(ownerId)}&limit=1`);
    return rows[0] || null;
  } catch (_) {
    return null; // テーブル未適用の環境は「未連携」として動く
  }
}

async function saveConnection(ownerId, tokens, zoomEmail) {
  const payload = {
    owner_id: ownerId,
    access_token: encrypt(tokens.access_token),
    expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Zoom はリフレッシュのたびに refresh_token もローテーションされる。無い応答では旧値を保持。
  if (tokens.refresh_token) payload.refresh_token = encrypt(tokens.refresh_token);
  if (zoomEmail) payload.zoom_email = zoomEmail;
  const existing = await sb(`zoom_connections?owner_id=${eq(ownerId)}&select=id&limit=1`);
  if (existing[0]) return sb(`zoom_connections?id=${eq(existing[0].id)}`, { method: "PATCH", body: JSON.stringify(payload) });
  return sb("zoom_connections", { method: "POST", body: JSON.stringify(payload) });
}

function deleteConnection(ownerId) {
  return sb(`zoom_connections?owner_id=${eq(ownerId)}`, { method: "DELETE" }).catch(() => null);
}

async function accessTokenFor(connection) {
  if (new Date(connection.expires_at).getTime() > Date.now() + 60000) return decrypt(connection.access_token);
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token) });
  await saveConnection(connection.owner_id, tokens);
  return tokens.access_token;
}

async function zoomUserEmail(accessToken) {
  try {
    const res = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data.email || null : null;
  } catch (_) {
    return null;
  }
}

// ホスト本人の接続でミーティングを作成し join_url を返す。未設定・未連携なら null（予約は成立させる）。
async function createMeetingFor(ownerId, { topic, startIso, durationMinutes }) {
  if (!isConfigured()) return null;
  const connection = await getConnection(ownerId);
  if (!connection) return null;
  const token = await accessTokenFor(connection);
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topic || "面談",
      type: 2, // scheduled meeting
      start_time: startIso,
      duration: durationMinutes || 30,
      timezone: "Asia/Tokyo",
      settings: { join_before_host: true, waiting_room: false },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Zoomミーティングの作成に失敗しました");
  return { id: data.id, joinUrl: data.join_url || "" };
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, getConnection, saveConnection, deleteConnection, accessTokenFor, zoomUserEmail, createMeetingFor };
