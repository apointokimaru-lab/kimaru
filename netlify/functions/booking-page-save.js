const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { planLimits } = require("./_lib/plan-limits");

const allowedDurations = new Set([30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
// UIの選択肢は10分刻みだが、旧データには端数（例: 15分）が入っている。
// 集合で弾くと、編集画面がその値を出せず保存もできない＝設定が消える（#300）。範囲でクランプする。
const BUFFER_MAX_MINUTES = 60;
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
    // 既存行のID（画面が保存済み質問に付けて返す）。差分保存で「更新」に回す目印であって
    // DBへ書く値ではないので、書き込み前に必ず取り除く（#304）。
    id: String(question.id || "").trim() || null,
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
    const clampBuffer = (value) => Math.min(Math.max(Math.round(intValue(value, 0)), 0), BUFFER_MAX_MINUTES);
    const bufferBefore = clampBuffer(body.buffer_before_minutes);
    const bufferAfter = clampBuffer(body.buffer_after_minutes);
    // 前後バッファをホスト専用のGoogleカレンダー予定にするときのタイトル（空=予定を作らない）。
    // バッファ0分の側はタイトルを保持しない（UIとサーバの整合）。
    const bufferBeforeTitle = bufferBefore > 0 ? String(body.buffer_before_title || "").trim().slice(0, 120) : "";
    const bufferAfterTitle = bufferAfter > 0 ? String(body.buffer_after_title || "").trim().slice(0, 120) : "";
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
      buffer_before_title: bufferBeforeTitle,
      buffer_after_title: bufferAfterTitle,
      booking_range_months: bookingRange,
      location_type: locationType,
      location_value: String(body.location_value || "").trim(),
      accept_holidays: acceptHolidays,
      lead_time_hours: leadTimeHours,
      candidate_days: candidateDays,
      slot_interval_minutes: slotInterval,
      active: body.is_active !== false,
      is_active: body.is_active !== false,
      // DBトリガーが無いので明示的に更新する。_lib/plan-freeze.js が降格時に
      // 「直近更新のページを残す」判定へ updated_at.desc を使うため、動かないと作成順になってしまう。
      updated_at: new Date().toISOString(),
    };

    const writePage = (data) => existing
      ? sb(`booking_pages?id=${eq(existing.id)}`, { method: "PATCH", body: JSON.stringify(data) })
      : sb("booking_pages", { method: "POST", body: JSON.stringify(data) });
    let saved;
    try {
      saved = await writePage(payload);
    } catch (error) {
      const message = String(error.message || "");
      if (/duplicate|unique/i.test(message)) return json(409, { error: "そのURL(slug)は既に使われています" });
      // buffer_before_title/buffer_after_title 列が未マイグレーションの環境ではタイトルを落として保存。
      if (/buffer_before_title|buffer_after_title/.test(message)) {
        const { buffer_before_title, buffer_after_title, ...rest } = payload;
        saved = await writePage(rest);
      } else {
        throw error;
      }
    }
    const bookingPage = saved[0];

    // 事前アンケートの質問は「更新 / 追加 / 削除」の差分で反映する（#304）。
    // 以前は全削除→再作成していたため、保存のたびに質問のUUIDが変わり、
    // questionnaire_answers.question_id が FK の on delete set null で null に落ちて、
    // 過去の回答から質問文を引けなくなっていた（本番で回答429件中298件が該当）。
    // 既存行のIDを保つことで、質問を編集しても過去の回答との紐付けが切れない。
    const existingQuestions = await sb(`questionnaire_questions?booking_page_id=${eq(bookingPage.id)}&select=id,frozen`)
      .catch(() => sb(`questionnaire_questions?booking_page_id=${eq(bookingPage.id)}&select=id`))
      .catch(() => []);
    const existingIds = new Set((existingQuestions || []).map((row) => row.id));
    // 凍結行（プラン降格で超過したぶん・#174）は編集画面に出ないため送信内容にも含まれない。
    // 「送信内容に無い＝削除」の対象から外し、温存する。
    const frozenIds = new Set((existingQuestions || []).filter((row) => row.frozen).map((row) => row.id));

    // answer_type/options 列が未マイグレーションの環境では型情報を落として書き込む（自由入力として動作）。
    const writeQuestion = async (target, method, row) => {
      try {
        return await sb(target, { method, body: JSON.stringify(row) });
      } catch (error) {
        if (!/answer_type|options/.test(String(error.message || ""))) throw error;
        const { answer_type, options, ...rest } = row;
        return sb(target, { method, body: JSON.stringify(rest) });
      }
    };

    const keptIds = new Set();
    for (const question of questions) {
      const { id, ...row } = question;
      // 他ページのIDを送られても existingIds に無いので、更新ではなく追加に落ちる。
      if (id && existingIds.has(id)) {
        keptIds.add(id);
        await writeQuestion(`questionnaire_questions?id=${eq(id)}`, "PATCH", row);
      } else {
        await writeQuestion("questionnaire_questions", "POST", { ...row, booking_page_id: bookingPage.id });
      }
    }
    const removedIds = [...existingIds].filter((id) => !keptIds.has(id) && !frozenIds.has(id));
    if (removedIds.length) {
      await sb(`questionnaire_questions?id=in.(${removedIds.join(",")})`, { method: "DELETE" });
    }

    // 受付時間は予約ページ単位（#263）。このページの行だけ入れ替える。
    // owner_id 単位で消していた頃は、ページBの保存がページAの受付時間まで書き換えてしまっていた。
    // booking_page_id 列が未マイグレーションの環境では旧挙動（オーナー単位）へデグレードする。
    try {
      await sb(`availability_settings?booking_page_id=${eq(bookingPage.id)}`, { method: "DELETE" });
      await sb("availability_settings", {
        method: "POST",
        body: JSON.stringify(availability.map((setting) => ({ ...setting, owner_id: owner.id, booking_page_id: bookingPage.id }))),
      });
    } catch (error) {
      if (!/booking_page_id/.test(String(error.message || ""))) throw error;
      await sb(`availability_settings?owner_id=${eq(owner.id)}`, { method: "DELETE" });
      await sb("availability_settings", {
        method: "POST",
        body: JSON.stringify(availability.map((setting) => ({ ...setting, owner_id: owner.id }))),
      });
    }

    return json(200, { ok: true, booking_page: bookingPage, availability_settings: availability, question_limit: questionLimit });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
