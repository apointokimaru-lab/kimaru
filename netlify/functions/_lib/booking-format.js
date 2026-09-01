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

// 面談の名前。Googleカレンダーの予定名と Zoom のミーティング名で共通に使う（#358）。
//
// なぜ必要か: Zoom のミーティング名に `bookings.topic` を渡していたため、**事前アンケート1問目の回答**が
// そのままミーティング名になっていた（topic は #312 以降「最初に埋まっている回答のコピー」で、
// 独立した相談内容の欄ではない）。Zoom のミーティング名は参加画面・招待・録画の一覧に出るので、
// 相談内容が本人の意図しない場所へ出てしまう。カレンダー側は昔から「キマル：◯◯さんとの面談」で、
// 回答は説明欄にしか入れていない。
// 何をしているか: 名前の作り方をこの1か所に集約する（カレンダーと Zoom で二度と食い違わせない）。
// ゲスト名が空のときはサービス名だけにする（"キマル： さんとの面談" のような欠けた名前を作らない）。
function meetingTitle(booking) {
  const name = String(booking?.visitor_name || booking?.guest_name || "").trim().slice(0, 80);
  return name ? `キマル：${name} さんとの面談` : "キマル：面談";
}

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
// メールはプレーンテキストで送るため、リンク化はメールクライアント任せになる。`&` で
// リンクを切る・折り返すクライアントだと t が欠けてキャンセル不能になっていたので、
// id とトークンを1パラメータ（?k=<id>.<token>）に統合して `&` を無くしている。
// 旧形式 ?id=&t= のリンク（送信済みメール）も booking-manage.js が引き続き受け付ける。
function manageUrl(bookingId) {
  return `${appBaseUrl()}/manage-booking.html?k=${encodeURIComponent(`${bookingId}.${bookingToken(bookingId)}`)}`;
}

// 会員同士の相互質問（#20）: ホストが予約者の質問に回答する回答ページの絶対URL（ホスト宛トークン付き）。
function answerUrl(bookingId) {
  return `${appBaseUrl()}/answer-question.html?id=${encodeURIComponent(bookingId)}&t=${encodeURIComponent(hostAnswerToken(bookingId))}`;
}

// ホスト専用の相手の詳細画面（回答・プロフィール・占い分析・メモを集約）の絶対URL。
// 認証必須ページなのでトークンは付けない（開くにはキマルにログインしたホスト本人が必要）。
function briefingUrl(bookingId) {
  return `${appBaseUrl()}/meeting.html?id=${encodeURIComponent(bookingId)}`;
}

// 事前アンケート回答の要約（メール本文用）。
// 未回答の任意項目も「A. 未回答」として残す（#307）。答えが無かったことも情報なので、
// 質問ごと消すと「聞いたのに載っていない」ように見えてしまう。
function answersSummary(answers) {
  return (Array.isArray(answers) ? answers : [])
    .filter((a) => a && (a.question_text || a.answer_text))
    .map((a) => `Q. ${String(a.question_text || "質問").slice(0, 200)}\nA. ${String(a.answer_text || "").slice(0, 1000) || "未回答"}`)
    .join("\n\n");
}

module.exports = { LOCATION_LABELS, formatJst, manageUrl, answerUrl, briefingUrl, answersSummary, meetingTitle };
