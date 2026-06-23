const { json, readJson } = require("./_lib/response");
const { sb, eq, findOwnerById } = require("./_lib/supabase");
const { verifyHostAnswerToken } = require("./_lib/crypto");
const { sendMail } = require("./_lib/mail");
const { formatJst, manageUrl } = require("./_lib/booking-format");

// 会員同士の相互質問（#20）: ホストが予約者(B)の質問(guest_message)に回答する。
// ホスト宛メールに載る hostAnswerToken（"hostanswer:"+id）でのみアクセス可。予約者の manage トークンでは不可。
// GET: 回答ページの初期表示（質問・状態）。POST: 回答を保存し、予約者へ通知メール。

function clean(value, max = 4000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

async function loadBooking(id, token) {
  if (!id || !verifyHostAnswerToken(id, token)) return null;
  const rows = await sb(`bookings?id=${eq(id)}&limit=1`).catch(() => []);
  return rows[0] || null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      const id = clean(event.queryStringParameters?.id, 64);
      const booking = await loadBooking(id, event.queryStringParameters?.t || "");
      if (!booking) return json(404, { error: "ページが見つからないか、リンクが無効です" });
      if (!booking.guest_message) return json(404, { error: "この予約には相手からの質問がありません" });
      return json(200, {
        question: booking.guest_message,
        visitor_name: booking.visitor_name || "",
        start_at: booking.start_at || booking.start_time || null,
        answered: Boolean(booking.host_answer),
        host_answer: booking.host_answer || "",
      });
    }

    if (event.httpMethod === "POST") {
      const body = readJson(event);
      const id = clean(body.id, 64);
      const booking = await loadBooking(id, body.t);
      if (!booking) return json(404, { error: "ページが見つからないか、リンクが無効です" });
      const answer = clean(body.answer, 4000);
      if (!answer) return json(400, { error: "回答を入力してください" });

      // 回答を保存（host_answer 列が未マイグレーションでも、メール送信は止めない＝劣化動作）。
      const patch = { host_answer: answer, host_answer_at: new Date().toISOString() };
      await sb(`bookings?id=${eq(booking.id)}`, { method: "PATCH", body: JSON.stringify(patch) })
        .catch(() => sb(`bookings?id=${eq(booking.id)}`, { method: "PATCH", body: JSON.stringify({ host_answer: answer }) }).catch(() => null));

      // 予約者（B）へ「回答が届きました」通知。
      const owner = await findOwnerById(booking.owner_id).catch(() => null);
      const hostName = owner?.name || owner?.email || "お相手";
      const when = booking.start_at || booking.start_time ? formatJst(booking.start_at || booking.start_time) : "";
      if (booking.visitor_email) {
        const lines = [
          `${booking.visitor_name || ""}さん`,
          "",
          `${hostName} さんから、ご予約時にいただいた質問への回答が届きました。`,
          when ? `面談予定: ${when}` : "",
          "",
          "― あなたの質問 ―",
          booking.guest_message || "",
          "",
          `― ${hostName} さんからの回答 ―`,
          answer,
          "",
          "当日お会いできるのを楽しみにしています。",
          "",
          "▼ 予約の確認・変更・キャンセル",
          manageUrl(booking.id),
        ].filter((l) => l !== "");
        await sendMail({ to: booking.visitor_email, subject: `${hostName}さんから回答が届きました`, text: lines.join("\n") }).catch(() => {});
      }
      return json(200, { ok: true });
    }

    return json(405, { error: "許可されていない操作です" });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
