const { json } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq, findOwnerByEmail } = require("./_lib/supabase");
const { hostAnswerToken } = require("./_lib/crypto");

// 会員同士の相互質問（#20）: ホストが「回答待ち」の質問を一覧で見る（要ログイン）。
// 条件: 自分の予約で、相手がキマル会員（visitor_email↔owners・自分以外）かつ
//       質問あり(guest_message) かつ 未回答(host_answer 空)。各件に回答ページ用トークンを付与。

function has(v) { return Boolean(String(v == null ? "" : v).trim()); }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") return json(405, { error: "許可されていない操作です" });
    const owner = await requireOwner(event);
    const cols = "id,visitor_name,visitor_email,start_at,start_time,guest_message,host_answer,status";
    // host_answer 列が未マイグレーションの環境では除いて取得（その場合は未回答扱い）。
    const rows = await sb(`bookings?owner_id=${eq(owner.id)}&select=${cols}&order=start_at.desc&limit=200`)
      .catch(() => sb(`bookings?owner_id=${eq(owner.id)}&select=id,visitor_name,visitor_email,start_at,start_time,guest_message,status&order=start_at.desc&limit=200`).catch(() => []));

    const ownerEmail = String(owner.email || "").trim().toLowerCase();
    // 質問あり・未回答・未キャンセルに絞る。
    const candidates = (rows || []).filter((b) =>
      has(b.guest_message) && !has(b.host_answer) && b.status !== "cancelled");

    // 相手が会員か判定（distinct email で問い合わせ）。会員同士のものだけ残す。
    const emails = [...new Set(candidates.map((b) => String(b.visitor_email || "").trim().toLowerCase()).filter((e) => e && e !== ownerEmail))];
    const memberEmails = new Set();
    for (const e of emails) {
      const o = await findOwnerByEmail(e).catch(() => null);
      if (o) memberEmails.add(e);
    }

    const items = candidates
      .filter((b) => {
        const ve = String(b.visitor_email || "").trim().toLowerCase();
        return ve && ve !== ownerEmail && memberEmails.has(ve);
      })
      .map((b) => ({
        id: b.id,
        visitor_name: b.visitor_name || "",
        start_at: b.start_at || b.start_time || null,
        question: b.guest_message || "",
        t: hostAnswerToken(b.id),
      }));

    return json(200, { count: items.length, items });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
