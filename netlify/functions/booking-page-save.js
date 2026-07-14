const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { planLimits } = require("./_lib/plan-limits");

const allowedDurations = new Set([30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
const allowedBuffers = new Set([0, 10, 20, 30, 40, 50, 60]);
const allowedRanges = new Set([1, 2, 3, 4, 5, 6]); // 月数
const allowedCandidateDays = new Set([7, 14, 21]); // 日数指定（月数より優先）
const FREE_RANGE_LIMIT = 2; // 無料は2ヶ月先まで（3ヶ月以降はPro）
const allowedLocationTypes = new Set(["in_person", "google_meet", "zoom", "phone", "custom_url", "later"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
// 予約ページ・アンケートの保存上限はプラン別（free 1 / pro 2 / premium 5 ほか）。→ _lib/plan-limits.js

function intValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const QUESTION_TYPES = new Set(["text", "select", "checkbox"]);

// allowChoice=false（無料）は自由入力(text)に固定。選択肢が空の select/checkbox は text に戻す（決定27）。
function normalizeQuestion(question, index, allowChoice) {
  let answerType = String(question.answer_type || "text");
  if (!QUESTION_TYPES.has(answerType) || !allowChoice) answerType = "text";
  let options = [];
  if (answerType !== "text") {
    options = (Array.isArray(question.options) ? question.options : [])
      .map((opt) => String(opt || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!options.length) answerType = "text";
  }
  return {
    question_text: String(question.question_text || "").trim(),
    is_required: Boolean(question.is_required),
    answer_type: answerType,
    options,
    sort_order: index + 1,
  };
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeAvailability(settings) {
  if (!Array.isArray(settings)) return [];
  return settings
    .map((setting) => ({
      day_of_week: intValue(setting.day_of_week, -1),
      start_time: String(setting.start_time || "").slice(0, 5),
      end_time: String(setting.end_time || "").slice(0, 5),
      enabled: setting.enabled !== false,
    }))
    .filter((setting) => setting.enabled)
    .filter((setting) => setting.day_of_week >= 0 && setting.day_of_week <= 6)
    .filter((setting) => timePattern.test(setting.start_time) && timePattern.test(setting.end_time))
    .filter((setting) => timeToMinutes(setting.start_time) < timeToMinutes(setting.end_time))
    .map((setting) => ({
      day_of_week: setting.day_of_week,
      start_time: setting.start_time,
      end_time: setting.end_time,
    }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requireOwner(event);
    const body = readJson(event);
    const isPro = owner.plan === "pro" || owner.plan === "premium";
    const limits = planLimits(owner.plan); // { pages, questions }

    const duration = intValue(body.duration_minutes, 30);
    const bufferBefore = intValue(body.buffer_before_minutes, 0);
    const bufferAfter = intValue(body.buffer_after_minutes, 0);
    const requestedRange = intValue(body.booking_range_months, 2);
    const locationType = allowedLocationTypes.has(body.location_type) ? body.location_type : "google_meet";
    const questions = Array.isArray(body.questions) ? body.questions.map((q, i) => normalizeQuestion(q, i, isPro)).filter((q) => q.question_text) : [];
    const availability = normalizeAvailability(body.availability_settings);
    const questionLimit = limits.questions;

    // 日程候補設定（TimeRex相当）。危険な値はクランプ（エラーにはしない）。
    const acceptHolidays = !(body.accept_holidays === false || body.accept_holidays === "false");
    const leadTimeHours = Math.min(Math.max(intValue(body.lead_time_hours, 0), 0), 720); // 0〜30日
    const candidateDaysRaw = intValue(body.candidate_days, 0);
    const candidateDays = allowedCandidateDays.has(candidateDaysRaw) ? candidateDaysRaw : null; // 7/14/21日 or null
    // 公開範囲の月数（日数指定が無いときに有効）。無料は2ヶ月までにクランプ。
    const bookingRange = candidateDays ? 1 : (isPro ? requestedRange : Math.min(requestedRange, FREE_RANGE_LIMIT));
    const intervalRaw = intValue(body.slot_interval_minutes, 0);
    const slotInterval = intervalRaw > 0 ? Math.min(Math.max(intervalRaw, 5), 480) : null; // null=自動

    if (!allowedDurations.has(duration)) return json(400, { error: "予約時間は30〜120分の10分刻みで選択してください" });
    if (!allowedBuffers.has(bufferBefore) || !allowedBuffers.has(bufferAfter)) return json(400, { error: "前後バッファは0〜60分の10分刻みで選択してください" });
    if (!candidateDays && !allowedRanges.has(requestedRange)) return json(400, { error: "予約枠の公開範囲の指定が正しくありません" });
    if (!isPro && !candidateDays && requestedRange > FREE_RANGE_LIMIT) return json(403, { error: "無料版で公開できるのは2ヶ月先までです。3ヶ月以降を公開するにはPro版が必要です" });
    if (questions.length > questionLimit) return json(403, { error: `現在のプランで設定できる質問は${questionLimit}問までです（無料2問／Pro・プレミアム5問）` });
    if (!availability.length) return json(400, { error: "受付可能な曜日・時間帯を1つ以上設定してください" });

    // 複数予約ページ対応: id 指定で編集、無ければ新規作成（slug はグローバル一意）。
    const requestedId = String(body.id || "").trim();
    let existing = null;
    if (requestedId) {
      const rows = await sb(`booking_pages?id=${eq(requestedId)}&owner_id=${eq(owner.id)}&limit=1`);
      existing = rows[0] || null;
      if (!existing) return json(404, { error: "対象の予約ページが見つかりません" });
    }
    let slug = String(body.slug || "").trim().toLowerCase();
    if (!slug) slug = existing?.slug || `${owner.slug || "demo"}-${Math.random().toString(36).slice(2, 7)}`;
    if (!SLUG_RE.test(slug)) return json(400, { error: "公開URL（slug）は半角英小文字・数字・ハイフン3〜40文字で入力してください" });

    // 新規作成時の保存数上限（無料1 / Pro2 / プレミアム5）
    if (!existing) {
      const owned = await sb(`booking_pages?owner_id=${eq(owner.id)}&select=id,frozen`);
      // 凍結ページ（降格時の超過分・#174）は上限カウントから除外する。
      const activeCount = (owned || []).filter((p) => !p.frozen).length;
      const limit = limits.pages;
      if (activeCount >= limit) return json(403, { error: `現在のプランで保存できる予約ページは${limit}個までです（無料1つ／Pro2つ／プレミアム5つ）` });
    }

    const title = String(body.title || "").trim();
    if (!title) return json(400, { error: "予約ページ名（タイトル）を入力してください" });

    const payload = {
      owner_id: owner.id,
      slug,
      title,
      description: String(body.description || "").trim(),
      duration_minutes: duration,
      buffer_before_minutes: bufferBefore,
      buffer_after_minutes: bufferAfter,
      booking_range_months: bookingRange,
      location_type: locationType,
      location_value: String(body.location_value || "").trim(),
      accept_holidays: acceptHolidays,
      lead_time_hours: leadTimeHours,
      candidate_days: candidateDays,
      slot_interval_minutes: slotInterval,
      active: body.is_active !== false,
      is_active: body.is_active !== false,
    };

    let saved;
    try {
      saved = existing
        ? await sb(`booking_pages?id=${eq(existing.id)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await sb("booking_pages", { method: "POST", body: JSON.stringify(payload) });
    } catch (error) {
      if (/duplicate|unique/i.test(String(error.message || ""))) return json(409, { error: "そのURL(slug)は既に使われています" });
      throw error;
    }
    const bookingPage = saved[0];

    await sb(`questionnaire_questions?booking_page_id=${eq(bookingPage.id)}`, { method: "DELETE" });
    if (questions.length) {
      const rows = questions.map((question) => ({ ...question, booking_page_id: bookingPage.id }));
      try {
        await sb("questionnaire_questions", { method: "POST", body: JSON.stringify(rows) });
      } catch (error) {
        // answer_type/options 列が未マイグレーションの環境では型情報を落として保存（自由入力として動作）。
        if (!/answer_type|options/.test(String(error.message || ""))) throw error;
        const fallback = rows.map(({ answer_type, options, ...rest }) => rest);
        await sb("questionnaire_questions", { method: "POST", body: JSON.stringify(fallback) });
      }
    }

    await sb(`availability_settings?owner_id=${eq(owner.id)}`, { method: "DELETE" });
    await sb("availability_settings", {
      method: "POST",
      body: JSON.stringify(availability.map((setting) => ({ ...setting, owner_id: owner.id }))),
    });

    return json(200, { ok: true, booking_page: bookingPage, availability_settings: availability, question_limit: questionLimit });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
