const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");

// 自分の予約ページ一覧取得 / 削除（複数予約ページ管理）。
exports.handler = async (event) => {
  try {
    const owner = await requireOwner(event);

    if (event.httpMethod === "GET") {
      // 編集時のプレフィル用に全列＋事前アンケート（ページ単位）を返す。受付時間はオーナー単位なので別途。
      const cols = "id,slug,title,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,location_type,location_value,booking_range_months,timezone,accept_holidays,lead_time_hours,candidate_days,slot_interval_minutes,is_active,created_at";
      const pagesQuery = (qcols) => `booking_pages?owner_id=${eq(owner.id)}&select=${cols},questionnaire_questions(${qcols})&order=created_at.asc`;
      // answer_type/options 列が未マイグレーションの環境ではそれらを除いた select にフォールバック。
      const pages = await sb(pagesQuery("question_text,is_required,sort_order,answer_type,options"))
        .catch(() => sb(pagesQuery("question_text,is_required,sort_order")));
      const availability = await sb(
        `availability_settings?owner_id=${eq(owner.id)}&select=day_of_week,start_time,end_time&order=day_of_week.asc`
      ).catch(() => []);
      return json(200, { pages: pages || [], availability: availability || [] });
    }

    if (event.httpMethod === "POST") {
      const body = readJson(event);
      const action = String(body.action || "");
      const id = String(body.id || "").trim();
      if (action !== "delete" || !id) return json(400, { error: "リクエストが不正です" });
      const rows = await sb(`booking_pages?id=${eq(id)}&owner_id=${eq(owner.id)}&limit=1`);
      if (!rows[0]) return json(404, { error: "対象の予約ページが見つかりません" });
      await sb(`questionnaire_questions?booking_page_id=${eq(id)}`, { method: "DELETE" }).catch(() => {});
      await sb(`booking_pages?id=${eq(id)}`, { method: "DELETE" });
      return json(200, { ok: true });
    }

    return json(405, { error: "許可されていない操作です" });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
