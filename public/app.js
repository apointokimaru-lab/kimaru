const $ = (selector) => document.querySelector(selector);
const page = document.body.dataset.page;
let currentOwner = null;
let ownerAvailability = [];
let calendarConnected = false;

function t(key) {
  return window.KimaruI18n?.t(key) || key;
}

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || t("common.requestFailed"));
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

function formatSlot(iso) {
  const locale = window.KimaruI18n?.getLanguage() || "ja";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function timeText(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function monthTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function dayLabel(date) {
  return new Intl.DateTimeFormat("ja-JP", { day: "numeric", weekday: "short" }).format(date).replace("曜日", "");
}

function buildScheduleModel(slots) {
  const normalized = [...slots]
    .map((slot) => ({ ...slot, startDate: new Date(slot.start), endDate: new Date(slot.end) }))
    .filter((slot) => !Number.isNaN(slot.startDate.getTime()) && !Number.isNaN(slot.endDate.getTime()))
    .sort((a, b) => a.startDate - b.startDate);
  const keys = [...new Set(normalized.map((slot) => dateKey(slot.startDate)))].slice(0, 5);
  const days = keys.map((key) => normalized.find((slot) => dateKey(slot.startDate) === key).startDate);
  const visibleSlots = normalized.filter((slot) => keys.includes(dateKey(slot.startDate)));
  const minMinute = visibleSlots.length ? Math.min(...visibleSlots.map((slot) => minutesOfDay(slot.startDate))) : 600;
  const maxMinute = visibleSlots.length ? Math.max(...visibleSlots.map((slot) => minutesOfDay(slot.endDate))) : 1080;
  const startHour = Math.max(0, Math.floor(minMinute / 60));
  const endHour = Math.min(24, Math.max(startHour + 3, Math.ceil(maxMinute / 60)));
  return { days, slots: visibleSlots, startHour, endHour };
}

function selectSlot(slot, button, form) {
  form.classList.remove("hidden");
  form.elements.start.value = slot.start;
  form.elements.end.value = slot.end;
  document.querySelectorAll(".calendar-slot").forEach((item) => item.classList.remove("selected"));
  button.classList.add("selected");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderScheduleGrid(container, slots, form) {
  if (!slots.length) {
    container.innerHTML = '<p class="muted">現在受付中の日時がありません。</p>';
    return;
  }
  const model = buildScheduleModel(slots);
  const rowHeight = 86;
  const minutesStart = model.startHour * 60;
  const totalMinutes = (model.endHour - model.startHour) * 60;
  const hours = Array.from({ length: model.endHour - model.startHour + 1 }, (_, index) => model.startHour + index);
  const month = monthTitle(model.days[0]);
  const duration = Math.round((new Date(slots[0].end) - new Date(slots[0].start)) / 60000);

  container.innerHTML = `
    <div class="schedule-card">
      <div class="schedule-steps" aria-label="予約ステップ">
        <span class="active">1 日程選択</span><span>2 情報入力</span><span>3 予約完了</span>
      </div>
      <h3>ご都合の良い日時を選択してください</h3>
      <div class="schedule-meta"><span>所要時間</span><strong>${duration}分</strong></div>
      <div class="schedule-toolbar">
        <strong>${escapeHtml(month)}</strong>
        <span>アジア/東京 (UTC+09:00)</span>
      </div>
      <div class="calendar-board" style="--calendar-rows:${model.endHour - model.startHour};--calendar-row-height:${rowHeight}px;">
        <div class="calendar-corner"></div>
        <div class="calendar-days">${model.days.map((day) => `<div>${escapeHtml(dayLabel(day))}</div>`).join("")}</div>
        <div class="calendar-times">${hours.map((hour) => `<div>${pad2(hour)}:00</div>`).join("")}</div>
        <div class="calendar-grid-lines"></div>
        <div class="calendar-columns">${model.days.map((day) => `<div data-day="${dateKey(day)}"></div>`).join("")}</div>
      </div>
    </div>
  `;

  const columns = container.querySelector(".calendar-columns");
  model.slots.forEach((slot) => {
    const key = dateKey(slot.startDate);
    const dayIndex = model.days.findIndex((day) => dateKey(day) === key);
    if (dayIndex < 0) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-slot";
    const top = ((minutesOfDay(slot.startDate) - minutesStart) / totalMinutes) * 100;
    const height = Math.max(50, ((slot.endDate - slot.startDate) / 60000 / totalMinutes) * (model.endHour - model.startHour) * rowHeight);
    button.style.left = `calc(${dayIndex} * (100% / ${model.days.length}) + 4px)`;
    button.style.width = `calc((100% / ${model.days.length}) - 8px)`;
    button.style.top = `${top}%`;
    button.style.height = `${height}px`;
    button.innerHTML = `<span>${timeText(slot.startDate)} -</span><span>${timeText(slot.endDate)}</span>`;
    button.addEventListener("click", () => selectSlot(slot, button, form));
    columns.appendChild(button);
  });
}

function formatBirthDate(dateString) {
  if (!dateString) return "";
  if (dateString === "非公開") return dateString;
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return `${year}年${month}月${day}日`;
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

function getWesternZodiac(month, day) {
  const signs = [
    [120, "山羊座"], [219, "水瓶座"], [321, "魚座"], [420, "牡羊座"], [521, "牡牛座"], [622, "双子座"],
    [723, "蟹座"], [823, "獅子座"], [923, "乙女座"], [1024, "天秤座"], [1123, "蠍座"], [1222, "射手座"], [1232, "山羊座"],
  ];
  const value = month * 100 + day;
  return signs.find(([limit]) => value < limit)?.[1] || "山羊座";
}

function getSeasonInsight(month) {
  if ([3, 4, 5].includes(month)) return { season: "春生まれ", tip: "新しい挑戦や変化の話題から入ると、自然に会話が広がりやすいです。" };
  if ([6, 7, 8].includes(month)) return { season: "夏生まれ", tip: "体験談や最近熱量が上がっていることを聞くと、空気が温まりやすいです。" };
  if ([9, 10, 11].includes(month)) return { season: "秋生まれ", tip: "価値観、判断基準、これまで積み上げてきたことを聞くと話が深まりやすいです。" };
  return { season: "冬生まれ", tip: "落ち着いた雰囲気で、目的や背景を丁寧に確認すると信頼を作りやすいです。" };
}

function getGenerationInsight(year) {
  if (year >= 1997) return { generation: "デジタルネイティブ世代", tip: "スピード感、納得感、自由度を大切にすると会話が進みやすいです。" };
  if (year >= 1981) return { generation: "ミレニアル世代", tip: "意味、成長、働き方や人生設計の話題が接点になりやすいです。" };
  if (year >= 1965) return { generation: "経験重視世代", tip: "実績、信頼、具体的なメリットを整理して伝えると安心感が出やすいです。" };
  return { generation: "成熟世代", tip: "敬意を持って背景を聞き、急がず丁寧に関係を作ると話が進みやすいです。" };
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

function buildRelationshipProfile(dateString, name = "") {
  if (!dateString) return null;
  const [rawYear, month, day] = dateString.split("-").map(Number);
  if (!rawYear || !month || !day) return null;
  const lifePath = lifePathNumber(rawYear, month, day);
  const lifePathHint = LIFE_PATH_HINT[lifePath] || "";
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
  const zodiac = getWesternZodiac(month, day);
  const season = getSeasonInsight(month);
  const generation = getGenerationInsight(rawYear);
  const displayName = name ? `${name}さん` : "お相手";
  return {
    method: "生年月日インサイト（算命学＋数秘術）",
    pillar: `${stems[stemIndex]}${branches[branchIndex]}`,
    element,
    zodiac,
    season: season.season,
    generation: generation.generation,
    type: `${type}（数秘${lifePath}）`,
    approach: `${approach}${lifePathHint ? ` ${lifePathHint}` : ""}`,
    avoid,
    lenses: [
      `星座: ${zodiac}`,
      `季節感: ${season.season}。${season.tip}`,
      `世代感: ${generation.generation}。${generation.tip}`,
      `四柱推命メモ: ${stems[stemIndex]}${branches[branchIndex]} / ${element}`,
      `数秘術ライフパス: ${lifePath}。${lifePathHint}`,
    ],
    birthday_status: getBirthdayStatus(dateString),
    birthday_message: `${displayName}、お誕生日おめでとうございます。新しい一年が、挑戦したいことに一歩近づく時間になりますように。`,
    note: "生年月日から作る簡易メモです。断定ではなく、会話のきっかけや関係構築の仮説として使ってください。",
  };
}

function parseRelationshipContext(value) {
  if (!value || value === "none") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.kind === "relationship_context" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function buildBookingPayload(form) {
  const data = formData(form);
  const profile = buildRelationshipProfile(data.birth_date, data.visitor_name);
  data.filter_request = profile ? JSON.stringify({ kind: "relationship_context", version: 3, birth_date: data.birth_date, birth_date_private: data.birth_date_private === "yes", birthday_message_opt_in: Boolean(data.birth_date), profile }) : "none";
  delete data.birth_date;
  return data;
}

async function initSignup() {
  const form = $("#signup-form");
  if (!form) return;
  // パスワードと確認用の一致をリアルタイム検証（ブラウザ標準の検証UIにも連動）。
  const pw = form.elements.password;
  const pwConfirm = form.elements.password_confirm;
  const syncPasswordMatch = () => {
    if (!pwConfirm) return;
    const mismatch = Boolean(pwConfirm.value) && pw.value !== pwConfirm.value;
    pwConfirm.setCustomValidity(mismatch ? t("signup.passwordMismatch") : "");
  };
  pw?.addEventListener("input", syncPasswordMatch);
  pwConfirm?.addEventListener("input", syncPasswordMatch);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // 念のためJS側でも一致を確認（標準検証が無効な環境でも弾く）。
    if (pwConfirm && pw.value !== pwConfirm.value) {
      setMessage("#signup-message", t("signup.passwordMismatch"), "error");
      pwConfirm.focus();
      return;
    }
    setMessage("#signup-message", t("signup.creating"));
    try {
      const data = formData(form);
      // アカウント作成＋ログイン（セッション発行）
      await api("auth-register", { method: "POST", body: JSON.stringify({ name: data.name, email: data.email, password: data.password }) });
      // 利用目的・言語は申請記録として保存（任意・失敗しても続行）。確認用パスワードは送らない。
      const { password_confirm, ...signupRecord } = data;
      api("signup", { method: "POST", body: JSON.stringify(signupRecord) }).catch(() => {});
      setMessage("#signup-message", t("signup.done"), "success");
      location.href = "/dashboard.html";
    } catch (error) {
      setMessage("#signup-message", error.message, "error");
    }
  });
}

async function initBooking() {
  const grid = $("#slot-grid");
  const form = $("#booking-form");
  if (!grid || !form) return;
  try {
    const data = await api("availability?owner=demo");
    renderScheduleGrid(grid, data.slots || [], form);
  } catch (error) {
    setMessage("#booking-message", error.message, "error");
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("#booking-message", "予約を保存しています...");
    try {
      await api("book", { method: "POST", body: JSON.stringify(buildBookingPayload(form)) });
      form.reset();
      form.classList.add("hidden");
      setMessage("#booking-message", "予約が完了しました。確認メールとカレンダー予定を準備します。", "success");
    } catch (error) {
      setMessage("#booking-message", error.message, "error");
    }
  });
}

function renderRelationshipContext(context) {
  if (!context?.profile) return "";
  const profile = context.profile;
  const lenses = Array.isArray(profile.lenses) ? profile.lenses : [];
  return `
    <div class="relationship-insight">
      <strong>${escapeHtml(profile.method || "生年月日インサイト（簡易）")}: ${escapeHtml(profile.pillar || "")} / ${escapeHtml(profile.element || "")}</strong>
      <span>生年月日: ${escapeHtml(formatBirthDate(context.birth_date))}</span>
      ${lenses.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
      <p>${escapeHtml(profile.type || "")}</p>
      <p><b>仲良くなるヒント:</b> ${escapeHtml(profile.approach || "")}</p>
      <p><b>気をつけること:</b> ${escapeHtml(profile.avoid || "")}</p>
      ${context.birthday_message_opt_in ? `<p><b>誕生日:</b> ${escapeHtml(profile.birthday_status)}</p><p><b>お祝いメッセージ案:</b> ${escapeHtml(profile.birthday_message)}</p>` : ""}
      <small>${escapeHtml(profile.note || "")}</small>
    </div>
  `;
}

// ダッシュボードの「今日の予定」「これから」を owner-bookings の実データで描画する。
// 該当コンテナが無いページ（相手管理・予約設定）では何もしない。手動追加の相手・キャンセル済みは除外。
const DASH_LOCATION_LABELS = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  in_person: "対面",
  phone: "電話",
  custom_url: "オンライン",
  later: "後日連絡",
};

function dashLocationLabel(type) {
  return DASH_LOCATION_LABELS[type] || "オンライン";
}

function renderDashboardSchedule(allBookings) {
  const todayList = document.getElementById("today-list");
  const upcomingList = document.getElementById("upcoming-list");
  if (!todayList && !upcomingList) return;

  const locale = window.KimaruI18n?.getLanguage() || "ja";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);

  const real = (allBookings || [])
    .filter((b) => !b.manual && (b.start_at || b.start_time) && (!b.status || b.status === "confirmed"))
    .map((b) => ({ ...b, _start: new Date(b.start_at || b.start_time) }))
    .filter((b) => !Number.isNaN(b._start.getTime()));

  const todays = real
    .filter((b) => b._start >= startOfToday && b._start < startOfTomorrow)
    .sort((a, b) => a._start - b._start);
  const upcoming = real
    .filter((b) => b._start >= startOfTomorrow)
    .sort((a, b) => a._start - b._start)
    .slice(0, 5);

  if (todayList) {
    todayList.innerHTML = todays.length
      ? todays.map((b) => renderTodayAppt(b, now, locale)).join("")
      : `<p class="muted" style="padding:8px 2px">${escapeHtml(t("dash.today.empty"))}</p>`;
  }
  if (upcomingList) {
    upcomingList.innerHTML = upcoming.length
      ? upcoming.map((b) => renderUpcomingAppt(b, locale)).join("")
      : `<p class="muted" style="padding:8px 2px">${escapeHtml(t("dash.upcoming.empty"))}</p>`;
  }
}

// href に入れる URL は http/https のみ許可（javascript: 等のスキームを弾く・相対パスは現オリジンで解決）。
function safeHref(u) {
  if (!u) return "";
  try {
    const p = new URL(String(u), location.origin);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
  } catch (_) {
    return "";
  }
}

function renderTodayAppt(b, now, locale) {
  const hm = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(b._start);
  const name = escapeHtml(b.visitor_name || b.guest_name || t("admin.guest"));
  const loc = escapeHtml(dashLocationLabel(b.location_type));
  const endIso = b.end_at || b.end_time;
  const durMin = endIso ? Math.round((new Date(endIso) - b._start) / 60000) : 0;
  const dur = durMin > 0 ? `<small>${durMin}分</small>` : "";
  const isNow = endIso ? now >= b._start && now < new Date(endIso) : false;
  const url = escapeHtml(safeHref(b.meeting_url));
  const join = url
    ? `<div class="appt-actions"><a class="button primary btn-sm" href="${url}" target="_blank" rel="noopener">${escapeHtml(t("dash.appt.join"))}</a></div>`
    : "";
  return `
    <div class="appt${isNow ? " appt-now" : ""}">
      <div class="appt-time">${hm}${dur}</div>
      <div class="appt-body"><b>${name} さん</b><span>${loc}</span></div>
      ${join}
    </div>`;
}

function renderUpcomingAppt(b, locale) {
  const md = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(b._start);
  const wd = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(b._start);
  const hm = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(b._start);
  const name = escapeHtml(b.visitor_name || b.guest_name || t("admin.guest"));
  const loc = escapeHtml(dashLocationLabel(b.location_type));
  return `
    <div class="appt">
      <div class="appt-time" style="font-size:15px">${md}<small>${wd}</small></div>
      <div class="appt-body"><b>${name} さん</b><span>${hm} ・ ${loc}</span></div>
    </div>`;
}

// 予約アンケートの既読状態。バックエンド列が無いためブラウザ localStorage で保持（answers.html と共有）。
const ANSWERS_READ_KEY = "kimaru.answersRead";
function answersReadSet() {
  try { return new Set(JSON.parse(localStorage.getItem(ANSWERS_READ_KEY) || "[]")); } catch (_) { return new Set(); }
}
function markAnswerRead(id, read) {
  const s = answersReadSet();
  if (read) s.add(String(id)); else s.delete(String(id));
  try { localStorage.setItem(ANSWERS_READ_KEY, JSON.stringify([...s])); } catch (_) {}
}
function bookingHasAnswer(b) {
  return !b.manual && (!b.status || b.status === "confirmed") &&
    Boolean(String(b.topic || "").trim() || String(b.guest_message || "").trim());
}

// ダッシュボード「要対応」を実データで更新（今週の予約件数＋範囲・未読アンケート件数）。
function renderDashboardTodos(allBookings) {
  const weekRow = document.getElementById("todo-week");
  if (!weekRow) return;
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 月曜=0
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const confirmed = (allBookings || []).filter((b) => !b.manual && (b.start_at || b.start_time) && (!b.status || b.status === "confirmed"));

  const weekCount = confirmed.filter((b) => { const d = new Date(b.start_at || b.start_time); return d >= weekStart && d < weekEnd; }).length;
  const weekCnt = document.getElementById("todo-week-count");
  if (weekCnt) weekCnt.textContent = String(weekCount);
  const locale = window.KimaruI18n?.getLanguage() || "ja";
  const fmt = (d) => new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(d);
  const desc = document.getElementById("todo-week-desc");
  if (desc) desc.textContent = `${fmt(weekStart)} – ${fmt(new Date(weekEnd.getTime() - 86400000))}`;

  const read = answersReadSet();
  const unread = confirmed.filter((b) => bookingHasAnswer(b) && new Date(b.start_at || b.start_time) >= startOfToday && !read.has(String(b.id))).length;
  const aRow = document.getElementById("todo-answers");
  const aCnt = document.getElementById("todo-answers-count");
  if (aCnt) aCnt.textContent = String(unread);
  if (aRow) aRow.style.display = unread > 0 ? "" : "none";
}

// ダッシュボード「予約ページを共有」カード：先頭の予約ページURL＋動作するコピー。
async function loadDashboardShare() {
  const urlEl = document.getElementById("share-url");
  if (!urlEl) return;
  const copyBtn = document.getElementById("share-copy");
  try {
    const data = await api("booking-pages");
    const slug = (data.pages || [])[0]?.slug;
    if (slug) {
      urlEl.textContent = bookingPageUrl(slug);
      if (copyBtn) {
        copyBtn.style.display = "";
        if (!copyBtn.dataset.wired) {
          copyBtn.dataset.wired = "1";
          copyBtn.addEventListener("click", () => {
            navigator.clipboard?.writeText(urlEl.textContent).then(() => {
              const orig = t("dash.share.copy");
              copyBtn.textContent = t("dash.share.copied");
              setTimeout(() => { copyBtn.textContent = orig; }, 1500);
            }).catch(() => {});
          });
        }
      }
    } else {
      urlEl.textContent = t("dash.share.none");
      if (copyBtn) copyBtn.style.display = "none";
    }
  } catch (_) { /* 非致命 */ }
}

// ダッシュボード「プロフィール未設定の項目」：空の基本プロフィール項目数（0なら非表示）。
const DASH_PROFILE_FIELDS = ["profile_name", "profile_title", "profile_strengths", "profile_style", "profile_offer", "profile_values", "profile_goal"];
async function loadDashboardProfileTodo() {
  const row = document.getElementById("todo-profile");
  if (!row) return;
  try {
    const data = await api("profile");
    const p = data.profile || {};
    const missing = DASH_PROFILE_FIELDS.filter((f) => !String(p[f] || "").trim()).length;
    const cnt = document.getElementById("todo-profile-count");
    if (cnt) cnt.textContent = String(missing);
    row.style.display = missing > 0 ? "" : "none";
  } catch (_) { /* 非致命 */ }
}

function renderBookings(bookings) {
  const list = $("#booking-list");
  if (!list) return;
  if (!bookings.length) {
    list.innerHTML = `<tr><td colspan="4" class="empty-cell">${t("admin.noBookings")}</td></tr>`;
    return;
  }
  list.innerHTML = bookings.map((booking) => {
    const context = parseRelationshipContext(booking.filter_request);
    const insight = renderRelationshipContext(context);
    const name = escapeHtml(booking.visitor_name || booking.guest_name || t("admin.guest"));
    const email = escapeHtml(booking.visitor_email || booking.guest_email || "");
    const topic = escapeHtml(booking.topic || "");
    const when = booking.start_at || booking.start_time ? escapeHtml(formatSlot(booking.start_at || booking.start_time)) : "";
    // インサイト（生年月日）は任意・行が膨らむので details に畳む。textContent には残るので検索は効く。
    // 生年月日インサイト（占いベース相手分析）は Pro/Premium 限定（無料には出さない）。
    const insightCell = insight && isProPlan(currentOwner?.plan) ? `<details class="insight-toggle"><summary>${t("admin.contacts.insightToggle")}</summary>${insight}</details>` : "";
    const manualTag = booking.manual ? ` <span class="free-tag">${escapeHtml(t("admin.contacts.manualTag"))}</span>` : "";
    return `
      <tr class="list-item">
        <td data-label="${t("admin.contacts.colName")}"><strong>${name}</strong>${manualTag}</td>
        <td data-label="${t("admin.contacts.colEmail")}" class="cell-email">${email || "—"}</td>
        <td data-label="${t("admin.contacts.colTopic")}">${topic || (insightCell ? "" : "—")}${insightCell}</td>
        <td data-label="${t("admin.contacts.colDate")}" class="cell-date">${when || "—"}</td>
      </tr>
    `;
  }).join("");
}

function renderLogs(logs) {
  const list = $("#log-list");
  if (!list) return;
  list.innerHTML = logs.map((log) => `
    <article class="list-item">
      <strong>${escapeHtml(log.visitor_email)}</strong>
      <span>${escapeHtml(log.keywords || "")}</span>
      <p>${escapeHtml(log.notes || "")}</p>
      <small>${escapeHtml(log.next_action || "")}</small>
    </article>
  `).join("");
}

// 相手ごとの集約ビュー（#175）。構造化スコア(log.scores)を相手メールで集計し、面談回数と各項目の平均を表示。
function renderLogAggregate(logs) {
  const el = $("#log-aggregate");
  if (!el) return;
  const byEmail = new Map();
  (logs || []).forEach((log) => {
    const email = String(log.visitor_email || "").toLowerCase();
    if (!email) return;
    const entry = byEmail.get(email) || { email, count: 0, sums: {}, counts: {} };
    entry.count += 1;
    const scores = log.scores && typeof log.scores === "object" ? log.scores : {};
    Object.entries(scores).forEach(([key, value]) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      entry.sums[key] = (entry.sums[key] || 0) + n;
      entry.counts[key] = (entry.counts[key] || 0) + 1;
    });
    byEmail.set(email, entry);
  });
  const rows = [...byEmail.values()].sort((a, b) => b.count - a.count);
  if (!rows.length) {
    el.innerHTML = `<p class="muted">${escapeHtml(t("admin.agg.empty"))}</p>`;
    return;
  }
  el.innerHTML = rows.map((r) => {
    const avgs = Object.keys(r.sums).map((key) => `${escapeHtml(key)} ${(r.sums[key] / r.counts[key]).toFixed(1)}`).join(" ・ ");
    return `
    <article class="list-item">
      <strong>${escapeHtml(r.email)}</strong>
      <span>${escapeHtml(t("admin.agg.memoCount"))} ${r.count}${escapeHtml(t("admin.search.suffix"))}</span>
      <p>${avgs || escapeHtml(t("admin.agg.noScore"))}</p>
    </article>`;
  }).join("");
}

function updateAvailabilityRows() {
  document.querySelectorAll(".availability-row").forEach((row) => {
    const enabled = row.querySelector('input[type="checkbox"]')?.checked;
    row.classList.toggle("disabled", !enabled);
    row.querySelectorAll('input[type="time"]').forEach((input) => { input.disabled = !enabled; });
  });
}

function collectAvailabilitySettings(data) {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day_of_week: day,
    enabled: data[`availability_enabled_${day}`] === "on",
    start_time: data[`availability_start_${day}`] || "10:00",
    end_time: data[`availability_end_${day}`] || "18:00",
  })).filter((setting) => setting.enabled);
}

// 公開範囲ドロップダウンの値（"7d"/"14d"/"21d" or "1m".."6m"）を {months, days} に変換。
function parseRangeToken(token) {
  const m = String(token || "2m").match(/^(\d+)(d|m)$/);
  if (!m) return { months: 2, days: 0 };
  const n = Number(m[1]);
  return m[2] === "d" ? { months: 1, days: n } : { months: n, days: 0 };
}
// 保存済みページ（candidate_days/booking_range_months）から復元用トークンを作る。
function rangeTokenFromPage(page) {
  const days = Number(page?.candidate_days || 0);
  if (days > 0) return `${days}d`;
  return `${Number(page?.booking_range_months || 2)}m`;
}

// premium は pro の全機能を含む上位プラン。プラン判定はこのヘルパで統一する。
function isProPlan(plan) { return plan === "pro" || plan === "premium"; }

function updateBookingPageControls() {
  const isPro = isProPlan(currentOwner?.plan);
  const rangeSelect = $("#booking-range-select");
  const locationType = $("#location-type-select");
  const locationField = $("#location-value-field");
  const questionLimitMessage = $("#question-limit-message");
  if (rangeSelect) {
    // 無料は2ヶ月先まで。3ヶ月以降（3m/4m/5m/6m）は有料のみ。日数(7/14/21)は無料可。
    [...rangeSelect.options].forEach((option) => {
      const mm = option.value.match(/^(\d+)m$/);
      option.disabled = !isPro && Boolean(mm) && Number(mm[1]) >= 3;
    });
    const cur = rangeSelect.value.match(/^(\d+)m$/);
    if (!isPro && cur && Number(cur[1]) > 2) rangeSelect.value = "2m";
  }
  const questionLimit = isPro ? 5 : 2;
  if (questionLimitMessage) {
    questionLimitMessage.textContent = isPro ? t("bs.questionnaire.limitPro") : t("bs.questionnaire.limitFree");
  }
  const addQuestionBtn = $("#add-question");
  if (addQuestionBtn) {
    const count = document.querySelectorAll("#question-list .q-row").length;
    addQuestionBtn.disabled = count >= questionLimit;
  }
  if (locationType && locationField) {
    const needsDetail = ["in_person", "phone", "custom_url"].includes(locationType.value);
    locationField.classList.toggle("hidden", !needsDetail);
    const input = locationField.querySelector("input");
    if (input) {
      input.placeholder = { in_person: t("bs.locPh.inPerson"), phone: t("bs.locPh.phone"), custom_url: t("bs.locPh.customUrl") }[locationType.value] || "";
    }
  }
  // Google Meet自動発行を選んでいるのにカレンダー未連携だと、Meet URLは発行されない旨を警告。
  const meetWarning = $("#meet-warning");
  if (meetWarning && locationType) {
    meetWarning.classList.toggle("hidden", !(locationType.value === "google_meet" && !calendarConnected));
  }
  updateAvailabilityRows();
}

// 事前アンケート（可変）。＋ボタンで行を追加、削除で除去。無料2問/Pro5問。
// 新規作成時の事前アンケートは初期質問なし（空から始める）。
const DEFAULT_QUESTIONS = [];

const ANSWER_TYPES = ["text", "select", "checkbox"];

function questionRowHtml(q) {
  const obj = (typeof q === "string") ? { question_text: q } : (q || {});
  const isPro = isProPlan(currentOwner?.plan);
  const type = ANSWER_TYPES.includes(obj.answer_type) ? obj.answer_type : "text";
  const options = Array.isArray(obj.options) ? obj.options : [];
  const placeholder = escapeHtml(t("bs.questionnaire.placeholder"));
  const del = escapeHtml(t("bs.delete"));
  const textVal = escapeHtml(obj.question_text || "");
  // 無料は自由入力のみ。Pro・プレミアムは回答形式（自由入力/プルダウン/チェックボックス）＋選択肢を設定できる（決定27）。
  const choiceUi = isPro ? `
    <div class="q-row-choice">
      <select class="question-type" aria-label="${escapeHtml(t("bs.q.type.label"))}">
        <option value="text"${type === "text" ? " selected" : ""}>${escapeHtml(t("bs.q.type.text"))}</option>
        <option value="select"${type === "select" ? " selected" : ""}>${escapeHtml(t("bs.q.type.select"))}</option>
        <option value="checkbox"${type === "checkbox" ? " selected" : ""}>${escapeHtml(t("bs.q.type.checkbox"))}</option>
      </select>
      <textarea class="question-options${type === "text" ? " hidden" : ""}" rows="2" placeholder="${escapeHtml(t("bs.q.optionsPlaceholder"))}">${escapeHtml(options.join("\n"))}</textarea>
    </div>` : "";
  return `<div class="q-row" data-answer-type="${type}">
    <div class="q-row-main"><input class="question-input" placeholder="${placeholder}" value="${textVal}" /><button type="button" class="button secondary question-remove">${del}</button></div>${choiceUi}
  </div>`;
}

function renderQuestionRows(questions) {
  const list = $("#question-list");
  if (!list) return;
  const items = (questions && questions.length) ? questions : [""];
  list.innerHTML = items.map((q) => questionRowHtml(q)).join("");
  updateBookingPageControls();
}

function collectQuestions() {
  return [...document.querySelectorAll("#question-list .q-row")]
    .map((row) => {
      const question_text = (row.querySelector(".question-input")?.value || "").trim();
      const typeEl = row.querySelector(".question-type");
      let answer_type = typeEl ? typeEl.value : "text";
      if (!ANSWER_TYPES.includes(answer_type)) answer_type = "text";
      const optionsRaw = row.querySelector(".question-options")?.value || "";
      const options = answer_type === "text" ? [] : optionsRaw.split("\n").map((s) => s.trim()).filter(Boolean);
      return { question_text, answer_type, options };
    })
    .filter((q) => q.question_text);
}

function addQuestionRow() {
  const list = $("#question-list");
  if (!list) return;
  const limit = isProPlan(currentOwner?.plan) ? 5 : 2;
  if (list.querySelectorAll(".q-row").length >= limit) return;
  list.insertAdjacentHTML("beforeend", questionRowHtml(""));
  updateBookingPageControls();
}

function collectBookingPagePayload(form) {
  const data = formData(form);
  const isPro = isProPlan(currentOwner?.plan);
  const maxQuestions = isPro ? 5 : 2;
  const questions = collectQuestions()
    .slice(0, maxQuestions)
    .map((q, index) => ({ ...q, is_required: index < 2 }));
  const range = parseRangeToken(data.booking_range);
  return {
    id: data.page_id || undefined,
    slug: (data.slug || "").trim() || undefined,
    title: data.title,
    description: data.description,
    duration_minutes: Number(data.duration_minutes),
    buffer_before_minutes: Number(data.buffer_before_minutes),
    buffer_after_minutes: Number(data.buffer_after_minutes),
    booking_range_months: range.months,
    candidate_days: range.days,
    location_type: data.location_type,
    location_value: data.location_value || "",
    is_active: data.is_active !== "false",
    accept_holidays: data.accept_holidays !== "false",
    lead_time_hours: Number(data.lead_time_hours || 0),
    slot_interval_minutes: Number(data.slot_interval_minutes || 0),
    availability_settings: collectAvailabilitySettings(data),
    questions,
  };
}

function bookingPageUrl(slug) {
  return `${location.origin}/b/${slug}`;
}

function renderBookingPages(pages) {
  const el = $("#booking-pages-list");
  if (!el) return;
  el._pages = pages;
  if (!pages.length) {
    el.innerHTML = `<p class="muted">${escapeHtml(t("bs.list.empty"))}</p>`;
    return;
  }
  el.innerHTML = pages.map((p) => `
    <article class="list-item${p.is_active === false ? " is-paused" : ""}">
      <strong>${escapeHtml(p.title || t("bs.list.untitled"))}${p.is_active === false ? `<span class="pause-badge">${escapeHtml(t("bs.list.paused"))}</span>` : ""}</strong>
      <span>${escapeHtml(bookingPageUrl(p.slug))}</span>
      <small>${p.duration_minutes}${escapeHtml(t("bs.unit.min"))} / ${escapeHtml(p.location_type)} / ${p.candidate_days > 0 ? `${p.candidate_days}${escapeHtml(t("bs.unit.daysAhead"))}` : `${p.booking_range_months}${escapeHtml(t("bs.unit.monthsAhead"))}`}</small>
      <div class="actions">
        <a class="button secondary" href="${escapeHtml(bookingPageUrl(p.slug))}" target="_blank" rel="noopener">${escapeHtml(t("bs.list.open"))}</a>
        <button class="button secondary" type="button" data-page-action="copy" data-slug="${escapeHtml(p.slug)}">${escapeHtml(t("bs.list.copyUrl"))}</button>
        <button class="button secondary" type="button" data-page-action="edit" data-id="${escapeHtml(p.id)}">${escapeHtml(t("bs.list.edit"))}</button>
        <button class="button secondary" type="button" data-page-action="delete" data-id="${escapeHtml(p.id)}">${escapeHtml(t("bs.delete"))}</button>
      </div>
    </article>`).join("");
}

async function loadBookingPages() {
  const el = $("#booking-pages-list");
  if (el) el.innerHTML = `<p class="muted">${escapeHtml(t("bs.list.loading"))}</p>`;
  try {
    const data = await api("booking-pages");
    ownerAvailability = data.availability || [];
    renderBookingPages(data.pages || []);
  } catch (_) {
    if (el) el.innerHTML = `<p class="muted">${escapeHtml(t("bs.list.loadError"))}</p>`;
  }
}

// 受付時間（オーナー単位）をフォームに反映
function applyAvailability(form, settings) {
  const byDay = {};
  (settings || []).forEach((s) => { byDay[s.day_of_week] = s; });
  [0, 1, 2, 3, 4, 5, 6].forEach((day) => {
    const cb = form.elements[`availability_enabled_${day}`];
    const start = form.elements[`availability_start_${day}`];
    const end = form.elements[`availability_end_${day}`];
    const s = byDay[day];
    if (cb) cb.checked = Boolean(s);
    if (s && start && s.start_time) start.value = String(s.start_time).slice(0, 5);
    if (s && end && s.end_time) end.value = String(s.end_time).slice(0, 5);
  });
}

// 一覧 ⇄ 全幅エディタの切替（モーダルは廃止）。
function openPageEditor() {
  const editor = $("#page-editor");
  if (!editor) return;
  setMessage("#booking-page-message", "");
  const list = $("#list-view");
  if (list) list.hidden = true;
  editor.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closePageEditor() {
  const editor = $("#page-editor");
  const list = $("#list-view");
  if (editor) editor.hidden = true;
  if (list) list.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fillBookingPageForm(page) {
  const form = $("#booking-page-form");
  if (!form || !page) return;
  const set = (name, value) => { if (form.elements[name] != null && value != null) form.elements[name].value = value; };
  set("page_id", page.id || "");
  set("slug", page.slug || "");
  set("title", page.title != null ? page.title : "");
  set("description", page.description != null ? page.description : "");
  set("duration_minutes", String(page.duration_minutes || 30));
  set("buffer_before_minutes", String(page.buffer_before_minutes != null ? page.buffer_before_minutes : 0));
  set("buffer_after_minutes", String(page.buffer_after_minutes != null ? page.buffer_after_minutes : 0));
  set("booking_range", rangeTokenFromPage(page));
  set("is_active", page.is_active === false ? "false" : "true");
  set("location_type", page.location_type || "google_meet");
  set("location_value", page.location_value || "");
  set("accept_holidays", page.accept_holidays === false ? "false" : "true");
  set("lead_time_hours", String(page.lead_time_hours || 0));
  set("slot_interval_minutes", String(page.slot_interval_minutes || 0));
  // 事前アンケート（ページ単位・sort_order 順）を可変行で表示
  const questions = [...(page.questionnaire_questions || [])]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((q) => ({ question_text: q.question_text, answer_type: q.answer_type || "text", options: Array.isArray(q.options) ? q.options : [] }));
  renderQuestionRows(questions);
  // 受付時間（オーナー単位）
  applyAvailability(form, ownerAvailability);
  updateBookingPageControls();
  const editing = $("#booking-page-editing");
  if (editing) editing.textContent = `${t("bs.editor.editingPrefix")}${page.title || page.slug}`;
  const title = $("#page-editor-title");
  if (title) title.textContent = t("bs.editor.editTitle");
  openPageEditor();
}

function clearBookingPageForm() {
  const form = $("#booking-page-form");
  if (!form) return;
  form.reset();
  if (form.elements.page_id) form.elements.page_id.value = "";
  renderQuestionRows([...DEFAULT_QUESTIONS]);
  const editing = $("#booking-page-editing");
  if (editing) editing.textContent = t("bs.editor.editingNew");
  const title = $("#page-editor-title");
  if (title) title.textContent = t("bs.editor.title");
  updateBookingPageControls();
  openPageEditor();
}

async function refreshAdmin() {
  try {
    const me = await api("me");
    currentOwner = me.owner || null;
    calendarConnected = Boolean(me.calendar_connected);
    const ownerStatus = $("#owner-status");
    if (ownerStatus) ownerStatus.textContent = me.owner ? t("admin.loggedIn") : t("admin.notLoggedIn");
    const ownerCard = $("#owner-card");
    if (ownerCard) ownerCard.innerHTML = me.owner ? `<strong>${escapeHtml(me.owner.name || me.owner.email)}</strong><p>${escapeHtml(t("admin.planLabel"))}: ${escapeHtml(me.owner.plan === "premium" ? t("plan.premium") : me.owner.plan === "pro" ? t("plan.pro") : t("plan.free"))}</p>` : "";
    updateBookingPageControls();
    if (me.owner) {
      // 予約履歴（相手レコード）の閲覧は無料にも開放（決定19）。失敗しても致命にしない。
      try { const bookings = await api("owner-bookings"); renderBookings(bookings.bookings || []); renderDashboardSchedule(bookings.bookings || []); renderDashboardTodos(bookings.bookings || []); } catch (_) { /* 非致命 */ }
      // 面談メモ・印象スコア（appointment-log）は Pro/Premium 限定。
      if (isProPlan(me.owner.plan)) {
        try { const logs = await api("appointment-log"); renderLogs(logs.logs || []); renderLogAggregate(logs.logs || []); } catch (_) { /* 非致命 */ }
      }
      await loadBookingPages();
    } else {
      // クッキーは存在するがセッションが無効（署名不一致/owner不在）＝認証の宙ぶらり状態。
      // 「読み込み中」のまま固まらないよう、スピナーを止めて再ログインを促す。
      const list = $("#booking-pages-list");
      if (list) list.innerHTML = `<p class="muted">セッションの有効期限が切れているようです。<a href="/login.html?next=${encodeURIComponent(location.pathname)}">再度ログイン</a>してください。</p>`;
    }
  } catch (error) {
    setMessage("#owner-status", error.message, "error");
    const list = $("#booking-pages-list");
    if (list) list.innerHTML = '<p class="muted">読み込みに失敗しました。ページを再読み込みするか、再度ログインしてください。</p>';
  }
}

async function initAdmin() {
  await refreshAdmin();
  if (page === "dashboard") { loadDashboardShare(); loadDashboardProfileTodo(); }
  document.addEventListener("kimaru:languagechange", () => { refreshAdmin(); });
  $("#logout-button")?.addEventListener("click", async () => {
    await api("logout", { method: "POST", body: "{}" }).catch(() => null);
    location.reload();
  });
  $("#location-type-select")?.addEventListener("change", updateBookingPageControls);
  $("#booking-range-select")?.addEventListener("change", updateBookingPageControls);
  $("#booking-page-new")?.addEventListener("click", clearBookingPageForm);
  $("#add-question")?.addEventListener("click", addQuestionRow);
  $("#question-list")?.addEventListener("click", (event) => {
    if (event.target.closest(".question-remove")) {
      event.target.closest(".q-row")?.remove();
      updateBookingPageControls();
    }
  });
  // 回答形式の変更：選択肢入力欄（プルダウン/チェックボックス時のみ）の表示を切替。
  $("#question-list")?.addEventListener("change", (event) => {
    const typeEl = event.target.closest(".question-type");
    if (!typeEl) return;
    const row = typeEl.closest(".q-row");
    if (row) row.dataset.answerType = typeEl.value;
    const opts = row?.querySelector(".question-options");
    if (opts) opts.classList.toggle("hidden", typeEl.value === "text");
  });
  $("#page-editor-close")?.addEventListener("click", closePageEditor);
  $("#booking-pages-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-page-action]");
    if (!button) return;
    const action = button.dataset.pageAction;
    const pages = $("#booking-pages-list")?._pages || [];
    if (action === "copy") {
      const url = bookingPageUrl(button.dataset.slug);
      navigator.clipboard?.writeText(url).catch(() => {});
      setMessage("#booking-list-message", `URLをコピーしました: ${url}`, "success");
    } else if (action === "edit") {
      fillBookingPageForm(pages.find((p) => p.id === button.dataset.id));
    } else if (action === "delete") {
      if (!confirm("この予約ページを削除しますか？")) return;
      setMessage("#booking-list-message", "削除しています...");
      try {
        await api("booking-pages", { method: "POST", body: JSON.stringify({ action: "delete", id: button.dataset.id }) });
        await loadBookingPages();
        setMessage("#booking-list-message", "削除しました。", "success");
      } catch (error) {
        setMessage("#booking-list-message", error.message, "error");
      }
    }
  });
  document.querySelectorAll('.availability-row input[type="checkbox"]').forEach((checkbox) => checkbox.addEventListener("change", updateAvailabilityRows));
  $("#booking-page-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("#booking-page-message", "予約ページを保存しています...");
    try {
      await api("booking-page-save", { method: "POST", body: JSON.stringify(collectBookingPagePayload(event.currentTarget)) });
      await refreshAdmin();
      closePageEditor();
    } catch (error) {
      setMessage("#booking-page-message", error.message, "error");
    }
  });
  $("#invite-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("#invite-message", t("admin.applying"));
    try {
      const result = await api("invite-apply", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
      setMessage("#invite-message", result?.pending ? t("admin.proPending") : t("admin.proUnlocked"), "success");
      await refreshAdmin();
    } catch (error) {
      setMessage("#invite-message", error.message, "error");
    }
  });
  $("#log-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("#log-message", t("admin.logSaving"));
    try {
      await api("appointment-log", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
      event.currentTarget.reset();
      setMessage("#log-message", t("admin.logSaved"), "success");
      await refreshAdmin();
    } catch (error) {
      setMessage("#log-message", error.message, "error");
    }
  });
  // 手動の相手追加（プレミアム限定・決定27）。成功後に相手一覧を再読込。
  $("#manual-contact-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("#manual-contact-message", t("admin.manual.saving"));
    try {
      await api("manual-contact", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
      event.currentTarget.reset();
      setMessage("#manual-contact-message", t("admin.manual.added"), "success");
      await refreshAdmin();
    } catch (error) {
      setMessage("#manual-contact-message", error.message, "error");
    }
  });
}

window.KimaruI18n?.init();
// ===== 週間スケジュール（schedule.html）: owner-bookings を実データ源に週グリッドを描画 =====
async function initSchedule() {
  const grid = document.getElementById("week-grid");
  if (!grid) return;
  let offset = 0;
  let bookings = [];
  try {
    const data = await api("owner-bookings");
    bookings = (data.bookings || [])
      .filter((b) => !b.manual && (b.start_at || b.start_time) && (!b.status || b.status === "confirmed"))
      .map((b) => ({ ...b, _start: new Date(b.start_at || b.start_time) }))
      .filter((b) => !Number.isNaN(b._start.getTime()));
  } catch (_) { /* 非致命 */ }

  const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (x.getDay() + 6) % 7; return new Date(x.getFullYear(), x.getMonth(), x.getDate() - dow); };
  function render() {
    const locale = window.KimaruI18n?.getLanguage() || "ja";
    const now = new Date();
    const todayKey = now.toDateString();
    const start = mondayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7));
    const dowFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    const mdFmt = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
    const hmFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
    const rangeEl = document.getElementById("weekRange");
    const end = new Date(start.getTime() + 6 * 86400000);
    if (rangeEl) rangeEl.textContent = `${mdFmt.format(start)} – ${mdFmt.format(end)}`;
    let cols = "";
    for (let i = 0; i < 7; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dayEnd = new Date(day.getTime() + 86400000);
      const isToday = day.toDateString() === todayKey;
      const items = bookings.filter((b) => b._start >= day && b._start < dayEnd).sort((a, b) => a._start - b._start);
      const body = items.length
        ? items.map((b) => `<a class="wk-appt" href="/meeting.html?id=${encodeURIComponent(b.id)}"><div class="wk-time">${hmFmt.format(b._start)}</div><div class="wk-name">${escapeHtml(b.visitor_name || b.guest_name || t("admin.guest"))}</div><div class="wk-meta">${escapeHtml(dashLocationLabel(b.location_type))}</div></a>`).join("")
        : `<div class="week-empty">${escapeHtml(t("sched.empty"))}</div>`;
      cols += `<div class="week-col${isToday ? " is-today" : ""}"><div class="week-colhead"><div class="week-dow">${escapeHtml(dowFmt.format(day))}${isToday ? "・" + escapeHtml(t("sched.todayTag")) : ""}</div><div class="week-date">${day.getDate()}</div></div><div class="week-body">${body}</div></div>`;
    }
    grid.innerHTML = cols;
  }
  document.getElementById("weekPrev")?.addEventListener("click", () => { offset--; render(); });
  document.getElementById("weekNext")?.addEventListener("click", () => { offset++; render(); });
  document.getElementById("weekToday")?.addEventListener("click", () => { offset = 0; render(); });
  document.addEventListener("kimaru:languagechange", render);
  render();
}

// 予約から「事前アンケート回答」行を作る（topic ＋ 質問回答 ＋ メッセージ）。
function answerRows(b) {
  const rows = [];
  if (String(b.topic || "").trim()) rows.push([t("ans.q.topic"), b.topic]);
  (b.answers || []).forEach((a) => { if (a && String(a.answer_text || "").trim()) rows.push([a.question_text || t("ans.q.topic"), a.answer_text]); });
  if (String(b.guest_message || "").trim()) rows.push([t("meeting.guestMessageLabel"), b.guest_message]);
  return rows;
}

// ===== 事前アンケート回答一覧（answers.html）=====
async function initAnswers() {
  const list = document.getElementById("ans-list");
  if (!list) return;
  const countEl = document.getElementById("unread-count");
  const totalEl = document.getElementById("total-count");
  const emptyNote = document.getElementById("empty-note");
  let filter = "all";
  let items = [];
  try {
    const data = await api("owner-bookings");
    items = (data.bookings || [])
      .filter((b) => !b.manual && (b.start_at || b.start_time) && (!b.status || b.status === "confirmed") && answerRows(b).length)
      .map((b) => ({ ...b, _start: new Date(b.start_at || b.start_time) }))
      .sort((a, b) => b._start - a._start);
  } catch (_) { /* 非致命 */ }

  function card(b, isRead) {
    const name = escapeHtml(b.visitor_name || b.guest_name || t("admin.guest"));
    const avatar = escapeHtml((String(b.visitor_name || "").trim().charAt(0)) || "?");
    const when = escapeHtml(formatSlot(b.start_at || b.start_time));
    const loc = escapeHtml(dashLocationLabel(b.location_type));
    const summary = answerRows(b).map(([q, a]) => `<div><dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd></div>`).join("");
    const badge = isRead ? `<span class="badge badge-read">${escapeHtml(t("ans.badgeRead"))}</span>` : `<span class="badge badge-unread">${escapeHtml(t("ans.badgeUnread"))}</span>`;
    const markBtn = isRead ? "" : `<button class="btn btn-primary btn-sm" type="button" data-mark-read="${escapeHtml(String(b.id))}">${escapeHtml(t("ans.markRead"))}</button>`;
    return `<section class="panel ans-card${isRead ? " is-read" : ""}" data-read="${isRead ? 1 : 0}">
      <div class="ans-head"><span class="avatar">${avatar}</span><div style="min-width:0"><div class="nm">${name}</div><div class="mt">${when} ・ ${loc}</div></div><span class="st">${badge}</span></div>
      <dl class="summary">${summary}</dl>
      <div class="form-actions" style="margin-top:16px">${markBtn}<a class="btn btn-ghost btn-sm" href="/meeting.html?id=${encodeURIComponent(b.id)}">${escapeHtml(t("ans.detail"))}</a></div>
    </section>`;
  }
  function render() {
    const read = answersReadSet();
    const visible = items.filter((b) => filter !== "unread" || !read.has(String(b.id)));
    list.innerHTML = visible.map((b) => card(b, read.has(String(b.id)))).join("");
    if (countEl) countEl.textContent = String(items.filter((b) => !read.has(String(b.id))).length);
    if (totalEl) totalEl.textContent = String(items.length);
    if (emptyNote) emptyNote.style.display = visible.length ? "none" : "block";
    list.querySelectorAll("[data-mark-read]").forEach((btn) => btn.addEventListener("click", () => { markAnswerRead(btn.dataset.markRead, true); render(); }));
  }
  document.querySelectorAll(".filter-btn").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll(".filter-btn").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }));
  document.addEventListener("kimaru:languagechange", render);
  render();
}

// ===== 面談ブリーフィング（meeting.html）: ?id の予約を owner-bookings から取得して描画 =====
async function initMeeting() {
  const h1 = document.getElementById("meeting-h1");
  if (!h1) return;
  const id = new URLSearchParams(location.search).get("id");
  let booking = null;
  let logs = [];
  if (id) {
    try {
      const data = await api("owner-bookings");
      booking = (data.bookings || []).find((b) => String(b.id) === String(id)) || null;
    } catch (_) { /* 非致命 */ }
    try { const lg = await api("appointment-log"); logs = lg.logs || []; } catch (_) { /* free/未連携は空 */ }
  }
  const setText = (elId, text) => { const el = document.getElementById(elId); if (el) el.textContent = text; };
  const setHtml = (elId, html) => { const el = document.getElementById(elId); if (el) el.innerHTML = html; };

  if (!booking) {
    setText("meeting-h1", t("meeting.notFound"));
    setText("meeting-name", t("meeting.notFound"));
    setText("meeting-when", "");
    document.getElementById("meeting-countdown")?.style.setProperty("display", "none");
    return;
  }

  function render() {
    const name = booking.visitor_name || booking.guest_name || t("admin.guest");
    setText("meeting-h1", `${name}${t("meeting.titleSuffix")}`);
    setText("meeting-name", name);
    setText("meeting-when", `${formatSlot(booking.start_at || booking.start_time)} ・ ${dashLocationLabel(booking.location_type)}`);
    const cd = document.getElementById("meeting-countdown"); if (cd) cd.style.display = "none";
    const av = document.querySelector(".crm-dhead .avatar"); if (av) av.textContent = (String(name).trim().charAt(0)) || "?";

    // 会議リンク
    const meetUrl = booking.meeting_url || "";
    const safeMeet = safeHref(meetUrl);
    const meetCode = document.getElementById("meet-url");
    const meetJoin = document.getElementById("meet-join");
    if (meetUrl) {
      if (meetCode) meetCode.textContent = meetUrl;
      if (meetJoin) {
        if (safeMeet) { meetJoin.setAttribute("href", safeMeet); meetJoin.style.display = ""; }
        else { meetJoin.style.display = "none"; }
      }
    } else {
      if (meetCode) meetCode.textContent = dashLocationLabel(booking.location_type);
      if (meetJoin) meetJoin.style.display = "none";
    }
    // 日程変更・キャンセル（署名付き管理リンク）
    const mgr = safeHref(booking.manage_url);
    document.querySelectorAll('[data-meeting-manage]').forEach((a) => { if (mgr) a.setAttribute("href", mgr); else a.style.display = "none"; });

    // 事前アンケート
    const rows = answerRows(booking);
    setHtml("meeting-survey", rows.length ? rows.map(([q, a]) => `<div><dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd></div>`).join("") : `<div><dd>${escapeHtml(t("meeting.surveyNone"))}</dd></div>`);
    // 未読バッジ＋確認済みボタン
    const isRead = answersReadSet().has(String(booking.id));
    const sbadge = document.getElementById("meeting-survey-badge");
    if (sbadge) { sbadge.className = isRead ? "badge badge-read" : "badge badge-unread"; sbadge.textContent = isRead ? t("ans.badgeRead") : t("ans.badgeUnread"); }
    const markBtn = document.getElementById("mark-read");
    if (markBtn) markBtn.style.display = isRead ? "none" : "";

    // 占いベース分析（生年月日機能は準備中）
    setText("meeting-fortune", t("meeting.fortunePending"));

    // 相手プロフィール（保有している実データのみ：メール／生年月日）
    const pRows = [];
    if (booking.visitor_email) pRows.push([t("meeting.emailLabel"), booking.visitor_email]);
    if (booking.visitor_birth_date) pRows.push([t("meeting.birthdayLabel"), booking.visitor_birth_date]);
    setHtml("meeting-profile", pRows.length ? pRows.map(([q, a]) => `<div><dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd></div>`).join("") : `<div><dd>${escapeHtml(t("meeting.profileNone"))}</dd></div>`);

    // 面談メモ（appointment-log の同一相手）
    const email = String(booking.visitor_email || "").toLowerCase();
    const myLogs = logs.filter((l) => String(l.visitor_email || "").toLowerCase() === email && (l.notes || l.keywords || l.next_action));
    const memoCount = document.getElementById("meeting-memo-count");
    if (memoCount) memoCount.textContent = `（${myLogs.length}）`;
    setHtml("meeting-memos", myLogs.length
      ? myLogs.map((l) => `<div class="memo-head"><span class="memo-topic">${escapeHtml(l.keywords || "")}</span></div><p class="readtext">${escapeHtml(l.notes || "")}</p>${l.next_action ? `<div class="memo-next"><b>${escapeHtml(t("meeting.memoNextLabel"))}</b><span>${escapeHtml(l.next_action)}</span></div>` : ""}`).join("<hr>")
      : `<p class="readtext">${escapeHtml(t("meeting.memoNone"))}</p>`);
  }
  document.getElementById("mark-read")?.addEventListener("click", () => { markAnswerRead(booking.id, true); render(); });
  document.addEventListener("kimaru:languagechange", render);
  render();
}

if (page === "schedule") initSchedule();
if (page === "answers") initAnswers();
if (page === "meeting") initMeeting();
if (page === "signup") initSignup();
if (page === "booking") initBooking();
if (["dashboard", "contacts", "booking-settings", "admin"].includes(page)) initAdmin();
