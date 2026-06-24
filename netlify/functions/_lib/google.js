const { required, googleRedirectUri } = require("./config");
const { encrypt, decrypt } = require("./crypto");
const { sb, eq } = require("./supabase");

// 最小権限: 空き確認(freebusy)＋予定の作成/更新/削除(events) のみ。フルの calendar は要求しない（OAuth審査の最小スコープ要件）。
const scope = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
].join(" ");

function googleAuthUrl(state = "") {
  const params = new URLSearchParams({
    client_id: required("GOOGLE_CLIENT_ID"),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("GOOGLE_CLIENT_ID"), client_secret: required("GOOGLE_CLIENT_SECRET"), redirect_uri: googleRedirectUri(), ...params }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Googleとの認証に失敗しました");
  return data;
}

async function exchangeCode(code) {
  return tokenRequest({ code, grant_type: "authorization_code" });
}

async function userInfo(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error("Googleプロフィールの取得に失敗しました");
  return data;
}

async function saveGoogleConnection(owner, tokens) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const payload = { owner_id: owner.id, access_token: encrypt(tokens.access_token), expires_at: expiresAt, calendar_id: "primary" };
  if (tokens.refresh_token) payload.refresh_token = encrypt(tokens.refresh_token);
  const existing = await sb(`google_connections?owner_id=${eq(owner.id)}&limit=1`);
  if (existing[0]) {
    const rows = await sb(`google_connections?owner_id=${eq(owner.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    return rows[0];
  }
  const rows = await sb("google_connections", { method: "POST", body: JSON.stringify(payload) });
  return rows[0];
}

async function connectionForOwner(ownerId) {
  const rows = await sb(`google_connections?owner_id=${eq(ownerId)}&limit=1`);
  return rows[0] || null;
}

async function accessTokenForOwner(ownerId) {
  const connection = await connectionForOwner(ownerId);
  if (!connection) return null;
  if (new Date(connection.expires_at).getTime() > Date.now() + 60000) return decrypt(connection.access_token);
  const tokens = await tokenRequest({ refresh_token: decrypt(connection.refresh_token), grant_type: "refresh_token" });
  await saveGoogleConnection({ id: ownerId }, tokens);
  return tokens.access_token;
}

async function freebusy(ownerId, timeMin, timeMax) {
  const accessToken = await accessTokenForOwner(ownerId);
  if (!accessToken) return [];
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Googleカレンダーの空き時間取得に失敗しました");
  return data.calendars?.primary?.busy || [];
}

async function createCalendarEvent(ownerId, booking) {
  const accessToken = await accessTokenForOwner(ownerId);
  if (!accessToken) return null;
  const shouldCreateMeet = (booking.location_type || "google_meet") === "google_meet";
  const eventBody = {
    summary: `キマル：${booking.visitor_name || booking.guest_name || "面談"} さんとの面談`,
    description: booking.calendar_description != null
      ? booking.calendar_description
      : `${booking.topic || ""}\n\nキマルで予約された面談です。`,
    start: { dateTime: booking.start_at || booking.start_time },
    end: { dateTime: booking.end_at || booking.end_time },
    attendees: booking.visitor_email ? [{ email: booking.visitor_email, displayName: booking.visitor_name }] : [],
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] },
  };
  if (shouldCreateMeet) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `kimaru-${booking.id || Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Googleカレンダーへの予定作成に失敗しました");
  return data;
}

// 予約キャンセル/日程変更時にカレンダー予定を削除。連携なし・既に削除済み(404/410)は成功扱い。
async function deleteCalendarEvent(ownerId, eventId) {
  if (!eventId) return { skipped: true };
  const accessToken = await accessTokenForOwner(ownerId);
  if (!accessToken) return { skipped: true };
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (response.ok || response.status === 404 || response.status === 410) return { ok: true };
  const data = await response.json().catch(() => ({}));
  throw new Error(data.error?.message || "Googleカレンダーの予定削除に失敗しました");
}

module.exports = { googleAuthUrl, exchangeCode, userInfo, saveGoogleConnection, freebusy, createCalendarEvent, deleteCalendarEvent };
