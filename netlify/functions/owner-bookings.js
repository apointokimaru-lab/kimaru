const { json } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { manageUrl } = require("./_lib/booking-format");

// 管理リンク生成は env 未設定で throw しうるので保護（失敗時 null）。
function safeManageUrl(id) {
  try { return id ? manageUrl(id) : null; } catch (_) { return null; }
}

function hidePrivateBirthDate(booking) {
  if (!booking.visitor_birth_date_private) return booking;
  const sanitized = { ...booking, visitor_birth_date: null };
  if (!sanitized.filter_request || sanitized.filter_request === "none") return sanitized;
  try {
    const context = JSON.parse(sanitized.filter_request);
    if (context?.kind === "relationship_context") {
      sanitized.filter_request = JSON.stringify({ ...context, birth_date: "非公開", birth_date_private: true });
    }
  } catch (_) {
    // Keep the original text if old data is not JSON.
  }
  return sanitized;
}

// 予約履歴（相手レコード）の閲覧は無料にも開放（決定19・#182）。GETのみ・閲覧専用。
// 面談メモ・印象スコアの編集は Pro/Premium 限定（appointment-log 側で制限）。
// 手動追加の相手（manual_contacts・プレミアム）を予約レコードと同じ形にして相手一覧に混ぜる。
// 予約していない相手なので start_at は無し（一覧では日時「—」）。未マイグレーション環境では空配列。
function manualToBooking(row) {
  return {
    id: `manual-${row.id}`,
    visitor_name: row.name || "",
    visitor_email: row.email || "",
    topic: row.topic || "",
    start_at: null,
    manual: true,
    created_at: row.created_at,
  };
}

exports.handler = async (event) => {
  try {
    const owner = await requireOwner(event);
    // 一覧は start_at 降順で上限つき。上限が小さいと予約の多いホストで直近の予約が一覧から
    // 溢れ、詳細画面（meeting.html は ?id をこの一覧から探す）が「見つかりません」になり、
    // キャンセル・日程変更の導線ごと消えていた（50→200 に引き上げ）。
    const bookings = await sb(`bookings?owner_id=${eq(owner.id)}&order=start_at.desc&limit=200`);
    // さらに上限を超えても、?id= 指定の詳細画面だけは必ず開けるように該当行を足す
    // （自分の予約に限定。UUID 以外の id では PostgREST が 400 を返すので無視する）。
    const wantedId = String(event.queryStringParameters?.id || "").trim();
    if (wantedId && !(bookings || []).some((b) => String(b.id) === wantedId)) {
      const extra = await sb(`bookings?id=${eq(wantedId)}&owner_id=${eq(owner.id)}&limit=1`).catch(() => []);
      if (extra && extra[0]) bookings.push(extra[0]);
    }
    const manual = await sb(`manual_contacts?owner_id=${eq(owner.id)}&order=created_at.desc&limit=50`).catch(() => []);

    // 事前アンケート回答（questionnaire_answers）を各予約に添付。
    //
    // 質問文の引き方は2段構え（#304）:
    //  1) 回答側に控えてある question_text（回答時点の文言。book.js が非正規化で保存）
    //  2) 無ければ question_id 経由の埋め込み（questionnaire_questions(question_text)）
    // 1 を優先するのは、ホストが予約ページを保存するたび質問行が作り直され（全削除→再作成）、
    // FK が on delete set null なので過去の回答の question_id が null に落ちるため。
    // その状態で 2 だけに頼ると質問文が空になり、画面側の既定ラベル
    //「今回お話したい内容」が全項目に並んでしまう（本番で発生。回答429件中298件が該当）。
    const ids = (bookings || []).map((b) => b.id).filter(Boolean);
    const answersByBooking = {};
    const pushAnswer = (bookingId, questionText, answerText) => {
      (answersByBooking[bookingId] = answersByBooking[bookingId] || []).push({ question_text: questionText || "", answer_text: answerText });
    };
    if (ids.length) {
      const filter = `questionnaire_answers?booking_id=in.(${ids.join(",")})`;
      try {
        const rows = await sb(`${filter}&select=booking_id,answer_text,question_text,questionnaire_questions(question_text)`);
        for (const r of rows || []) {
          pushAnswer(r.booking_id, r.question_text || (r.questionnaire_questions && r.questionnaire_questions.question_text), r.answer_text);
        }
      } catch (_) {
        // question_text 列が未マイグレーション → 埋め込みだけで引く。
        try {
          const rows = await sb(`${filter}&select=booking_id,answer_text,questionnaire_questions(question_text)`);
          for (const r of rows || []) {
            pushAnswer(r.booking_id, r.questionnaire_questions && r.questionnaire_questions.question_text, r.answer_text);
          }
        } catch (_2) {
          // 埋め込みも不可な環境向けフォールバック（質問文なしで回答のみ）。
          try {
            const rows = await sb(`${filter}&select=booking_id,answer_text`);
            for (const r of rows || []) pushAnswer(r.booking_id, "", r.answer_text);
          } catch (_3) { /* テーブル未作成: 回答なし扱い */ }
        }
      }
    }

    const enrich = (b) => ({ ...hidePrivateBirthDate(b), answers: answersByBooking[b.id] || [], manage_url: safeManageUrl(b.id) });
    const list = [...(manual || []).map(manualToBooking), ...(bookings || []).map(enrich)];
    return json(200, { bookings: list });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
