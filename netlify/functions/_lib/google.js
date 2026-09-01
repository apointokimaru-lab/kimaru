const { required, googleRedirectUri } = require("./config");
const { meetingTitle } = require("./booking-format");
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

// 指定窓の予定を busy 区間として返す。freeBusy と違い**イベント単位**で取れるので、
// 「この予定だけ除いて空きを見たい」ができる（#334）。
//
// なぜ要るか: freeBusy は重なり合う予定をマージして1本の区間で返し、イベントIDも返さない。
// ピンポイント（/p/<token>）は自分の押さえだけを除外したいのに、押さえとバッファが重なると
// マージされた1本を丸ごと引くことになり、バッファで埋まっている時間が「空き」に見えていた。
//
// freeBusy と同じ意味になるよう、除外の条件を合わせる:
//   - status:"cancelled" は予定ではない
//   - transparency:"transparent"（予定なし）は空き時間を塞がない（既定は opaque）
//   - 終日予定は start.date/end.date で来る。transparency を尊重するので、
//     「予定なし」の終日予定（Googleの既定）が丸一日を塞ぐことはない
async function eventsBusy(ownerId, timeMin, timeMax, { excludeEventIds = [] } = {}) {
  const accessToken = await accessTokenForOwner(ownerId);
  if (!accessToken) return [];
  const skip = new Set(excludeEventIds.filter(Boolean));
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true", // 繰り返し予定を実体に展開する（展開しないと個々の発生を判定できない）
    maxResults: "2500",
  });
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Googleカレンダーの予定取得に失敗しました");
  return (data.items || [])
    .filter((event) => event && event.status !== "cancelled")
    .filter((event) => event.transparency !== "transparent")
    .filter((event) => !skip.has(event.id))
    .map((event) => ({
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
    }))
    .filter((item) => item.start && item.end);
}

async function createCalendarEvent(ownerId, booking) {
  const accessToken = await accessTokenForOwner(ownerId);
  if (!accessToken) return null;
  const shouldCreateMeet = (booking.location_type || "google_meet") === "google_meet";
  const eventBody = {
    // 予定名は Zoom のミーティング名と同じヘルパから作る（片方だけ直すと食い違う・#358）。
    summary: meetingTitle(booking),
    description: booking.calendar_description != null
      ? booking.calendar_description
      : `${booking.topic || ""}\n\nキマルで予約された面談です。`,
    start: { dateTime: booking.start_at || booking.start_time },
    end: { dateTime: booking.end_at || booking.end_time },
    attendees: booking.visitor_email ? [{ email: booking.visitor_email, displayName: booking.visitor_name }] : [],
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] },
  };
  // Zoom 等の既発行URLがあれば予定の場所欄に載せる（Google招待メールからも参加できるように）。
  if (booking.meeting_url) eventBody.location = booking.meeting_url;
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

// ホスト専用の「自分だけの予定」を1件作成する。attendees を付けず sendUpdates=none なので、
// ゲストには招待も表示もされず、ホスト自身の Google カレンダーにだけ現れる。
// 前後バッファ（#300）と、ピンポイントの押さえ枠（#325）が同じ性質なので共用している。
// description を差し替えられるのは、カレンダー上で「これは何の予定か」が読めないと
// 手で消してよいものか判断できないため（押さえ枠は期限切れ・無効化で自動削除される）。
async function createBufferEvent(ownerId, { summary, startIso, endIso, description }) {
  const accessToken = await accessTokenForOwner(ownerId);
  if (!accessToken) return null;
  const eventBody = {
    summary: summary || "バッファ",
    description: description || "キマルの前後バッファ（自分用の目印）です。",
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    // バッファ予定は「予定あり(busy)」で作る。freeBusy に出るので、空き枠計算がこの時間を
    // 障害物として扱う（#300）。以前は transparent（予定なし）にしていたため、キマル自身が
    // 作ったバッファ予定をキマルの空き枠計算が見つけられず、その上に次の面談が入っていた。
    // 次の予約が入れるのは「バッファ予定の終了時刻 ＋ その予約ページの前バッファ」以降になる。
    transparency: "opaque",
    visibility: "private",
    reminders: { useDefault: false, overrides: [] }, // 通知不要
  };
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Googleカレンダーへのバッファ予定作成に失敗しました");
  return data;
}

// 予約(start_at/end_at)と予約ページ(buffer_*_minutes / buffer_*_title)から、前後の
// バッファ予定をホストのカレンダーに作成する。タイトル未設定 or バッファ0分の側は作らない。
// 戻り値: { before: eventId|null, after: eventId|null }。個々の失敗は握りつぶす（予約本体は成立済み）。
async function createBufferEventsFor(ownerId, booking, page) {
  const out = { before: null, after: null };
  if (!page) return out;
  const start = new Date(booking.start_at || booking.start_time);
  const end = new Date(booking.end_at || booking.end_time);
  if (isNaN(start) || isNaN(end)) return out;
  const bBefore = Math.max(0, Number(page.buffer_before_minutes || 0));
  const bAfter = Math.max(0, Number(page.buffer_after_minutes || 0));
  const tBefore = String(page.buffer_before_title || "").trim();
  const tAfter = String(page.buffer_after_title || "").trim();
  if (bBefore > 0 && tBefore) {
    const ev = await createBufferEvent(ownerId, {
      summary: tBefore,
      startIso: new Date(start.getTime() - bBefore * 60000).toISOString(),
      endIso: start.toISOString(),
    }).catch(() => null);
    out.before = ev?.id || null;
  }
  if (bAfter > 0 && tAfter) {
    const ev = await createBufferEvent(ownerId, {
      summary: tAfter,
      startIso: end.toISOString(),
      endIso: new Date(end.getTime() + bAfter * 60000).toISOString(),
    }).catch(() => null);
    out.after = ev?.id || null;
  }
  return out;
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

module.exports = { googleAuthUrl, exchangeCode, userInfo, saveGoogleConnection, freebusy, eventsBusy, createCalendarEvent, createBufferEvent, createBufferEventsFor, deleteCalendarEvent };
