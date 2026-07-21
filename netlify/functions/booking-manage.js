const { json, readJson } = require("./_lib/response");
const { sb, eq, findOwnerById } = require("./_lib/supabase");
const { verifyBookingToken } = require("./_lib/crypto");
const { createCalendarEvent, createBufferEventsFor, deleteCalendarEvent } = require("./_lib/google");
const zoom = require("./_lib/zoom");
const { sendMail } = require("./_lib/mail");
const { LOCATION_LABELS, formatJst, manageUrl } = require("./_lib/booking-format");

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 署名トークン検証つきで予約を取得（ログイン不要・id だけでは取れない）。
async function loadBooking(id, token) {
  if (!id || !verifyBookingToken(id, token)) return null;
  const rows = await sb(`bookings?id=${eq(id)}&limit=1`).catch(() => []);
  return rows[0] || null;
}

async function bookingPageFor(booking) {
  if (!booking.booking_page_id) return null;
  const rows = await sb(`booking_pages?id=${eq(booking.booking_page_id)}&limit=1`).catch(() => []);
  return rows[0] || null;
}

// 日程変更先スロットの簡易バリデーション（受付時間内・他予約と非重複・リードタイム）。
// availability.js のフル生成（バッファ/祝日/freeBusy/間隔）の厳密な再現ではなく、明確な違反だけを弾く。
// 設定が無い項目はスキップ（正規予約を誤ってブロックしないよう保守的に判定）。
async function rescheduleProblem(booking, start, end) {
  const page = await bookingPageFor(booking);
  const lead = Number(page && page.lead_time_hours) || 0;
  if (lead > 0 && start.getTime() < Date.now() + lead * 3600 * 1000) {
    return "受付開始までの時間（リードタイム）を満たしていません";
  }
  const avail = await sb(`availability_settings?owner_id=${eq(booking.owner_id)}&select=day_of_week,start_time,end_time`).catch(() => []);
  if (Array.isArray(avail) && avail.length) {
    const toJst = (d) => { const j = new Date(d.getTime() + 9 * 3600 * 1000); return { dow: j.getUTCDay(), min: j.getUTCHours() * 60 + j.getUTCMinutes() }; };
    const hhmm = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const s = toJst(start), e = toJst(end);
    const within = avail.some((a) => a.day_of_week === s.dow && s.min >= hhmm(a.start_time) && (e.dow === s.dow ? e.min : 24 * 60) <= hhmm(a.end_time));
    if (!within) return "受付時間外の日時です。空いている時間を選び直してください";
  }
  const others = await sb(`bookings?owner_id=${eq(booking.owner_id)}&status=eq.confirmed&select=id,start_at,end_at,start_time,end_time&limit=300`).catch(() => []);
  for (const b of others || []) {
    if (b.id === booking.id) continue;
    const bs = new Date(b.start_at || b.start_time).getTime();
    const be = new Date(b.end_at || b.end_time).getTime();
    if (Number.isFinite(bs) && Number.isFinite(be) && start.getTime() < be && end.getTime() > bs) {
      return "その時間は他の予約と重複しています。別の時間を選んでください";
    }
  }
  return null;
}

function publicView(booking, owner, page) {
  return {
    id: booking.id,
    status: booking.status,
    visitor_name: booking.visitor_name,
    start_at: booking.start_at || booking.start_time,
    end_at: booking.end_at || booking.end_time,
    location_type: booking.location_type,
    location_label: LOCATION_LABELS[booking.location_type] || booking.location_type || "",
    meeting_url: booking.meeting_url || "",
    host_name: owner?.name || "",
    slug: page?.slug || "",
    page_title: page?.title || "",
  };
}

// キャンセル/日程変更時にゲスト＋ホストへ通知（いずれも非致命）。
async function notify({ booking, owner, kind, before, meetingUrl }) {
  const when = formatJst(booking.start_at || booking.start_time);
  const ownerName = owner?.name || owner?.email || "担当者";
  const guestName = booking.visitor_name || "";
  let guest;
  let host;
  if (kind === "cancel") {
    guest = { subject: `予約をキャンセルしました（${when}）`, lines: [`${guestName}さん`, "", "以下の予約をキャンセルしました。", `お相手: ${ownerName}`, `日時: ${when}`, "", "またのご予約をお待ちしています。"] };
    host = { subject: `予約がキャンセルされました（${when} / ${guestName}さん）`, lines: [`${owner?.name || ""}さん`, "", "予約がキャンセルされました。", `お名前: ${guestName}`, `日時: ${when}`] };
  } else {
    guest = { subject: `予約の日程を変更しました（${when}）`, lines: [`${guestName}さん`, "", "予約の日程を変更しました。", `お相手: ${ownerName}`, `変更前: ${before}`, `変更後: ${when}`] };
    if (meetingUrl) guest.lines.push(`ミーティング: ${meetingUrl}`);
    guest.lines.push("", "▼ 予約の変更・キャンセルはこちら", manageUrl(booking.id));
    host = { subject: `予約の日程が変更されました（${when} / ${guestName}さん）`, lines: [`${owner?.name || ""}さん`, "", "予約の日程が変更されました。", `お名前: ${guestName}`, `変更前: ${before}`, `変更後: ${when}`] };
  }
  if (booking.visitor_email) await sendMail({ to: booking.visitor_email, subject: guest.subject, text: guest.lines.join("\n") }).catch(() => {});
  if (owner?.email) await sendMail({ to: owner.email, subject: host.subject, text: host.lines.join("\n") }).catch(() => {});
}

exports.handler = async (event) => {
  try {
    // 取得（管理ページ初期表示）
    if (event.httpMethod === "GET") {
      const id = clean(event.queryStringParameters?.id, 64);
      const booking = await loadBooking(id, event.queryStringParameters?.t || "");
      if (!booking) return json(404, { error: "予約が見つからないか、リンクが無効です" });
      const owner = await findOwnerById(booking.owner_id);
      const page = await bookingPageFor(booking);
      return json(200, { booking: publicView(booking, owner, page) });
    }

    // 操作（キャンセル / 日程変更）
    if (event.httpMethod === "POST") {
      const body = readJson(event);
      const id = clean(body.id, 64);
      const booking = await loadBooking(id, body.t);
      if (!booking) return json(404, { error: "予約が見つからないか、リンクが無効です" });
      const owner = await findOwnerById(booking.owner_id);
      const action = String(body.action || "");

      if (action === "cancel") {
        if (booking.status === "cancelled") return json(200, { ok: true, status: "cancelled" });
        await sb(`bookings?id=${eq(booking.id)}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
        if (booking.google_event_id) await deleteCalendarEvent(booking.owner_id, booking.google_event_id).catch(() => {});
        // ホスト専用のバッファ予定も削除（列未マイグレーション環境では id が undefined でスキップ）。
        if (booking.buffer_before_event_id) await deleteCalendarEvent(booking.owner_id, booking.buffer_before_event_id).catch(() => {});
        if (booking.buffer_after_event_id) await deleteCalendarEvent(booking.owner_id, booking.buffer_after_event_id).catch(() => {});
        // Zoom 予約はホスト名義のミーティングも削除（非致命・IDは meeting_url から復元）。
        if (booking.location_type === "zoom") await zoom.deleteMeetingByUrl(booking.owner_id, booking.meeting_url).catch(() => {});
        await notify({ booking, owner, kind: "cancel" });
        return json(200, { ok: true, status: "cancelled" });
      }

      if (action === "reschedule") {
        if (booking.status === "cancelled") return json(400, { error: "キャンセル済みの予約は変更できません" });
        const start = parseDate(body.start);
        const end = parseDate(body.end);
        if (!start || !end || start >= end) return json(400, { error: "日時が正しくありません" });
        const now = new Date();
        const maxFuture = new Date(now);
        maxFuture.setMonth(maxFuture.getMonth() + 6);
        if (start < now || start > maxFuture) return json(400, { error: "予約できる期間外の日時です" });
        // 受付時間/重複/リードタイムの再検証（ブロック時間・ダブルブッキングへのリスケを防ぐ）。
        const problem = await rescheduleProblem(booking, start, end);
        if (problem) return json(400, { error: problem });

        const before = formatJst(booking.start_at || booking.start_time);
        const updated = { ...booking, start_at: start.toISOString(), end_at: end.toISOString(), start_time: start.toISOString(), end_time: end.toISOString() };
        updated.calendar_description = `${booking.topic ? `相談内容: ${booking.topic}\n\n` : ""}— キマルで予約された面談です（日程変更）。\n\n▼ 予約の変更・キャンセル\n${manageUrl(booking.id)}`;
        // 先に新しい時間で予定を作成し、成功時のみ旧予定を削除して差し替える（booking 行は同一＝管理リンク不変）。
        // 作成失敗時は旧 google_event_id / meeting_url を据え置き、旧イベントは削除しない（孤立イベント・ID喪失を防ぐ）。
        const eventResult = await createCalendarEvent(booking.owner_id, updated).catch(() => null);
        const patch = { start_at: updated.start_at, end_at: updated.end_at, start_time: updated.start_time, end_time: updated.end_time };
        let meetingUrl = booking.meeting_url || "";
        if (eventResult?.id) {
          if (booking.google_event_id) await deleteCalendarEvent(booking.owner_id, booking.google_event_id).catch(() => {});
          patch.google_event_id = eventResult.id;
          // Zoom 予約の meeting_url は Zoom の join_url のまま維持する（hangoutLink で上書きするとURLが消える）。
          if (booking.location_type !== "zoom") {
            meetingUrl = eventResult.hangoutLink || "";
            patch.meeting_url = meetingUrl;
          }
        }
        // Zoom 予約は既存ミーティングの日時を新しい時間に更新（URL不変・失敗は非致命）。
        if (booking.location_type === "zoom") {
          const durationMinutes = Math.max(1, Math.round((end - start) / 60000));
          await zoom.updateMeetingByUrl(booking.owner_id, booking.meeting_url, { startIso: updated.start_at, durationMinutes }).catch(() => {});
        }
        await sb(`bookings?id=${eq(booking.id)}`, { method: "PATCH", body: JSON.stringify(patch) });

        // ホスト専用の前後バッファ予定を新しい時間で作り直す（旧予定は削除）。補助機能なので失敗は非致命。
        try {
          const page = await bookingPageFor(booking);
          const newBuffer = await createBufferEventsFor(booking.owner_id, updated, page);
          if (booking.buffer_before_event_id) await deleteCalendarEvent(booking.owner_id, booking.buffer_before_event_id).catch(() => {});
          if (booking.buffer_after_event_id) await deleteCalendarEvent(booking.owner_id, booking.buffer_after_event_id).catch(() => {});
          await sb(`bookings?id=${eq(booking.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ buffer_before_event_id: newBuffer.before, buffer_after_event_id: newBuffer.after }),
          }).catch(() => {});
        } catch (_) {
          // 列未マイグレーション or カレンダー未連携。日程変更自体は成立させる。
        }

        await notify({ booking: { ...updated, meeting_url: meetingUrl }, owner, kind: "reschedule", before, meetingUrl });
        return json(200, { ok: true, status: "confirmed", start_at: updated.start_at, end_at: updated.end_at, meeting_url: meetingUrl });
      }

      return json(400, { error: "不正な操作です" });
    }

    return json(405, { error: "許可されていない操作です" });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
