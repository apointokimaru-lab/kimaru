const { json } = require("./_lib/response");
const { optional, appBaseUrl } = require("./_lib/config");
const { sb, eq } = require("./_lib/supabase");
const { sendMail } = require("./_lib/mail");
const { timingEqual } = require("./_lib/crypto");
const { briefingUrl, manageUrl } = require("./_lib/booking-format");

// 管理リンク生成は env 未設定で throw しうるので保護（失敗時 null＝リンク行を出さない）。
function safeManageUrl(id) {
  try { return id ? manageUrl(id) : null; } catch (_) { return null; }
}

// 予約開始の約22分前にゲストへ「お相手プロフィール付き」リマインダーメールを送る。
// スケジューラ（Netlify Scheduled Functions / 外部cron）から ~5分間隔で叩く想定。
const LEAD_MINUTES = 22;
const WINDOW_MINUTES = 5; // 実行間隔ぶんの送信ウィンドウ

function isAuthorized(event) {
  const secret = optional("REMINDER_CRON_SECRET", optional("CRON_SECRET", ""));
  if (!secret) return false; // fail-closed: 未設定なら HTTP 経由の手動実行は不可（定期実行は reminder-scheduled が run() を直接呼ぶので影響なし）
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  const querySecret = event.queryStringParameters?.secret || "";
  return timingEqual(authorization, `Bearer ${secret}`) || timingEqual(querySecret, secret);
}

// HTTP 応答用に PII（宛先・本文）を伏せる。dry_run の確認には件数/状態/伏字宛先で十分。
function maskEmail(value) {
  const s = String(value || "");
  const at = s.indexOf("@");
  return at > 0 ? `${s[0]}***${s.slice(at)}` : "***";
}
function redactForHttp(payload) {
  return {
    ...payload,
    results: (payload.results || []).map((r) => {
      const { text, subject, to, error, ...rest } = r;
      return { ...rest, to: to ? maskEmail(to) : undefined, body_chars: text ? text.length : undefined };
    }),
  };
}

function formatJst(iso) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

async function ownerMap() {
  try {
    // slug は Pro 以上の「詳しいプロフィール」リンク（/u/<slug>）生成に使う。
    const rows = await sb("owners?select=id,name,email,plan,slug&limit=10000");
    return new Map((rows || []).map((owner) => [owner.id, owner]));
  } catch (_) {
    return new Map();
  }
}

async function ownerProfile(ownerId) {
  try {
    const rows = await sb(`profiles?owner_id=${eq(ownerId)}&limit=1`);
    const row = rows[0];
    if (!row) return {};
    return row.data && Object.keys(row.data).length ? row.data : {};
  } catch (_) {
    return {};
  }
}

// 予約に紐づく事前アンケート（質問と回答）。question_text は非正規化で保存済み。
// 未マイグレーション環境では空配列にフォールバックし、リマインダー送信自体は止めない。
async function answersForBooking(bookingId) {
  try {
    const rows = await sb(`questionnaire_answers?booking_id=${eq(bookingId)}&select=question_text,answer_text`);
    return (rows || []).filter((r) => r && r.answer_text);
  } catch (_) {
    return [];
  }
}

// Pro 以上のみ：公開プロフィールページ（/u/<slug>）の絶対URL。非公開/slug無しなら空。
function profileUrl(owner, profile) {
  if (!owner?.slug || owner.slug === "demo") return "";
  if (profile.profile_public === "off") return "";
  try {
    return `${appBaseUrl()}/u/${encodeURIComponent(owner.slug)}`;
  } catch (_) {
    return "";
  }
}

// リマインダー本文。全プラン共通で「事前アンケート（質問と回答）＋お相手の基本プロフィール
// （表示名・肩書き/活動内容・相手に提供できる価値）」を載せる。Pro 以上はさらに公開プロフィール
// ページへの「詳しいプロフィールはこちら」リンクを追記する。
function buildMessage(booking, owner, profile, answers, isPro) {
  const guestName = booking.visitor_name || booking.guest_name || "";
  const greeting = guestName ? `${guestName}さん` : "こんにちは";
  const ownerName = profile.profile_name || owner?.name || owner?.email || "お相手";
  const when = formatJst(booking.start_at || booking.start_time);
  const lines = [
    `${greeting}`,
    "",
    `まもなく ${ownerName} との面談です（開始予定: ${when}）。`,
  ];
  if (booking.meeting_url) lines.push(`ミーティング: ${booking.meeting_url}`);

  // 事前アンケート（質問と回答）— 全プラン
  const qa = (answers || [])
    .map((a) => `Q. ${a.question_text || "質問"}\nA. ${a.answer_text}`)
    .join("\n\n");
  if (qa) lines.push("", "― 事前アンケート ―", qa);

  // お相手の基本プロフィール — 全プラン（肩書き/活動内容・相手に提供できる価値があるときのみ枠を出す）
  if (profile.profile_title || profile.profile_offer) {
    lines.push("", "― お相手のプロフィール ―", ownerName);
    if (profile.profile_title) lines.push(`肩書き・活動内容: ${profile.profile_title}`);
    if (profile.profile_offer) lines.push(`相手に提供できる価値: ${profile.profile_offer}`);
    // Pro 以上：詳しい公開プロフィールページへのリンク
    if (isPro) {
      const url = profileUrl(owner, profile);
      if (url) lines.push(`詳しいプロフィールはこちら: ${url}`);
    }
  }

  // 予約管理リンク。確認メールを消したゲストの唯一の再取得手段になるので、リマインダーにも載せる
  // （env 未設定などで生成に失敗しても、リマインダー本体は送る）。
  const manage = safeManageUrl(booking.id);
  if (manage) lines.push("", "▼ 予約の変更・キャンセルはこちら", manage);

  lines.push("", "良い時間になりますように。");
  return { subject: `まもなく面談です（${when}）`, text: lines.join("\n") };
}

// ホスト（主催者）向けのリマインド。相手の詳細（相手の回答・プロフィール・メモ）への
// ワンタップリンクを載せる。相手の詳細は認証必須ページなので、リンクだけでも安全。
function buildHostMessage(booking) {
  const guestName = booking.visitor_name || booking.guest_name || "お相手";
  const guestEmail = booking.visitor_email || booking.guest_email || "";
  const when = formatJst(booking.start_at || booking.start_time);
  const lines = [`まもなく ${guestName} さんとの面談です（開始予定: ${when}）。`];
  if (guestEmail) lines.push(`お相手: ${guestName}（${guestEmail}）`);
  if (booking.meeting_url) lines.push(`ミーティング: ${booking.meeting_url}`);
  lines.push(
    "",
    "▼ 相手の詳細（相手の回答・プロフィール・メモをまとめて確認）",
    briefingUrl(booking.id),
    "※ キマルにログインした状態で開けます。",
    "",
    "良い時間になりますように。"
  );
  return { subject: `【面談リマインド】まもなく ${guestName} さんとの面談です（${when}）`, text: lines.join("\n") };
}

async function alreadySent(bookingId) {
  try {
    const rows = await sb(`reminder_deliveries?booking_id=${eq(bookingId)}&limit=1`);
    return Boolean(rows[0]);
  } catch (_) {
    return false;
  }
}

async function markSent(bookingId, providerMessageId, status, errorMessage = "") {
  try {
    await sb("reminder_deliveries", {
      method: "POST",
      body: JSON.stringify({ booking_id: bookingId, provider_message_id: providerMessageId || "", status, error_message: errorMessage }),
    });
  } catch (_) {
    // 配信記録テーブル未適用でもジョブは止めない
  }
}

// 差出人/返信先（Resend利用時に有効。Gmail利用時はアドレスは GMAIL_USER 固定）。
function reminderFrom() {
  return optional("REMINDER_EMAIL_FROM", optional("BIRTHDAY_EMAIL_FROM", ""));
}
function reminderReplyTo() {
  return optional("REMINDER_EMAIL_REPLY_TO", optional("BIRTHDAY_EMAIL_REPLY_TO", ""));
}

// 送信処理の本体。HTTP ハンドラと Scheduled Function（reminder-scheduled.js）の双方から呼ぶ。
async function run(dryRun) {
  const now = new Date();
  const from = new Date(now.getTime() + (LEAD_MINUTES - WINDOW_MINUTES) * 60 * 1000);
  const to = new Date(now.getTime() + LEAD_MINUTES * 60 * 1000);

  const bookings = await sb(
    `bookings?select=*&status=eq.confirmed&start_at=gte.${encodeURIComponent(from.toISOString())}&start_at=lte.${encodeURIComponent(to.toISOString())}&order=start_at.asc&limit=500`
  );
  const owners = await ownerMap();
  const profileCache = new Map(); // owner_id -> profile data（同一オーナーの重複取得を避ける）

  const results = [];
  for (const booking of bookings || []) {
    const recipient = booking.visitor_email || booking.guest_email || "";
    if (!recipient) {
      results.push({ booking_id: booking.id, status: "skipped", reason: "Missing visitor email" });
      continue;
    }
    if (await alreadySent(booking.id)) {
      results.push({ booking_id: booking.id, to: recipient, status: "skipped", reason: "Already sent" });
      continue;
    }
    const ownerId = booking.owner_id || booking.user_id;
    const owner = owners.get(ownerId);
    const isPro = owner?.plan === "pro" || owner?.plan === "premium";
    // プロフィール（基本項目）は全プランで本文に載せる。Pro 以上のみリンクも付与。
    if (!profileCache.has(ownerId)) profileCache.set(ownerId, await ownerProfile(ownerId));
    const profile = profileCache.get(ownerId) || {};
    const answers = await answersForBooking(booking.id);
    const message = buildMessage(booking, owner, profile, answers, isPro);
    // ホスト（主催者）にもリマインドを送る。相手の詳細のリンク付き。宛先が無ければ送らない。
    const hostMessage = buildHostMessage(booking);
    const hostRecipient = owner?.email || "";
    if (dryRun) {
      results.push({ booking_id: booking.id, to: recipient, status: "dry_run", subject: message.subject, text: message.text });
      if (hostRecipient) results.push({ booking_id: booking.id, to: hostRecipient, kind: "host", status: "dry_run", subject: hostMessage.subject, text: hostMessage.text });
      continue;
    }
    try {
      const sent = await sendMail({ to: recipient, subject: message.subject, text: message.text, from: reminderFrom(), replyTo: reminderReplyTo() });
      if (sent.skipped) {
        results.push({ booking_id: booking.id, to: recipient, status: "dry_run", reason: "メール送信が未設定（Gmail/Resend）", subject: message.subject, text: message.text });
        continue;
      }
      await markSent(booking.id, sent.id, "sent");
      results.push({ booking_id: booking.id, to: recipient, status: "sent", provider_message_id: sent.id });
      // ホスト向けリマインド（任意・失敗しても本処理は継続。重複送信はゲスト側の alreadySent/markSent で一括ガード）。
      if (hostRecipient) {
        try {
          const hostSent = await sendMail({ to: hostRecipient, subject: hostMessage.subject, text: hostMessage.text, from: reminderFrom(), replyTo: reminderReplyTo() });
          results.push({ booking_id: booking.id, to: hostRecipient, kind: "host", status: hostSent.skipped ? "skipped" : "sent", provider_message_id: hostSent.id || "" });
        } catch (hostError) {
          results.push({ booking_id: booking.id, to: hostRecipient, kind: "host", status: "failed", error: hostError.message });
        }
      }
    } catch (error) {
      await markSent(booking.id, "", "failed", error.message);
      results.push({ booking_id: booking.id, to: recipient, status: "failed", error: error.message });
    }
  }

  return { ok: true, window: { from: from.toISOString(), to: to.toISOString() }, due_count: (bookings || []).length, results };
}

exports.run = run;

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "許可されていない操作です" });
  if (!isAuthorized(event)) return json(401, { error: "認証が必要です" });
  const dryRun = event.queryStringParameters?.dry_run === "1" || event.queryStringParameters?.dry_run === "true";
  try {
    return json(200, redactForHttp(await run(dryRun)));
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。" });
  }
};
