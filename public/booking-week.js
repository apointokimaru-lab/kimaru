const $ = (selector) => document.querySelector(selector);

const t = (key, fallback) => (window.KimaruI18n ? window.KimaruI18n.t(key) : fallback);

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setMessage(selector, text, kind = "") {
  const el = $(selector);
  if (!el) return;
  el.textContent = text;
  el.className = `message ${kind}`.trim();
}

// サーバーとの通信中は全画面オーバーレイで操作をロックする（多重送信・遅延中の誤操作を防ぐ）。
// 入れ子（「直近の空き時間」が内部で週送りを繰り返す等）に耐えるようカウンタで管理する。
let busyDepth = 0;
function setPageBusy(active) {
  busyDepth = Math.max(0, busyDepth + (active ? 1 : -1));
  const on = busyDepth > 0;
  const overlay = document.getElementById("page-busy");
  if (overlay) overlay.hidden = !on;
  document.body.classList.toggle("is-busy", on);
  document.body.setAttribute("aria-busy", on ? "true" : "false");
}
async function withBusy(fn) {
  setPageBusy(true);
  try {
    return await fn();
  } finally {
    setPageBusy(false);
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[<>'"&]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
}

let bookingQuestions = [];
let currentHost = null;

function locationLabel(type) {
  const labels = {
    google_meet: t("booking.loc.googleMeet", "Google Meet（自動発行）"),
    zoom: "Zoom",
    in_person: t("booking.loc.inPerson", "対面"),
    phone: t("booking.loc.phone", "電話"),
    custom_url: t("booking.loc.online", "オンライン"),
    later: t("booking.loc.later", "後日連絡"),
  };
  return labels[type] || "";
}

function renderHost(host) {
  if (!host) return;
  currentHost = host;
  const titleEl = document.getElementById("host-title");
  const nameEl = document.getElementById("host-name");
  const descEl = document.getElementById("host-desc");
  const metaEl = document.getElementById("meeting-meta");
  if (titleEl) titleEl.textContent = host.title || t("booking.hostTitleFallback", "日程を選んで予約");
  if (nameEl) nameEl.textContent = host.name ? t("booking.host.meetingWith", "{name} さんとの面談").replace("{name}", host.name) : "";
  if (descEl) descEl.textContent = host.description || "";
  if (metaEl) {
    const loc = locationLabel(host.location_type);
    const duration = t("booking.meta.duration", "所要時間：{min}分").replace("{min}", Number(host.duration_minutes) || 30);
    const locLine = loc ? `<li>${escapeHtml(t("booking.meta.location", "開催方法：{loc}").replace("{loc}", loc))}</li>` : "";
    metaEl.innerHTML = `<li>${escapeHtml(duration)}</li>${locLine}`;
  }
}

function renderQuestions(questions) {
  const container = document.getElementById("questionnaire-fields");
  if (!container) return;
  bookingQuestions = Array.isArray(questions) ? questions : [];
  // 質問が0件の予約ページでは、アンケート欄そのものを出さない（#312）。
  // 以前は「今回お話したい内容」という既定質問を自動で1問足していたが、
  // ホストが設定していない質問をゲストに必須で答えさせることになるためやめた。
  // 回答レコードも作られないので、回答一覧にも出ない。
  const list = bookingQuestions;
  container.innerHTML = list
    .map((question, index) => {
      const required = Boolean(question.is_required);
      const mark = required ? " *" : t("booking.form.optionalMark", "（任意）");
      const options = (Array.isArray(question.options) ? question.options : []).filter(Boolean);
      let type = ["select", "checkbox"].includes(question.answer_type) ? question.answer_type : "text";
      if (type !== "text" && !options.length) type = "text"; // 選択肢が無ければ自由入力にフォールバック
      const idAttr = escapeHtml(question.id || "");
      const textAttr = escapeHtml(question.question_text);
      const labelSpan = `<span>${textAttr}${escapeHtml(mark)}</span>`;
      let body;
      if (type === "select") {
        const tags = `<option value="">${escapeHtml(t("booking.form.choose", "選択してください"))}</option>` +
          options.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("");
        body = `<label>${labelSpan}<select class="q-input"${required ? " required" : ""}>${tags}</select></label>`;
      } else if (type === "checkbox") {
        const boxes = options
          .map((opt) => `<label class="q-check"><input type="checkbox" value="${escapeHtml(opt)}" /><span>${escapeHtml(opt)}</span></label>`)
          .join("");
        body = `<span class="q-field-label">${textAttr}${escapeHtml(mark)}</span><div class="q-checks">${boxes}</div>`;
      } else {
        const rows = index === 0 ? 4 : 3;
        body = `<label>${labelSpan}<textarea class="q-input" rows="${rows}"${required ? " required" : ""}></textarea></label>`;
      }
      return `<div class="q-field" data-question-id="${idAttr}" data-question-text="${textAttr}" data-answer-type="${type}" data-required="${required ? "1" : ""}">${body}</div>`;
    })
    .join("");
}

// 質問フィールドから回答文字列を取り出す（text/select=値、checkbox=チェック済みを「, 」連結）。
function readQuestionField(field) {
  if (field.dataset.answerType === "checkbox") {
    return [...field.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value).join(", ");
  }
  const el = field.querySelector(".q-input");
  return el ? el.value.trim() : "";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function timeText(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function currentLocale() {
  const lang = window.KimaruI18n ? window.KimaruI18n.getLanguage() : "ja";
  if (lang === "en") return "en-US";
  if (lang === "zh-TW") return "zh-TW";
  return "ja-JP";
}

function selectSlot(slot, button, form) {
  if (!form) return;
  form.classList.remove("hidden");
  form.elements.start.value = slot.start;
  form.elements.end.value = slot.end;
  const selectedLabel = document.getElementById("selected-slot");
  if (selectedLabel) selectedLabel.textContent = fmtSlotRange(slot.start, slot.end);
  document.querySelectorAll(".wk-slot").forEach((item) => item.classList.remove("sel"));
  if (button) button.classList.add("sel");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getBirthdayStatus(dateString) {
  if (!dateString) return "";
  const [, month, day] = dateString.split("-").map(Number);
  if (!month || !day) return "";
  const today = new Date();
  const currentYear = today.getFullYear();
  const target = new Date(currentYear, month - 1, day);
  const startOfToday = new Date(currentYear, today.getMonth(), today.getDate());
  if (target < startOfToday) target.setFullYear(currentYear + 1);
  const days = Math.ceil((target - startOfToday) / 86400000);
  if (days === 0) return "今日が誕生日です。お祝いメッセージを送るタイミングです。";
  return `次の誕生日まであと${days}日です。`;
}

// 数秘術ライフパスナンバー（生年月日の各桁の和を1桁に還元。11/22/33はマスターで保持）。
function lifePathNumber(year, month, day) {
  const reduce = (n) => { while (n > 9 && n !== 11 && n !== 22 && n !== 33) n = String(n).split("").reduce((s, d) => s + Number(d), 0); return n; };
  return reduce([year, month, day].join("").split("").reduce((s, d) => s + Number(d), 0));
}
const LIFE_PATH_HINT = {
  1: "主導・自立タイプ。結論から伝え、主導権の余地を残すと響きます。",
  2: "協調・受容タイプ。共感を示し、相手のペースに合わせると安心されます。",
  3: "表現・楽観タイプ。雑談やアイデアを一緒に広げると乗ってきます。",
  4: "堅実・誠実タイプ。手順と根拠、約束を守る姿勢が信頼になります。",
  5: "自由・変化タイプ。選択肢と新しさ・自由度を示すと関心を引きます。",
  6: "貢献・面倒見タイプ。人や周囲への貢献という文脈が心に響きます。",
  7: "探究・分析タイプ。データと背景を添え、考える時間を尊重しましょう。",
  8: "実現・影響力タイプ。成果・規模・リターンを具体的に示すと前向きに。",
  9: "理想・包容タイプ。意義や社会的価値を語ると共感を得やすいです。",
  11: "直感・理想（マスター）。ビジョンや感性への共感が深い話を生みます。",
  22: "実現力（マスター）。大きな構想を具体策に落とす伴走が響きます。",
  33: "奉仕・愛（マスター）。思いやりに寄り添うと信頼されます。",
};

// 生年月日から日柱（日干支）を求める。ユリウス通日(JDN)ベースで60干支の通し番号を算出。
// 検算: 2000-01-01 の日柱＝戊午（甲子=0 とした通し番号54）と一致する（(JDN+49)%60）。
function dayPillarIndices(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  const ganzhi = (((jdn + 49) % 60) + 60) % 60;
  return { stemIndex: ganzhi % 10, branchIndex: ganzhi % 12 };
}

// 算命学（日柱の五行）＋数秘術（ライフパス）から決定的にインサイトを算出する（#20）。
// 日干（日柱の天干）＝その人の中心（自我）を表すため、年柱より本人の傾向をよく表す。
function buildRelationshipProfile(dateString, name = "") {
  if (!dateString) return null;
  const [rawYear, month, day] = dateString.split("-").map(Number);
  if (!rawYear || !month || !day) return null;
  const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const elements = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"];
  // 日柱（日干支）を主軸にする。日付ベースなので立春補正は不要。
  const { stemIndex, branchIndex } = dayPillarIndices(rawYear, month, day);
  const element = elements[stemIndex];
  const elementTips = {
    木: ["成長と可能性を大切にするタイプ", "未来の話、挑戦していること、伸ばしたい強みから入ると会話が進みやすいです。", "最初から結論を急がせすぎず、考えを広げる余白を残すと関係が作りやすくなります。"],
    火: ["熱量と反応を大切にするタイプ", "面白いと思った点や期待していることを先に伝えると、前向きな空気を作りやすいです。", "淡々と条件だけを並べるより、目的や背景を添えると話が深まりやすくなります。"],
    土: ["安心感と具体性を大切にするタイプ", "流れ、目的、次に決めたいことを整理して伝えると、信頼を得やすいです。", "抽象的な話だけで進めず、具体例や段取りを添えると安心してもらいやすくなります。"],
    金: ["基準と成果を大切にするタイプ", "何を達成したいか、判断基準は何かを明確にすると、話が噛み合いやすいです。", "曖昧な約束より、役割や次のアクションをはっきりさせると関係が進みやすくなります。"],
    水: ["情報と柔軟性を大切にするタイプ", "相手の考えを引き出す質問から入ると、自然に本音や関心が見えやすくなります。", "一方的に話し切らず、相手が整理する時間を作ると会話が深まりやすいです。"],
  };
  const [type, approach, avoid] = elementTips[element];
  const lp = lifePathNumber(rawYear, month, day);
  const lpHint = LIFE_PATH_HINT[lp] || "";
  const displayName = name ? `${name}さん` : "お相手";
  return {
    method: "生年月日インサイト（算命学 日柱＋数秘術）",
    pillar: `${stems[stemIndex]}${branches[branchIndex]}`,
    element,
    type: `日柱「${stems[stemIndex]}${branches[branchIndex]}」五行「${element}」× 数秘${lp}: ${type}`,
    approach: `${approach}${lpHint ? `（数秘${lp}：${lpHint}）` : ""}`,
    avoid,
    birthday_status: getBirthdayStatus(dateString),
    birthday_message: `${displayName}、新しい一年が挑戦したいことに一歩近づく時間になりますように。`,
    note: "生年月日から機械的に算出した傾向（算命学の日柱五行＋数秘術ライフパス）です。断定ではなく、会話のきっかけとしてお使いください。",
  };
}

function buildBookingPayload(form) {
  const data = formData(form);
  const profile = buildRelationshipProfile(data.birth_date, data.visitor_name);
  data.filter_request = profile ? JSON.stringify({
    kind: "relationship_context",
    version: 4,
    birth_date: data.birth_date_private === "yes" ? "非公開" : data.birth_date,
    birth_date_private: data.birth_date_private === "yes",
    birthday_message_opt_in: Boolean(data.birth_date),
    profile,
  }) : "none";
  const answers = [...document.querySelectorAll("#questionnaire-fields .q-field")]
    .map((field) => ({
      question_id: field.dataset.questionId || null,
      question_text: field.dataset.questionText || "",
      answer_text: readQuestionField(field),
    }));
  // 未回答の任意項目も送る（#307）。落とすと質問そのものが記録から消え、
  // 「何を聞いたか」が分からなくなる。空欄は空欄として残し、画面/メールで「未回答」と出す。
  data.answers = answers;
  // topic は「相談内容」の代表値なので、空欄を飛ばして最初に埋まっている回答を採る。
  data.topic = answers.find((answer) => answer.answer_text)?.answer_text || "";
  delete data.birth_date;
  return data;
}

function resolveSlug() {
  const pathMatch = location.pathname.match(/^\/b\/([a-z0-9-]+)/i);
  if (pathMatch) return pathMatch[1].toLowerCase();
  const param = new URLSearchParams(location.search).get("slug");
  return param ? param.toLowerCase() : "demo";
}

let bookingSlug = "demo";
let currentStart = null; // 表示中の5日間の先頭日（"YYYY-MM-DD" JST）
let pageMinDate = null;  // 予約可能な最古日（これより過去は表示しない）
let pageMaxDate = null;  // 受付上限日
let calYear = 0, calMonth = 0; // カレンダーで表示中の年月

// --- 日付ユーティリティ（JST基準）---
function parseYmd(str) { const [y, m, d] = String(str || "").split("-").map(Number); return { y, m: (m || 1) - 1, d: d || 1 }; }
function ymdStr(y, m0, d) { return `${y}-${pad2(m0 + 1)}-${pad2(d)}`; }
function dateFromYmd(str, addDays = 0) { const p = parseYmd(str); return new Date(p.y, p.m, p.d + addDays); }
function shiftYmd(str, deltaDays) { const dt = dateFromYmd(str, deltaDays); return ymdStr(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
function todayYmd() { const d = new Date(); return ymdStr(d.getFullYear(), d.getMonth(), d.getDate()); }
// ISO(UTC) → JST の年月日・その日の分。
function jstFields(iso) {
  const t2 = new Date(iso).getTime() + 9 * 3600 * 1000;
  const u = new Date(t2);
  return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate(), min: u.getUTCHours() * 60 + u.getUTCMinutes() };
}
function fmtMin(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }
function weekdayShort(date) { return new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(date).replace("曜日", ""); }

function rangeLabelText(startYmd, days) {
  const start = dateFromYmd(startYmd, 0);
  const end = dateFromYmd(startYmd, (days || 5) - 1);
  const locale = currentLocale();
  const startTxt = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(start);
  const sameMonth = start.getMonth() === end.getMonth();
  const endTxt = new Intl.DateTimeFormat(locale, sameMonth ? { day: "numeric" } : { month: "long", day: "numeric" }).format(end);
  return `${startTxt} – ${endTxt}`;
}

// 5日タイムグリッドの描画。空き枠が無い日も列を出す（軸は稼働時間帯）。
function renderGrid(data) {
  const grid = $("#wk-grid");
  const weekcal = $("#weekcal");
  const form = $("#booking-form");
  if (!grid) return;
  const axis = data.axis || { start_min: 600, end_min: 1080 };
  const startHour = Math.max(0, Math.floor(axis.start_min / 60));
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(axis.end_min / 60)));
  const hours = endHour - startHour;
  const days = Number(data.days) || 5;
  const cols = Array.from({ length: days }, (_, i) => dateFromYmd(data.range_start, i));
  const colKey = (dt) => `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
  const byCol = new Map(cols.map((dt) => [colKey(dt), []]));
  (data.slots || []).forEach((s) => {
    const j = jstFields(s.start);
    const key = `${j.y}-${j.m}-${j.d}`;
    if (byCol.has(key)) byCol.get(key).push({ start: s.start, end: s.end, startMin: j.min, endMin: jstFields(s.end).min });
  });
  // 表示間隔（=隣接枠の最小間隔）に応じて縦軸(--hh)を伸ばし、短い間隔でも各枠に読みやすい高さを確保する。
  if (weekcal) {
    let step = Infinity;
    byCol.forEach((list) => {
      const mins = list.map((s) => s.startMin).sort((a, b) => a - b);
      for (let i = 1; i < mins.length; i++) { const d = mins[i] - mins[i - 1]; if (d > 0 && d < step) step = d; }
    });
    if (!isFinite(step)) step = 60;
    weekcal.style.removeProperty("--hh");
    const baseHH = parseFloat(getComputedStyle(weekcal).getPropertyValue("--hh")) || 56;
    const SLOT_MIN = 42; // 1枠の最低高さ(px)。間隔が短いほど --hh を伸ばす。
    const hh = Math.max(baseHH, Math.min(120, Math.round((SLOT_MIN * 60) / step)));
    weekcal.style.setProperty("--hh", `${hh}px`);
  }
  let axisLabels = "";
  for (let h = startHour; h <= endHour; h++) axisLabels += `<span class="hr" style="top:calc(var(--hh)*${h - startHour})">${pad2(h)}:00</span>`;
  const axisHtml = `<div class="wk-axis" style="min-height:calc(var(--hh)*${hours})">${axisLabels}</div>`;
  const headHtml = cols.map((dt) => `<div class="wk-headcell tappable" data-cal-open><span class="d">${dt.getDate()}</span>${escapeHtml(weekdayShort(dt))}</div>`).join("");
  const actionLabel = t("booking.week.book", "予約する");
  const dayColsHtml = cols.map((dt) => {
    const list = (byCol.get(colKey(dt)) || []).slice().sort((a, b) => a.startMin - b.startMin);
    const blocks = list.map((s, i) => {
      const top = (s.startMin - startHour * 60) / 60;
      const durH = (s.endMin - s.startMin) / 60;
      // 表示間隔が所要より短いと枠が重なるため、高さは「次の枠の開始まで(=表示間隔)」を超えないようにする。
      const gapH = (i + 1 < list.length) ? (list[i + 1].startMin - s.startMin) / 60 : durH;
      const height = Math.min(durH, gapH);
      // 低い枠は開始時刻のみ表示（終了は所要から自明）。2行が収まらず重なるのを防ぐ。
      const compact = height < 0.62;
      const label = compact
        ? `<span class="wk-slot-t">${escapeHtml(fmtMin(s.startMin))}</span>`
        : `<span class="wk-slot-t">${escapeHtml(fmtMin(s.startMin))}</span><span class="wk-slot-e">${escapeHtml(fmtMin(s.endMin))}</span>`;
      return `<button type="button" class="wk-slot${compact ? " is-compact" : ""}" data-start="${escapeHtml(s.start)}" data-end="${escapeHtml(s.end)}" title="${escapeHtml(actionLabel)}" style="top:calc(var(--hh)*${top.toFixed(3)});height:calc(var(--hh)*${height.toFixed(3)})">${label}</button>`;
    }).join("");
    return `<div class="wk-day" style="min-height:calc(var(--hh)*${hours})">${blocks}</div>`;
  }).join("");
  grid.innerHTML = `<div class="wk-navcell"></div>${headHtml}<div class="wk-navcell"></div>${axisHtml}${dayColsHtml}${axisHtml}`;
  grid._slots = data.slots || [];
  const selectedStart = form && form.elements.start.value;
  grid.querySelectorAll(".wk-slot").forEach((btn) => {
    btn.addEventListener("click", () => selectSlot({ start: btn.dataset.start, end: btn.dataset.end }, btn, form));
    if (selectedStart && btn.dataset.start === selectedStart) btn.classList.add("sel");
  });
  if (weekcal) weekcal.style.display = "";
}

function updateNav(data) {
  const prev = $("#prev-days");
  const next = $("#next-days");
  const label = $("#range-label");
  if (prev) prev.disabled = !data.hasPrev;
  if (next) next.disabled = !data.hasNext;
  if (label) label.textContent = rangeLabelText(data.range_start, Number(data.days) || 5);
}

// start（"YYYY-MM-DD" or null）の日から5日間を読み込む。過去はサーバ側で最古日にクランプ。
async function loadDays(startYmd, full) {
  const status = $("#slot-grid");
  const weekcal = $("#weekcal");
  const form = $("#booking-form");
  if (!status || !form) return;
  const firstPaint = !weekcal || weekcal.style.display === "none";
  if (full || firstPaint) {
    status.style.display = "";
    status.innerHTML = `<div class="week-loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(t("booking.week.loading", "空き枠を読み込み中..."))}</span></div>`;
  }
  [$("#prev-days"), $("#next-days")].forEach((b) => { if (b) b.disabled = true; });
  try {
    const q = startYmd ? `&start=${encodeURIComponent(startYmd)}` : "";
    const data = await api(`availability?slug=${encodeURIComponent(bookingSlug)}${q}`);
    currentStart = data.range_start || startYmd || todayYmd();
    data.range_start = currentStart; // range_start 欠落時も描画を壊さない（NaN日付でIntlが例外化するのを防ぐ）
    pageMinDate = data.min_date || null;
    pageMaxDate = data.max_date || null;
    if (full) { renderHost(data.host); renderQuestions(data.questions || []); }
    if (data.suspended || data.paused) {
      if (weekcal) weekcal.style.display = "none";
      status.style.display = "";
      status.innerHTML = `<p class="muted">${escapeHtml(data.suspended
        ? t("booking.week.suspended", "このページは現在ご利用いただけません。")
        : t("booking.week.paused", "現在、この予約ページは受付を停止しています。しばらくしてから再度お試しください。"))}</p>`;
      form.classList.add("hidden");
      return;
    }
    renderGrid(data);
    updateNav(data);
    status.style.display = "none";
    status.innerHTML = "";
  } catch (error) {
    setMessage("#booking-message", error.message, "error");
    [$("#prev-days"), $("#next-days")].forEach((b) => { if (b) b.disabled = false; });
  }
}

// --- 月カレンダー（範囲/日付タップで開く → 空き枠のある日を選ぶ → その日から5日間を表示）---
function renderDowRow() {
  const row = $("#cal-dow-row");
  if (!row) return;
  const locale = currentLocale();
  let html = "";
  for (let i = 0; i < 7; i++) {
    // 2023-01-01 は日曜。曜日名はロケール依存（Intl）。
    const d = new Date(2023, 0, 1 + i);
    html += `<div class="cal-dow">${escapeHtml(new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(d))}</div>`;
  }
  row.innerHTML = html;
}

function renderCalendar(data) {
  const wrap = $("#cal-days");
  if (!wrap) return;
  const has = new Set((data.days || []).map(Number));
  const minD = data.min_date ? parseYmd(data.min_date) : null;
  const maxD = data.max_date ? parseYmd(data.max_date) : null;
  const startDow = new Date(calYear, calMonth - 1, 1).getDay();
  const count = new Date(calYear, calMonth, 0).getDate();
  const inRange = (d) => {
    const cur = new Date(calYear, calMonth - 1, d).getTime();
    if (minD && cur < new Date(minD.y, minD.m, minD.d).getTime()) return false;
    if (maxD && cur > new Date(maxD.y, maxD.m, maxD.d).getTime()) return false;
    return true;
  };
  let html = "";
  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= count; d++) {
    const ok = has.has(d) && inRange(d);
    const attr = ok ? ` data-pick="${ymdStr(calYear, calMonth - 1, d)}"` : " disabled";
    html += `<button type="button" class="cal-day ${ok ? "has-slot" : "no-slot"}"${attr}>${d}<span class="dot"></span></button>`;
  }
  wrap.innerHTML = html;
  const ym = calYear * 12 + (calMonth - 1);
  const prevM = $("#cal-prev-month");
  const nextM = $("#cal-next-month");
  if (prevM) prevM.disabled = minD ? ym <= minD.y * 12 + minD.m : false;
  if (nextM) nextM.disabled = maxD ? ym >= maxD.y * 12 + maxD.m : false;
}

async function loadCalendarMonth() {
  const wrap = $("#cal-days");
  const title = $("#cal-title");
  if (title) title.textContent = new Intl.DateTimeFormat(currentLocale(), { year: "numeric", month: "long" }).format(new Date(calYear, calMonth - 1, 1));
  if (wrap) wrap.innerHTML = `<div class="cal-loading"><span class="spinner" aria-hidden="true"></span></div>`;
  try {
    const data = await api(`availability-days?slug=${encodeURIComponent(bookingSlug)}&year=${calYear}&month=${calMonth}`);
    renderCalendar(data);
  } catch (error) {
    if (wrap) wrap.innerHTML = `<p class="muted">${escapeHtml(t("booking.cal.error", "カレンダーの取得に失敗しました。"))}</p>`;
  }
}

async function openCalendar() {
  renderDowRow();
  const anchor = currentStart || pageMinDate || todayYmd();
  const p = parseYmd(anchor);
  calYear = p.y;
  calMonth = p.m + 1;
  const modal = $("#cal-modal");
  await withBusy(loadCalendarMonth);
  if (modal) modal.hidden = false;
}
function closeCalendar() { const m = $("#cal-modal"); if (m) m.hidden = true; }

// --- 3ステップ（日程調整 → 確認 → 完了）---
function jpDate(date) {
  return new Intl.DateTimeFormat(currentLocale(), { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
}

function fmtSlotRange(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime())) return t("booking.form.selectedEmpty", "日程を選んでください");
  return `${jpDate(start)} ${timeText(start)}〜${timeText(end)}`;
}

function goToStep(step) {
  document.querySelectorAll(".flow-step").forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });
  document.querySelectorAll("#stepper .step").forEach((item) => {
    const itemStep = Number(item.dataset.step);
    item.classList.toggle("is-active", itemStep === step);
    item.classList.toggle("is-done", itemStep < step);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function collectAnswers() {
  return [...document.querySelectorAll("#questionnaire-fields .q-field")]
    .map((field) => ({ question: field.dataset.questionText || "", answer: readQuestionField(field) }))
    .filter((item) => item.answer);
}

function buildSummaryRows(form) {
  const data = formData(form);
  const rows = [];
  rows.push({ label: t("booking.summary.schedule", "日程"), value: fmtSlotRange(form.elements.start.value, form.elements.end.value), primary: true });
  if (currentHost) {
    const loc = locationLabel(currentHost.location_type);
    const durationSub = t("booking.summary.durationShort", "所要 {min}分").replace("{min}", Number(currentHost.duration_minutes) || 30);
    rows.push({
      label: t("booking.summary.content", "内容"),
      value: currentHost.title || t("booking.summary.meeting", "面談"),
      sub: `${durationSub}${loc ? ` / ${loc}` : ""}`,
    });
  }
  rows.push({ label: t("booking.form.name", "お名前"), value: data.visitor_name || "" });
  rows.push({ label: t("booking.summary.email", "メール"), value: data.visitor_email || "" });
  collectAnswers().forEach((item) => rows.push({ label: item.question || t("booking.summary.answer", "回答"), value: item.answer }));
  if (data.birth_date) {
    rows.push({ label: t("booking.summary.birth", "生年月日"), value: data.birth_date_private === "yes" ? t("booking.summary.private", "非公開") : data.birth_date });
  }
  return rows;
}

function renderSummary(targetId, rows) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = rows
    .map((row) => `
      <div${row.primary ? ' class="is-primary"' : ""}>
        <dt>${escapeHtml(row.label)}</dt>
        <dd>${escapeHtml(row.value)}${row.sub ? `<span class="sub">${escapeHtml(row.sub)}</span>` : ""}</dd>
      </div>`)
    .join("");
}

function proceedToConfirm(form) {
  if (!form.elements.start.value) {
    setMessage("#booking-message", t("booking.err.selectSlot", "日程を選択してください。"), "error");
    return;
  }
  const missingRequired = [...document.querySelectorAll("#questionnaire-fields .q-field")]
    .some((field) => field.dataset.required && !readQuestionField(field));
  if (missingRequired) {
    setMessage("#booking-message", t("booking.err.requiredQuestions", "必須の質問にご回答ください。"), "error");
    return;
  }
  setMessage("#booking-message", "");
  renderSummary("confirm-list", buildSummaryRows(form));
  goToStep(2);
}

async function initBooking() {
  const grid = $("#slot-grid");
  const form = $("#booking-form");
  if (!grid || !form) return;
  bookingSlug = resolveSlug();
  if (form.elements.owner_slug) form.elements.owner_slug.value = bookingSlug;
  // 5日送り（前は最古日で無効化＝過去へ行けない。サーバも最古日にクランプ）。
  $("#prev-days")?.addEventListener("click", () => { if (currentStart) withBusy(() => loadDays(shiftYmd(currentStart, -5), false)); });
  $("#next-days")?.addEventListener("click", () => { if (currentStart) withBusy(() => loadDays(shiftYmd(currentStart, 5), false)); });
  // 範囲ボタン／日付ヘッダーで月カレンダーを開く。
  $("#range-btn")?.addEventListener("click", openCalendar);
  $("#wk-grid")?.addEventListener("click", (event) => { if (event.target.closest("[data-cal-open]")) openCalendar(); });
  $("#cal-close")?.addEventListener("click", closeCalendar);
  $("#cal-modal")?.addEventListener("click", (event) => { if (event.target.id === "cal-modal") closeCalendar(); });
  $("#cal-prev-month")?.addEventListener("click", () => { calMonth -= 1; if (calMonth < 1) { calMonth = 12; calYear -= 1; } withBusy(loadCalendarMonth); });
  $("#cal-next-month")?.addEventListener("click", () => { calMonth += 1; if (calMonth > 12) { calMonth = 1; calYear += 1; } withBusy(loadCalendarMonth); });
  // 空き枠のある日を選ぶ → その日から5日間を表示。
  $("#cal-days")?.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick]");
    if (!pick) return;
    closeCalendar();
    withBusy(() => loadDays(pick.getAttribute("data-pick"), false));
  });
  await withBusy(() => loadDays(null, true));

  // STEP1: 入力 → 確認へ（お名前/メールはブラウザ標準バリデーション後に submit が発火）
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    proceedToConfirm(form);
  });

  // STEP2: 修正に戻る / 予約を確定 → STEP3
  $("#back-to-schedule")?.addEventListener("click", () => {
    setMessage("#confirm-message", "");
    goToStep(1);
  });
  $("#confirm-book")?.addEventListener("click", async () => {
    const button = $("#confirm-book");
    setMessage("#confirm-message", t("booking.saving", "予約を保存しています..."));
    button.disabled = true;
    try {
      const result = await withBusy(() => api("book", { method: "POST", body: JSON.stringify(buildBookingPayload(form)) }));
      renderSummary("done-list", buildSummaryRows(form));
      const manage = document.getElementById("done-manage");
      if (manage && result?.manage_url) {
        const link = `<a href="${escapeHtml(result.manage_url)}">${escapeHtml(t("booking.manage.linkText", "こちらのページ"))}</a>`;
        manage.innerHTML = t("booking.manage.note", "予約の確認・日程変更・キャンセルは {link} から行えます（確認メールにも同じリンクを記載します）。").replace("{link}", link);
        manage.hidden = false;
      }
      goToStep(3);
    } catch (error) {
      setMessage("#confirm-message", error.message, "error");
      button.disabled = false;
    }
  });

  // 言語切替時にJSで描画したUIクロームを再描画する（入力済みの回答textareaは触らない）。
  document.addEventListener("kimaru:languagechange", () => {
    if (currentHost) renderHost(currentHost);
    // 5日グリッドを再取得して再描画（曜日見出し・範囲ラベルなどを反映）。
    withBusy(() => loadDays(currentStart, false));
    // 選択中の日程ラベルを更新。
    const selectedLabel = document.getElementById("selected-slot");
    if (selectedLabel && form.elements.start.value) {
      selectedLabel.textContent = fmtSlotRange(form.elements.start.value, form.elements.end.value);
    }
    // 確認・完了の内容リストが描画済みなら更新（dt/dd のラベルを再翻訳）。
    if (document.getElementById("confirm-list")?.children.length) renderSummary("confirm-list", buildSummaryRows(form));
    if (document.getElementById("done-list")?.children.length) renderSummary("done-list", buildSummaryRows(form));
  });
}

initBooking();
