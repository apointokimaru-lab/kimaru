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
  const list = bookingQuestions.length
    ? bookingQuestions
    : [{ id: null, question_text: t("booking.form.topic", "今回お話したい内容"), is_required: true, answer_type: "text", options: [] }];
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

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
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

function slotKey(slot) {
  return `${dateKey(slot.startDate)}-${timeText(slot.startDate)}`;
}

function selectSlot(slot, button, form) {
  form.classList.remove("hidden");
  form.elements.start.value = slot.start;
  form.elements.end.value = slot.end;
  const selectedLabel = document.getElementById("selected-slot");
  if (selectedLabel) selectedLabel.textContent = fmtSlotRange(slot.start, slot.end);
  document.querySelectorAll(".week-slot").forEach((item) => item.classList.remove("selected"));
  button.classList.add("selected");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 週テーブルの描画は共有レンダラ（week-table.js）へ切り出し。予約変更画面（manage-booking.js）と共通。
function renderWeeklyAvailability(container, rawSlots, form) {
  window.KimaruWeekTable.render(container, rawSlots, {
    navId: "week-nav",
    labelId: "week-label",
    actionLabel: t("booking.week.book", "予約する"),
    onSelect: (slot, button) => selectSlot(slot, button, form),
  });
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

// 算命学（年柱の五行）＋数秘術（ライフパス）から決定的にインサイトを算出する（#20）。
function buildRelationshipProfile(dateString, name = "") {
  if (!dateString) return null;
  const [rawYear, month, day] = dateString.split("-").map(Number);
  if (!rawYear || !month || !day) return null;
  // 立春前(2/4頃)は前年扱い→年干→五行。
  const adjustedYear = month < 2 || (month === 2 && day < 4) ? rawYear - 1 : rawYear;
  const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const elements = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"];
  const stemIndex = (((adjustedYear - 4) % 10) + 10) % 10;
  const branchIndex = (((adjustedYear - 4) % 12) + 12) % 12;
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
    method: "生年月日インサイト（算命学＋数秘術）",
    pillar: `${stems[stemIndex]}${branches[branchIndex]}`,
    element,
    type: `五行「${element}」× 数秘${lp}: ${type}`,
    approach: `${approach}${lpHint ? `（数秘${lp}：${lpHint}）` : ""}`,
    avoid,
    birthday_status: getBirthdayStatus(dateString),
    birthday_message: `${displayName}、新しい一年が挑戦したいことに一歩近づく時間になりますように。`,
    note: "生年月日から機械的に算出した傾向（算命学の年柱五行＋数秘術ライフパス）です。断定ではなく、会話のきっかけとしてお使いください。",
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
    }))
    .filter((answer) => answer.answer_text);
  data.answers = answers;
  data.topic = answers[0]?.answer_text || "";
  delete data.birth_date;
  return data;
}

function resolveSlug() {
  const pathMatch = location.pathname.match(/^\/b\/([a-z0-9-]+)/i);
  if (pathMatch) return pathMatch[1].toLowerCase();
  const param = new URLSearchParams(location.search).get("slug");
  return param ? param.toLowerCase() : "demo";
}

let currentWeek = 0;
let bookingSlug = "demo";

function weekRangeLabel(week) {
  const base = new Date();
  base.setDate(base.getDate() + week * 7);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function updateWeekNav(hasPrev, hasNext) {
  const nav = $("#week-nav");
  if (!nav) return;
  nav.style.display = "";
  const prev = $("#prev-week");
  const next = $("#next-week");
  const label = $("#week-label");
  if (prev) prev.disabled = !hasPrev;
  if (next) next.disabled = !hasNext;
  if (label) label.textContent = weekRangeLabel(currentWeek);
}

async function loadWeek(week, full) {
  const grid = $("#slot-grid");
  const form = $("#booking-form");
  if (!grid || !form) return;
  // カレンダー内に移動した週ナビを、グリッド書き換えで失わないよう退避する。
  const weekNav = $("#week-nav");
  if (weekNav && grid.contains(weekNav)) grid.parentElement.insertBefore(weekNav, grid);
  grid.innerHTML = `<p class="muted">${escapeHtml(t("booking.week.loading", "空き枠を読み込み中..."))}</p>`;
  try {
    const data = await api(`availability?slug=${encodeURIComponent(bookingSlug)}&week=${week}`);
    currentWeek = typeof data.week === "number" ? data.week : week;
    if (full) {
      renderHost(data.host);
      renderQuestions(data.questions || []);
    }
    if (data.suspended) {
      grid.innerHTML = `<p class="muted">${escapeHtml(t("booking.week.suspended", "このページは現在ご利用いただけません。"))}</p>`;
      form.classList.add("hidden");
      const nav = $("#week-nav");
      if (nav) nav.style.display = "none";
      return;
    }
    if (data.paused) {
      grid.innerHTML = `<p class="muted">${escapeHtml(t("booking.week.paused", "現在、この予約ページは受付を停止しています。しばらくしてから再度お試しください。"))}</p>`;
      form.classList.add("hidden");
      const nav = $("#week-nav");
      if (nav) nav.style.display = "none";
      return;
    }
    renderWeeklyAvailability(grid, data.slots || [], form);
    updateWeekNav(Boolean(data.hasPrev), Boolean(data.hasNext));
  } catch (error) {
    setMessage("#booking-message", error.message, "error");
  }
}

// 「直近の空き時間」: 現在の週から順に空き枠を探し、最も早い枠を自動選択する。
async function jumpToNearestSlot() {
  const grid = $("#slot-grid");
  const form = $("#booking-form");
  const btn = $("#nearest-slot");
  if (!grid || !form) return;
  if (btn) btn.disabled = true;
  try {
    // 今の週に空きが無ければ、次の週へ最大12週分たどる（hasNext が尽きたら打ち切り）。
    for (let i = 0; i < 12 && !(grid._slots || []).length; i++) {
      const next = $("#next-week");
      if (!next || next.disabled) break;
      await loadWeek(currentWeek + 1, false);
    }
    const slots = grid._slots || [];
    if (!slots.length) return;
    const target = grid.querySelector(`td[data-slot-key="${slotKey(slots[0])}"] .week-slot`);
    if (target) target.click();
  } finally {
    if (btn) btn.disabled = false;
  }
}

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
  $("#prev-week")?.addEventListener("click", () => { if (currentWeek > 0) loadWeek(currentWeek - 1, false); });
  $("#next-week")?.addEventListener("click", () => loadWeek(currentWeek + 1, false));
  $("#nearest-slot")?.addEventListener("click", jumpToNearestSlot);
  await loadWeek(0, true);

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
      const result = await api("book", { method: "POST", body: JSON.stringify(buildBookingPayload(form)) });
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
    // 週グリッドを再取得して再描画（曜日見出し・ボタン文言などを反映）。
    loadWeek(currentWeek, false);
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
