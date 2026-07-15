const { json, readJson } = require("./_lib/response");
const { sb, eq, defaultOwner, findOwnerById, findOwnerByEmail } = require("./_lib/supabase");
const { createCalendarEvent } = require("./_lib/google");
const { checkRateLimit, clientIp, RATE_LIMIT_MESSAGE } = require("./_lib/rate-limit");
const zoom = require("./_lib/zoom");
const { sendMail } = require("./_lib/mail");
const { LOCATION_LABELS, formatJst, manageUrl, answerUrl, answersSummary } = require("./_lib/booking-format");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 予約完了メール（ゲスト宛・任意・非致命）。管理（変更/キャンセル）リンク付き。Resend 未設定ならスキップ。
async function sendBookingConfirmation({ booking, owner, meetingUrl, locationValue }) {
  const ownerName = owner?.name || owner?.email || "担当者";
  const when = formatJst(booking.start_at || booking.start_time);
  const lines = [
    `${booking.visitor_name || ""}さん`,
    "",
    "ご予約ありがとうございます。以下の内容で確定しました。",
    `お相手: ${ownerName}`,
    `日時: ${when}`,
    `開催方法: ${LOCATION_LABELS[booking.location_type] || booking.location_type || "オンライン"}`,
  ];
  if (meetingUrl) lines.push(`ミーティング: ${meetingUrl}`);
  if (locationValue) lines.push(`場所/案内: ${locationValue}`);
  lines.push("", "▼ 予約の変更・キャンセルはこちら", manageUrl(booking.id), "", "当日お会いできるのを楽しみにしています。");
  return sendMail({ to: booking.visitor_email, subject: `予約が確定しました（${when}）`, text: lines.join("\n") });
}

// 新規予約のホスト（主催者）宛通知メール（任意・非致命）。無料版でも予約に気づける。
async function sendHostNotification({ booking, owner, meetingUrl, locationValue, answers, booker }) {
  if (!owner?.email) return { skipped: true };
  const when = formatJst(booking.start_at || booking.start_time);
  const qa = answersSummary(answers);
  const lines = [
    `${owner.name || ""}さん`,
    "",
    "新しい予約が入りました。",
    `お名前: ${booking.visitor_name || ""}`,
    `メール: ${booking.visitor_email || ""}`,
    `日時: ${when}`,
    `開催方法: ${LOCATION_LABELS[booking.location_type] || booking.location_type || "オンライン"}`,
  ];
  if (meetingUrl) lines.push(`ミーティング: ${meetingUrl}`);
  if (locationValue) lines.push(`場所/案内: ${locationValue}`);
  if (qa) lines.push("", "― 事前アンケート ―", qa);
  if (booking.guest_message) {
    // 会員同士（予約者が別のキマル会員）なら、回答ページへの導線つきで「回答お願いします」と促す（#20）。
    const memberToMember = booker && owner && booker.id !== owner.id;
    if (memberToMember) {
      lines.push("", `― ${booking.visitor_name || "相手"}さん（キマル会員）からの質問 ―`, booking.guest_message);
      lines.push("", "▼ 相手からも質問があります。回答をお願いします（下記から回答できます）", answerUrl(booking.id));
    } else {
      lines.push("", `― ${booking.visitor_name || "相手"}さんからの質問・メッセージ ―`, booking.guest_message);
    }
  }
  lines.push("", "▼ この予約の変更・キャンセル", manageUrl(booking.id));
  return sendMail({ to: owner.email, subject: `新しい予約: ${when} / ${booking.visitor_name || ""}さん`, text: lines.join("\n") });
}

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRelationshipContext(value) {
  if (!value || value === "none") return null;
  if (String(value).length > 12000) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.kind === "relationship_context" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function sanitizePrivateBirthDate(context, isPrivate) {
  if (!context || !isPrivate) return context;
  return { ...context, birth_date: "非公開", birth_date_private: true };
}

async function createBooking(payload) {
  try {
    return await sb("bookings", { method: "POST", body: JSON.stringify(payload) });
  } catch (error) {
    const message = String(error.message || "");
    const isMissingNewColumn = ["visitor_birth_date", "visitor_birth_date_private", "birthday_message_opt_in", "relationship_profile", "guest_message"].some((column) => message.includes(column));
    if (!isMissingNewColumn) throw error;
    const { visitor_birth_date, visitor_birth_date_private, birthday_message_opt_in, relationship_profile, guest_message, ...fallbackPayload } = payload;
    return sb("bookings", { method: "POST", body: JSON.stringify(fallbackPayload) });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const body = readJson(event);
    const visitorName = clean(body.visitor_name, 100);
    const visitorEmail = clean(body.visitor_email, 254).toLowerCase();
    const start = parseDate(body.start);
    const end = parseDate(body.end);
    if (!start || !end || !visitorEmail || !visitorName) return json(400, { error: "必須項目が未入力です（時間枠・お名前・メールアドレスをご確認ください）" });
    if (!EMAIL_RE.test(visitorEmail)) return json(400, { error: "メールアドレスの形式が正しくありません" });
    if (start >= end) return json(400, { error: "予約時間が正しくありません" });
    const now = new Date();
    const maxFuture = new Date(now);
    maxFuture.setMonth(maxFuture.getMonth() + 6);
    if (start < now || start > maxFuture) return json(400, { error: "予約できる期間外の日時です" });

    // 予約スパム/カレンダー・メール濫用の抑止（IP別）。
    const rl = await checkRateLimit({ bucket: "book_ip", ident: clientIp(event), limit: 20, windowSec: 3600 });
    if (!rl.allowed) return json(429, { error: RATE_LIMIT_MESSAGE });

    // owner_slug で予約ページ＋オーナーを解決（無ければ既定オーナー）。
    const slug = String(body.owner_slug || "").trim().toLowerCase();
    let owner = null;
    let bookingPage = null;
    if (slug && slug !== "demo") {
      const pages = await sb(`booking_pages?slug=${eq(slug)}&limit=1`).catch(() => []);
      bookingPage = pages[0] || null;
      if (bookingPage) owner = await findOwnerById(bookingPage.owner_id);
    }
    if (!owner) owner = await defaultOwner();
    if (!owner) return json(400, { error: "予約先が設定されていません。発行者がGoogleでログインしているかご確認ください" });
    // 利用停止（cat_key_disabled）アカウントの予約ページは予約不可。
    if (owner.cat_key_disabled) return json(403, { error: "このページは現在ご利用いただけません。" });
    if (bookingPage && bookingPage.is_active === false) return json(400, { error: "このページは現在、予約の受付を停止しています" });
    const relationshipContext = parseRelationshipContext(body.filter_request);
    const birthDatePrivate = body.birth_date_private === "yes" || body.birth_date_private === true;
    const storedRelationshipContext = sanitizePrivateBirthDate(relationshipContext, birthDatePrivate);
    const bookingPayload = {
      owner_id: owner.id,
      booking_page_id: bookingPage?.id || null,
      visitor_name: visitorName,
      visitor_email: visitorEmail,
      guest_name: visitorName,
      guest_email: visitorEmail,
      topic: clean(body.topic, 2000),
      guest_message: clean(body.guest_message, 2000),
      filter_request: storedRelationshipContext ? JSON.stringify(storedRelationshipContext) : clean(body.filter_request || "none", 12000),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      // 開催方法は予約ページの設定（サーバ側）を正とする。フロントは location_type を送っておらず、
      // body 値に頼ると全予約が既定 google_meet になる（ページ無しのデモ経路のみ body を許容）。
      location_type: clean(bookingPage?.location_type || body.location_type || "google_meet", 40),
      status: "confirmed",
    };
    if (relationshipContext) {
      // visitor_birth_date は date 型。非公開や不正値（"非公開"等）は入れず null にする。
      // 公開かつ YYYY-MM-DD 形式のときだけ日付を保存。非公開の旨は filter_request(JSON) と private フラグに保持。
      const rawBirth = String(relationshipContext.birth_date || "");
      const validBirth = !birthDatePrivate && /^\d{4}-\d{2}-\d{2}$/.test(rawBirth) ? rawBirth : null;
      bookingPayload.visitor_birth_date = validBirth;
      bookingPayload.visitor_birth_date_private = birthDatePrivate;
      bookingPayload.birthday_message_opt_in = Boolean(relationshipContext.birthday_message_opt_in);
      bookingPayload.relationship_profile = relationshipContext.profile || {};
    }
    const rows = await createBooking(bookingPayload);
    const booking = rows[0];

    // Zoom 自動発行（#23）。ホスト本人の Zoom 連携（zoom_connections）があれば本人名義で作成して URL を採用。
    let zoomUrl = "";
    if (booking?.id && bookingPayload.location_type === "zoom") {
      try {
        const durationMinutes = Math.max(1, Math.round((end - start) / 60000));
        const meeting = await zoom.createMeetingFor(owner.id, { topic: booking.topic || `面談: ${visitorName}`, startIso: start.toISOString(), durationMinutes });
        if (meeting?.joinUrl) {
          zoomUrl = meeting.joinUrl;
          booking.meeting_url = zoomUrl;
          await sb(`bookings?id=eq.${booking.id}`, { method: "PATCH", body: JSON.stringify({ meeting_url: zoomUrl }) }).catch(() => null);
        }
      } catch (_) {
        // 失敗時は手動URL（location_value）運用にフォールバック。
      }
    }

    // 事前アンケート回答を保存（questionnaire_answers）。失敗してもブッキングは成立させる。
    const answers = Array.isArray(body.answers) ? body.answers : [];
    if (booking?.id && answers.length) {
      const answerRows = answers
        .map((answer) => ({
          booking_id: booking.id,
          question_id: answer.question_id || null,
          answer_text: clean(answer.answer_text, 2000),
        }))
        .filter((answer) => answer.answer_text);
      if (answerRows.length) {
        await sb("questionnaire_answers", { method: "POST", body: JSON.stringify(answerRows) }).catch(() => {});
      }
    }

    // カレンダー予定の説明文に「事前アンケート（質問と回答）」を載せる。
    const qa = answers
      .filter((a) => a && a.answer_text)
      .map((a) => `Q. ${clean(a.question_text, 200) || "質問"}\nA. ${clean(a.answer_text, 2000)}`)
      .join("\n\n");
    booking.calendar_description = [
      qa ? `【事前アンケート】\n${qa}` : (booking.topic ? `相談内容: ${booking.topic}` : ""),
      zoomUrl ? `▼ Zoomミーティング\n${zoomUrl}` : "",
      "— キマルで予約された面談です。",
      `▼ 予約の変更・キャンセル\n${manageUrl(booking.id)}`,
    ].filter(Boolean).join("\n\n");

    const eventResult = await createCalendarEvent(owner.id, booking).catch((error) => ({ error: error.message }));
    if (eventResult?.id) {
      // Zoom URL を上書きしないよう hangoutLink || zoomUrl を採用。
      await sb(`bookings?id=eq.${booking.id}`, { method: "PATCH", body: JSON.stringify({ google_event_id: eventResult.id, meeting_url: eventResult.hangoutLink || zoomUrl || "" }) });
    }

    // 予約完了メール（ゲスト）＋ホスト通知（いずれも任意・非致命）。
    const meetingUrl = eventResult?.hangoutLink || zoomUrl || booking.meeting_url || "";
    const locationValue = clean(body.location_value, 500);
    // 予約者がキマル会員か判定（会員同士なら相互質問の回答導線を有効化・#20）。
    const booker = await findOwnerByEmail(visitorEmail).catch(() => null);
    await sendBookingConfirmation({ booking, owner, meetingUrl, locationValue }).catch(() => {});
    await sendHostNotification({ booking, owner, meetingUrl, locationValue, answers, booker }).catch(() => {});

    return json(200, { ok: true, booking, google: eventResult, manage_url: manageUrl(booking.id) });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
