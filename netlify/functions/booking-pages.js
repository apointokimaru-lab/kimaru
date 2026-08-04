const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");

// 自分の予約ページ一覧取得 / 削除（複数予約ページ管理）。
exports.handler = async (event) => {
  try {
    const owner = await requireOwner(event);

    if (event.httpMethod === "GET") {
      // 編集時のプレフィル用に全列＋事前アンケート（ページ単位）を返す。受付時間はオーナー単位なので別途。
      const baseCols = "id,slug,title,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,location_type,location_value,booking_range_months,timezone,accept_holidays,lead_time_hours,candidate_days,slot_interval_minutes,is_active,created_at";
      const withTitles = `${baseCols},buffer_before_title,buffer_after_title`;
      const pagesQuery = (cols, qcols) => `booking_pages?owner_id=${eq(owner.id)}&select=${cols},questionnaire_questions(${qcols})&order=created_at.asc`;
      // buffer_*_title / answer_type / options が未マイグレーションの環境では順に列を落としてフォールバック。
      const pages = await sb(pagesQuery(withTitles, "question_text,is_required,sort_order,answer_type,options"))
        .catch(() => sb(pagesQuery(withTitles, "question_text,is_required,sort_order")))
        .catch(() => sb(pagesQuery(baseCols, "question_text,is_required,sort_order,answer_type,options")))
        .catch(() => sb(pagesQuery(baseCols, "question_text,is_required,sort_order")));
      // 受付時間は予約ページ単位（#263）。booking_page_id 付きの行を各ページへ、
      // 列が無い/未設定の旧データ（booking_page_id=null）はオーナー共有のフォールバックとして返す。
      const cols = "booking_page_id,day_of_week,start_time,end_time";
      let rows = await sb(`availability_settings?owner_id=${eq(owner.id)}&select=${cols}&order=day_of_week.asc`)
        .catch(() => sb(`availability_settings?owner_id=${eq(owner.id)}&select=day_of_week,start_time,end_time&order=day_of_week.asc`))
        .catch(() => []);
      rows = rows || [];
      const strip = ({ booking_page_id, ...rest }) => rest;
      const shared = rows.filter((row) => !row.booking_page_id).map(strip);
      const list = (pages || []).map((page) => {
        const own = rows.filter((row) => row.booking_page_id === page.id).map(strip);
        return { ...page, availability: own.length ? own : shared };
      });
      // 新規ページの初期値: 共有（レガシー）設定 → 無ければ先頭ページの設定（無ければ画面のHTML既定＝平日10:00-18:00）。
      const defaults = shared.length ? shared : ((list[0] && list[0].availability) || []);
      return json(200, { pages: list, availability: shared, default_availability: defaults });
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
