const { json } = require("./_lib/response");
const { optional, appBaseUrl } = require("./_lib/config");
const { sb, eq } = require("./_lib/supabase");
const { sendMail } = require("./_lib/mail");
const { timingEqual } = require("./_lib/crypto");

// 会員獲得の自動導線（決定22・#181）。前日に面談した相手のうち「キマル未登録」の人へ、
// 翌日にサンキュー＋登録案内メールを送る。marketing 経路（List-Unsubscribe＋サプレッション）で送るため、
// 配信停止済み・既存会員には届かない。「終了判定」は《予約日の翌日》という単純なヒューリスティック。

function isAuthorized(event) {
  const secret = optional("THANKYOU_CRON_SECRET", optional("CRON_SECRET", ""));
  if (!secret) return false; // fail-closed: 未設定なら HTTP 経由は不可（定期実行は thankyou-scheduled が run() を直接呼ぶ）
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  const querySecret = event.queryStringParameters?.secret || "";
  return timingEqual(authorization, `Bearer ${secret}`) || timingEqual(querySecret, secret);
}

// HTTP 応答用に PII（宛先・本文）を伏せる。
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

// JST の「昨日」00:00〜「今日」00:00 に対応する UTC 範囲。
function jstYesterdayRange() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const todayStartUtc = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - 9 * 3600 * 1000);
  const yesterdayStartUtc = new Date(todayStartUtc.getTime() - 24 * 3600 * 1000);
  return { from: yesterdayStartUtc, to: todayStartUtc };
}

// 登録済み会員（owners）のメール集合。ここに載っている相手には送らない。
async function memberEmailSet() {
  try {
    const rows = await sb("owners?select=email&limit=10000");
    return new Set((rows || []).map((o) => String(o.email || "").trim().toLowerCase()).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

async function alreadySent(bookingId) {
  try {
    const rows = await sb(`thankyou_deliveries?booking_id=${eq(bookingId)}&limit=1`);
    return Boolean(rows[0]);
  } catch (_) {
    return false;
  }
}

async function markSent(bookingId, recipient, providerMessageId, status, errorMessage = "") {
  try {
    await sb("thankyou_deliveries", {
      method: "POST",
      body: JSON.stringify({ booking_id: bookingId, recipient_email: recipient, provider_message_id: providerMessageId || "", status, error_message: errorMessage }),
    });
  } catch (_) {
    // 配信記録テーブル未適用でもジョブは止めない。
  }
}

function buildMessage(booking) {
  const guestName = booking.visitor_name || booking.guest_name || "";
  const greeting = guestName ? `${guestName}さん` : "こんにちは";
  const registerUrl = `${appBaseUrl()}/login.html`;
  const text = [
    greeting,
    "",
    "先日はお時間をいただき、ありがとうございました。",
    "",
    "この日程調整は、無料の1対1日程調整ツール「キマル」で行われました。",
    "あなたも無料で、空き時間の自動調整・予約管理・面談前リマインダーをご利用いただけます。",
    `ご登録はこちら: ${registerUrl}`,
    "",
    "――",
    "このメールは、キマルで日程調整をされた未登録の方にお送りしています。",
    "今後の案内が不要な場合は、メール下部の配信停止リンクからお手続きください。",
  ].join("\n");
  return { subject: "先日はありがとうございました（キマルのご案内）", text };
}

async function run(dryRun) {
  const { from, to } = jstYesterdayRange();
  const bookings = await sb(
    `bookings?select=*&status=eq.confirmed&start_at=gte.${encodeURIComponent(from.toISOString())}&start_at=lt.${encodeURIComponent(to.toISOString())}&order=start_at.asc&limit=500`
  );
  const members = await memberEmailSet();

  const results = [];
  for (const booking of bookings || []) {
    const recipient = String(booking.visitor_email || booking.guest_email || "").trim().toLowerCase();
    if (!recipient) {
      results.push({ booking_id: booking.id, status: "skipped", reason: "Missing guest email" });
      continue;
    }
    if (members.has(recipient)) {
      results.push({ booking_id: booking.id, to: recipient, status: "skipped", reason: "Already a member" });
      continue;
    }
    if (await alreadySent(booking.id)) {
      results.push({ booking_id: booking.id, to: recipient, status: "skipped", reason: "Already sent" });
      continue;
    }
    const message = buildMessage(booking);
    if (dryRun) {
      results.push({ booking_id: booking.id, to: recipient, status: "dry_run", subject: message.subject, text: message.text });
      continue;
    }
    try {
      // marketing 経路: 送信元は news サブドメイン、List-Unsubscribe 付与、サプレッション宛先は自動スキップ。
      const sent = await sendMail({ to: recipient, subject: message.subject, text: message.text, category: "marketing" });
      if (sent.skipped) {
        results.push({ booking_id: booking.id, to: recipient, status: "skipped", reason: sent.suppressed ? "Suppressed" : "Mail not configured" });
        continue;
      }
      await markSent(booking.id, recipient, sent.id, "sent");
      results.push({ booking_id: booking.id, to: recipient, status: "sent", provider_message_id: sent.id });
    } catch (error) {
      await markSent(booking.id, recipient, "", "failed", error.message);
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
