const { optional, appBaseUrl } = require("./config");
const { mailUnsubToken } = require("./crypto");
const { isEmailSuppressed } = require("./supabase");

// メール送信の共通ヘルパ。優先順位: Gmail SMTP（アプリパスワード）→ Resend → 未設定ならスキップ。
// 種別(category)で送信元を出し分ける（決定13の送信アーキテクチャ）:
//   - transactional（既定）: 予約確認・リマインダー・通知。必ず届けたい → TRANSACTIONAL_EMAIL_FROM（notify.<domain>）
//   - marketing: サンキュー・登録勧誘・宣伝。苦情リスクを取引系から隔離 → MARKETING_EMAIL_FROM（news.<domain>）
// marketing は (1) サプレッション登録済み宛先には送らない (2) List-Unsubscribe（ワンクリック解除）を付与する。

let _nodemailer = null;
function getNodemailer() {
  if (_nodemailer === null) {
    try { _nodemailer = require("nodemailer"); } catch (_) { _nodemailer = false; }
  }
  return _nodemailer || null;
}

// 未指定時の差出人/返信先（種別ごとの env が無ければ BOOKING → BIRTHDAY にフォールバック）。
function defaultFrom() {
  return optional("BOOKING_EMAIL_FROM", optional("BIRTHDAY_EMAIL_FROM", ""));
}
function defaultReplyTo() {
  return optional("BOOKING_EMAIL_REPLY_TO", optional("BIRTHDAY_EMAIL_REPLY_TO", ""));
}

// 種別ごとの送信元。未設定なら defaultFrom() にフォールバック（＝既存の単一ドメイン運用と互換）。
function categoryFrom(category) {
  if (category === "marketing") return optional("MARKETING_EMAIL_FROM", defaultFrom());
  return optional("TRANSACTIONAL_EMAIL_FROM", defaultFrom());
}

// "キマル <x@y>" → "キマル"（表示名のみ抽出。無ければ "")
function displayName(from) {
  const m = String(from || "").match(/^\s*(.+?)\s*<[^>]+>\s*$/);
  return m ? m[1].trim() : "";
}

// 表示名の無い送信元（例: notify@notify.kimaru-co.jp）に既定表示名を付与する。
// これが無いと受信側（Gmail 等）が差出人名としてアドレスのローカル部/サブドメイン（"notify"）を表示してしまう。
// 既に "名前 <addr>" 形式、または空文字のときはそのまま返す。
function ensureFromName(from, fallbackName) {
  const s = String(from || "").trim();
  if (!s || /<[^>]+>/.test(s)) return s;
  return `${fallbackName} <${s}>`;
}

// 営業メールの解除URL（ワンクリック）。SESSION_SECRET 未設定等で失敗したら空。
function unsubscribeUrl(email) {
  try {
    const token = mailUnsubToken(email);
    return `${appBaseUrl()}/api/mail-unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
  } catch (_) {
    return "";
  }
}

let _gmailTransport = null;
function gmailTransport() {
  const user = optional("GMAIL_USER", "");
  const pass = optional("GMAIL_APP_PASSWORD", "");
  if (!user || !pass) return null;
  const mod = getNodemailer();
  if (!mod) return null;
  if (!_gmailTransport) {
    _gmailTransport = mod.createTransport({ service: "gmail", auth: { user, pass } });
  }
  return _gmailTransport;
}

// Gmail SMTP で送信。差出人アドレスは認証アカウント（GMAIL_USER）固定、表示名のみ反映。
async function sendViaGmail({ to, subject, text, html, replyTo, fromName, headers }) {
  const transport = gmailTransport();
  if (!transport) return null;
  const user = optional("GMAIL_USER", "");
  const from = fromName ? `${fromName} <${user}>` : user;
  const info = await transport.sendMail({
    from, to, subject, text,
    ...(html ? { html } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
  });
  return { id: info.messageId || "" };
}

// Resend HTTP API で送信。
async function sendViaResend({ to, subject, text, html, from, replyTo, headers }) {
  const apiKey = optional("RESEND_API_KEY", "");
  if (!apiKey || !from) return null;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to, subject, text,
      ...(html ? { html } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "メールの送信に失敗しました");
  return { id: data.id || "" };
}

// 共通送信。Gmail（設定あれば）→ Resend → スキップ。失敗は例外（呼び出し側は非致命で握りつぶす）。
// category 既定は transactional（＝従来挙動と互換）。
async function sendMail({ to, subject, text, html, from, replyTo, category = "transactional", headers = {}, unsubscribeEmail }) {
  if (!to) return { skipped: true };
  const isMarketing = category === "marketing";

  // 営業メールは配信停止リストに載っている宛先には送らない。取引メールは常に送る。
  if (isMarketing) {
    try {
      if (await isEmailSuppressed(to)) return { skipped: true, suppressed: true };
    } catch (_) {
      // suppression テーブル未マイグレーション等では止めずに送る。
    }
  }

  // 送信元に表示名が無ければ「キマル」を付与（Resend 経由でも差出人名が "notify" 等にならないように）。
  const fromAddr = ensureFromName(from || categoryFrom(category), "キマル");
  const reply = replyTo || defaultReplyTo();

  // 営業メールには List-Unsubscribe + ワンクリック解除（RFC 8058）を付与（Gmail/Yahoo 要件）。
  const mailHeaders = { ...headers };
  if (isMarketing) {
    const unsub = unsubscribeUrl(unsubscribeEmail || to);
    if (unsub) {
      mailHeaders["List-Unsubscribe"] = `<${unsub}>`;
      mailHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
  }

  const viaGmail = await sendViaGmail({ to, subject, text, html, replyTo: reply, fromName: displayName(fromAddr) || "キマル", headers: mailHeaders });
  if (viaGmail) return viaGmail;

  const viaResend = await sendViaResend({ to, subject, text, html, from: fromAddr, replyTo: reply, headers: mailHeaders });
  if (viaResend) return viaResend;

  return { skipped: true };
}

module.exports = { sendMail };
