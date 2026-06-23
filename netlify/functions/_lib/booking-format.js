const { appBaseUrl } = require("./config");
const { bookingToken, hostAnswerToken } = require("./crypto");

// 予約メール・管理リンクで共通利用する書式ヘルパ。
const LOCATION_LABELS = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  in_person: "対面",
  phone: "電話",
  custom_url: "オンライン",
  later: "後日連絡",
};

function formatJst(iso) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

// ゲストがログイン不要でキャンセル/日程変更できる管理ページの絶対URL（署名トークン付き）。
function manageUrl(bookingId) {
  return `${appBaseUrl()}/manage-booking.html?id=${encodeURIComponent(bookingId)}&t=${encodeURIComponent(bookingToken(bookingId))}`;
}

// 会員同士の相互質問（#20）: ホストが予約者の質問に回答する回答ページの絶対URL（ホスト宛トークン付き）。
function answerUrl(bookingId) {
  return `${appBaseUrl()}/answer-question.html?id=${encodeURIComponent(bookingId)}&t=${encodeURIComponent(hostAnswerToken(bookingId))}`;
}

// 事前アンケート回答の要約（メール本文用）。
function answersSummary(answers) {
  return (Array.isArray(answers) ? answers : [])
    .filter((a) => a && a.answer_text)
    .map((a) => `Q. ${String(a.question_text || "質問").slice(0, 200)}\nA. ${String(a.answer_text).slice(0, 1000)}`)
    .join("\n\n");
}

module.exports = { LOCATION_LABELS, formatJst, manageUrl, answerUrl, answersSummary };
