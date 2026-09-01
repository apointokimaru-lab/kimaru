const { json, readJson } = require("./_lib/response");
const { sb, eq, defaultOwner, findOwnerById, findOwnerByEmail } = require("./_lib/supabase");
const { createCalendarEvent, createBufferEventsFor } = require("./_lib/google");
const { checkRateLimit, clientIp, RATE_LIMIT_MESSAGE } = require("./_lib/rate-limit");
const zoom = require("./_lib/zoom");
const pinpoint = require("./_lib/pinpoint");
const { sendMail } = require("./_lib/mail");
const { appBaseUrl } = require("./_lib/config");
const { LOCATION_LABELS, formatJst, manageUrl, answerUrl, answersSummary } = require("./_lib/booking-format");
const { GUEST_PROFILE_FIELDS } = require("./_lib/profile-fields");

const APP_ESC = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// ホストのプロフィール項目（値があるものだけ）。相手（ゲスト）向けの表示に使う。値が無い項目は出さない。
// 出してよい項目はここで決めない。`_lib/profile-fields.js` の GUEST_PROFILE_FIELDS が唯一の出どころ
// （ここに独自の配列を持っていたため、公開プロフィールでは内部情報として外していた profile_goal
// ＝「今回キメたいこと・次につなげたいこと」が、メールとカレンダー招待にだけ出ていた・#360）。
function hostProfileFields(profile) {
  return GUEST_PROFILE_FIELDS
    .map(([label, key]) => [label, profile[key]])
    .filter(([, v]) => v != null && String(v).trim());
}
// 公開プロフィールURL（公開設定がoff/slug無しなら空）。
function hostProfileUrl(owner, profile) {
  const slug = owner && owner.slug;
  if (!slug || (profile && profile.profile_public === "off")) return "";
  try { return `${appBaseUrl().replace(/\/+$/, "")}/u/${encodeURIComponent(slug)}`; } catch (_) { return ""; }
}
// 相手（ホスト）のプロフィール節・プレーンテキスト（見出しは「{名前}のプロフィール」、末尾に公開プロフィールURL）。
function hostProfileTextLines(profile, ownerName, url) {
  const fields = hostProfileFields(profile);
  if (!fields.length && !url) return [];
  const lines = [`― ${ownerName}のプロフィール ―`];
  fields.forEach(([label, v]) => lines.push(`${label}: ${String(v).trim()}`));
  if (url) lines.push("", `▼ ${ownerName}のプロフィール`, url);
  return lines;
}
// URLをリンク化しつつHTMLエスケープ（メール本文用）。
function linkifyEscape(line) {
  return String(line).split(/(https?:\/\/[^\s]+)/g)
    .map((p, i) => (i % 2 ? `<a href="${APP_ESC(p)}">${APP_ESC(p)}</a>` : APP_ESC(p))).join("");
}
// テキスト行配列 → HTML。公開プロフィールURL行は「{名前}のプロフィール」文言のハイパーリンクにする。
function linesToHtml(lines, profileUrl, profileLabel) {
  const out = [];
  for (const ln of lines) {
    if (profileUrl && ln === `▼ ${profileLabel}`) continue; // ラベル行はハイパーリンクに統合
    if (profileUrl && ln === profileUrl) { out.push(`<a href="${APP_ESC(profileUrl)}">${APP_ESC(profileLabel)}</a>`); continue; }
    out.push(linkifyEscape(ln));
  }
  return `<div style="font-family:sans-serif;line-height:1.75;color:#1a1d24">${out.join("<br>")}</div>`;
}
exports.hostProfileFields = hostProfileFields; // テスト用に公開（handler には影響なし）
exports.hostProfileTextLines = hostProfileTextLines;
exports.linesToHtml = linesToHtml;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ホスト（担当者）の公開プロフィール（表示名・肩書き/活動内容・提供できる価値）。
// リマインダーと同じ profiles.data を参照。未マイグレーション/失敗時は {} にフォールバック。
async function ownerProfileData(ownerId) {
  try {
    const rows = await sb(`profiles?owner_id=${eq(ownerId)}&limit=1`);
    const row = rows[0];
    return row && row.data && Object.keys(row.data).length ? row.data : {};
  } catch (_) {
    return {};
  }
}

// 予約完了メール（ゲスト宛・任意・非致命）。管理（変更/キャンセル）リンク＋ホストのプロフィール付き。Resend 未設定ならスキップ。
async function sendBookingConfirmation({ booking, owner, meetingUrl, locationValue, profile }) {
  const prof = profile || await ownerProfileData(owner?.id);
  const ownerName = prof.profile_name || owner?.name || owner?.email || "担当者";
  const profUrl = hostProfileUrl(owner, prof);
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
  // 相手（ホスト）のプロフィール — 見出しは「{名前}のプロフィール」、値のある項目だけ、末尾に公開プロフィールへのリンク。
  const profileLines = hostProfileTextLines(prof, ownerName, profUrl);
  if (profileLines.length) lines.push("", ...profileLines);
  lines.push("", "▼ 予約の変更・キャンセルはこちら", manageUrl(booking.id), "", "当日お会いできるのを楽しみにしています。");
  const text = lines.join("\n");
  const html = linesToHtml(lines, profUrl, `${ownerName}のプロフィール`);
  return sendMail({ to: booking.visitor_email, subject: `予約が確定しました（${when}）`, text, html });
}

// 新規予約のホスト（主催者）宛通知メール（任意・非致命）。無料版でも予約に気づける。
async function sendHostNotification({ booking, owner, meetingUrl, locationValue, answers, booker, zoomFailure }) {
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
  // Zoom自動発行に失敗＝ゲストに参加URLが届いていない。ホストが自分で連絡できるよう明示する。
  if (zoomFailure) {
    lines.push(
      "",
      "⚠ ZoomミーティングURLを自動発行できませんでした。ゲストには参加URLが届いていません。",
      zoomFailure === "not_connected"
        ? "設定 → 外部連携 → Zoom連携 からZoomアカウントを接続し、この予約のURLは個別にご連絡ください。"
        : "Zoom連携を解除して再接続したうえで、この予約のURLは個別にご連絡ください。",
      `${appBaseUrl()}/settings.html#integrations`
    );
  }
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

    // ピンポイント日程調整リンク（#303）経由の予約は、提示した候補の中からしか取らせない。
    // 画面が候補だけを出していても、候補外の時刻を直接POSTされうるのでサーバ側で検証する。
    let pinpointLink = null;
    if (String(body.pinpoint_token || "").trim()) {
      pinpointLink = await pinpoint.findByToken(body.pinpoint_token);
      if (!pinpointLink) return json(404, { error: "この日程調整リンクは見つかりませんでした" });
      if (!bookingPage || pinpointLink.booking_page_id !== bookingPage.id) {
        return json(400, { error: "この日程調整リンクではこの予約ページを利用できません" });
      }
      if (!pinpoint.includesSlot(pinpointLink, start.toISOString())) {
        return json(400, { error: "選択された日程は候補に含まれていません。画面を開き直してお選びください" });
      }
    }
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
    // 発行できなかった理由。ホストへの通知メールで知らせる（未連携のまま「Zoom自動発行」を選んでいると
    // ゲストに参加URLが1つも届かないため、無言のフォールバックにしない）。
    let zoomFailure = "";
    if (booking?.id && bookingPayload.location_type === "zoom") {
      try {
        const durationMinutes = Math.max(1, Math.round((end - start) / 60000));
        const meeting = await zoom.createMeetingFor(owner.id, { topic: booking.topic || `面談: ${visitorName}`, startIso: start.toISOString(), durationMinutes });
        if (meeting?.joinUrl) {
          zoomUrl = meeting.joinUrl;
          booking.meeting_url = zoomUrl;
          await sb(`bookings?id=eq.${booking.id}`, { method: "PATCH", body: JSON.stringify({ meeting_url: zoomUrl }) }).catch(() => null);
        } else {
          // createMeetingFor が null＝未設定 or Zoom未連携。予約は成立させ、ホストに連携を促す。
          zoomFailure = "not_connected";
          console.error("[book] zoom skipped: no connection", { owner_id: owner.id, booking_id: booking.id });
        }
      } catch (error) {
        // トークン失効・API エラー等。手動URL（location_value）運用にフォールバックしつつ記録する。
        zoomFailure = "api_error";
        console.error("[book] zoom create failed", { owner_id: owner.id, booking_id: booking.id, message: error.message });
      }
    }

    // 事前アンケート回答を保存（questionnaire_answers）。失敗してもブッキングは成立させる。
    //
    // question_text を回答側にも保存（非正規化）する理由（#304）:
    // ホストが予約ページを保存するたび booking-page-save.js は questionnaire_questions を
    // 全削除→再作成する。FK が on delete set null なので、過去の回答の question_id は
    // その時点で null になり、質問文を引けなくなる（本番では回答429件中298件がこの状態だった）。
    // 質問文は「その回答が何に対するものか」そのものなので、回答時点の文言を控えておく。
    // 質問が後から書き換えられても、回答は当時聞かれた文言のまま残るのが正しい。
    const answers = Array.isArray(body.answers) ? body.answers : [];
    if (booking?.id && answers.length) {
      // 質問文はクライアント任せにせず、まず予約ページの質問マスタから引く（権威ある文言）。
      // 引けるのは question_id を持つ回答だけ。id を持たない「今回お話したい内容」
      // （質問未設定ページの既定質問。booking-week.js が id:null で送る）は送信値を使う。
      const textById = {};
      if (bookingPage?.id) {
        const qs = await sb(`questionnaire_questions?booking_page_id=${eq(bookingPage.id)}&select=id,question_text`).catch(() => []);
        (qs || []).forEach((q) => { textById[q.id] = q.question_text; });
      }
      const answerRows = answers
        .map((answer) => ({
          booking_id: booking.id,
          question_id: answer.question_id || null,
          question_text: clean(textById[answer.question_id] || answer.question_text, 300),
          answer_text: clean(answer.answer_text, 2000),
        }))
        // 未回答（任意項目）も行として残す（#307）。落とすと質問自体が記録から消えるため、
        // 「どの質問に対して答えが無かったのか」が後から分からなくなる。
        // ただし質問を特定できない行（idも文言も無い）は保存しない。
        .filter((answer) => answer.question_id || answer.question_text);
      if (answerRows.length) {
        // question_text 列が未マイグレーションの環境では列を落として保存（従来どおり動く）。
        await sb("questionnaire_answers", { method: "POST", body: JSON.stringify(answerRows) })
          .catch((error) => {
            if (!/question_text/.test(String(error.message || ""))) return;
            const fallback = answerRows.map(({ question_text, ...rest }) => rest);
            return sb("questionnaire_answers", { method: "POST", body: JSON.stringify(fallback) });
          })
          .catch(() => {});
      }
    }

    // カレンダー予定の説明文に「事前アンケート（質問と回答）」＋相手（ホスト）のプロフィールを載せる。
    const qa = answers
      .filter((a) => a && (a.question_id || a.question_text))
      .map((a) => `Q. ${clean(a.question_text, 200) || "質問"}\nA. ${clean(a.answer_text, 2000) || "未回答"}`)
      .join("\n\n");
    // 相手（ホスト）のプロフィール。ゲストのカレンダー予定（招待）にも同じ情報を載せる。
    const ownerProfile = await ownerProfileData(owner.id).catch(() => ({}));
    const ownerDisplayName = ownerProfile.profile_name || owner.name || owner.email || "担当者";
    const ownerProfileLines = hostProfileTextLines(ownerProfile, ownerDisplayName, hostProfileUrl(owner, ownerProfile));
    booking.calendar_description = [
      qa ? `【事前アンケート】\n${qa}` : (booking.topic ? `相談内容: ${booking.topic}` : ""),
      zoomUrl ? `▼ Zoomミーティング\n${zoomUrl}` : "",
      ownerProfileLines.length ? ownerProfileLines.join("\n") : "",
      "— キマルで予約された面談です。",
      `▼ 予約の変更・キャンセル\n${manageUrl(booking.id)}`,
    ].filter(Boolean).join("\n\n");

    const eventResult = await createCalendarEvent(owner.id, booking).catch((error) => ({ error: error.message }));
    if (eventResult?.id) {
      // Zoom URL を上書きしないよう hangoutLink || zoomUrl を採用。
      await sb(`bookings?id=eq.${booking.id}`, { method: "PATCH", body: JSON.stringify({ google_event_id: eventResult.id, meeting_url: eventResult.hangoutLink || zoomUrl || "" }) });
    }

    // ホスト専用の前後バッファ予定（ゲスト非表示）。予約ページでタイトルが設定されている側だけ作る。
    // 予約本体は成立済みなので、ここでの失敗・列未マイグレーションは非致命（try/catch で握りつぶす）。
    if (booking?.id && bookingPage) {
      try {
        const bufferIds = await createBufferEventsFor(owner.id, booking, bookingPage);
        if (bufferIds.before || bufferIds.after) {
          await sb(`bookings?id=eq.${booking.id}`, {
            method: "PATCH",
            body: JSON.stringify({ buffer_before_event_id: bufferIds.before, buffer_after_event_id: bufferIds.after }),
          }).catch(() => {});
        }
      } catch (_) {
        // バッファ予定は補助機能。失敗しても予約完了レスポンスは返す。
      }
    }

    // 予約完了メール（ゲスト）＋ホスト通知（いずれも任意・非致命）。
    const meetingUrl = eventResult?.hangoutLink || zoomUrl || booking.meeting_url || "";
    const locationValue = clean(body.location_value, 500);
    // 予約者がキマル会員か判定（会員同士なら相互質問の回答導線を有効化・#20）。
    const booker = await findOwnerByEmail(visitorEmail).catch(() => null);
    await sendBookingConfirmation({ booking, owner, meetingUrl, locationValue, profile: ownerProfile }).catch(() => {});
    await sendHostNotification({ booking, owner, meetingUrl, locationValue, answers, booker, zoomFailure }).catch(() => {});

    return json(200, { ok: true, booking, google: eventResult, manage_url: manageUrl(booking.id) });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
