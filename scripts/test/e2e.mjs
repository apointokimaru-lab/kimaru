// E2E（Playwright）。public/ を静的配信し、各ページを実ブラウザでロード。
// /api/* は route で実データ形のモックに差し替え、実データ描画・ボタン動作・残ダミー無し・JS例外無しを検証。
//   node scripts/test/e2e.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = path.join(repo, "public");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  ✗ " + n); } };
const section = (n) => console.log("\n# " + n);

// ---- 静的サーバ（public/）。/api/* は Playwright route が処理するのでここでは触らない ----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  // netlify.toml の rewrite 相当。/b/<slug> と /p/<token> は booking.html を返す。
  if (/^\/(b|p)\//.test(p)) p = "/booking.html";
  const file = path.join(pub, p);
  if (!file.startsWith(pub) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// ---- モックデータ（実APIのレスポンス形に一致） ----
const now = new Date();
const iso = (off, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h, m).toISOString();
const MOCK_BOOKINGS = [
  { id: "b-today", visitor_name: "モック 太郎", visitor_email: "taro@example.com", topic: "初回相談したい", start_at: iso(0, 14, 0), end_at: iso(0, 14, 30), location_type: "google_meet", meeting_url: "https://meet.google.com/mock-today", manage_url: "/manage-booking.html?id=b-today&t=tok", status: "confirmed", answers: [{ question_text: "ご相談の背景", answer_text: "初回相談したい" }, { question_text: "ご予算感", answer_text: "未定" }] },
  { id: "b-up", visitor_name: "モック 花子", visitor_email: "hana@example.com", topic: "採用の相談", start_at: iso(2, 11, 0), end_at: iso(2, 11, 30), location_type: "zoom", manage_url: "/manage-booking.html?id=b-up&t=tok2", status: "confirmed", answers: [] },
  { id: "b-cancel", visitor_name: "キャンセル 三郎", start_at: iso(0, 16, 0), end_at: iso(0, 16, 30), status: "cancelled", answers: [] },
];
const MOCK = {
  "me": { owner: { id: "o1", name: "テスト オーナー", email: "owner@example.com", plan: "pro" }, calendar_connected: true },
  "owner-bookings": { bookings: MOCK_BOOKINGS },
  "booking-pages": { pages: [{ id: "p1", slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", candidate_days: 0, booking_range_months: 2, is_active: true }], availability: [] },
  "profile": { profile: { profile_name: "テストオーナー", profile_title: "", profile_strengths: "", profile_style: "", profile_offer: "", profile_values: "", profile_goal: "" } },
  "appointment-log": { logs: [{ visitor_email: "taro@example.com", keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} }] },
  // 会話記録（booking_notes）: リストGET(booking_ids)と単体GET(note)の両方をこの1オブジェクトで満たす（route はクエリを除去して同じキーに寄せるため）。
  "booking-note": { booking_ids: ["b-today"], note: { keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} } },
  "pending-answers": { count: 0, items: [] },
};

const DUMMY = ["佐藤 りく", "山田 はな", "高橋 あおい", "田中 さくら", "鈴木 みなと", "佐藤 健", "b/tanaka", "abc-defg-hij", "ENTP", "サウナ / 登山"];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/api/**", (route) => {
  const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
  const body = Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});

async function newPage() {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page._errors = errors;
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page._requests = requests;
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  return page;
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

// ===== 1) 全ページ：JS例外なし＆ダミー文字列なし =====
section("all pages: no JS exception, no dummy strings");
const PAGES = [
  "index", "landing3", "plan", "login", "signup", "reset-password", "square", "pro-thanks",
  "dashboard", "contacts", "booking-settings", "profile", "settings", "schedule", "answers",
  "meeting?id=b-today", "booking?slug=taro", "public-profile?slug=taro", "manage-booking?id=b-today&t=tok",
  "manage-booking?k=b-today.tok", // 新しい1パラメータ形式の管理リンク
  "answer-question?id=b-today&t=tok", "pending-questions", "ai-assist",
  "operator-login", "operators", "cat-key-admin", "privacy", "terms", "tokushoho",
];
for (const route of PAGES) {
  const [name, query] = route.split("?");
  const url = `${base}/${name}.html${query ? "?" + query : ""}`;
  const page = await newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) { /* networkidle timeout は許容 */ }
  await page.waitForTimeout(400);
  const text = await bodyText(page).catch(() => "");
  const hit = DUMMY.find((d) => text.includes(d));
  ok(`${name}: no dummy string` + (hit ? ` (found "${hit}")` : ""), !hit);
  ok(`${name}: no JS exception` + (page._errors.length ? ` (${page._errors[0].slice(0, 80)})` : ""), page._errors.length === 0);
  await page.close();
}

// ===== 2) dashboard 実データ =====
section("dashboard: real data");
{
  const page = await newPage();
  await page.goto(`${base}/dashboard.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#today-list")?.textContent?.includes("モック"), null, { timeout: 8000 }).catch(() => {});
  const today = await page.textContent("#today-list").catch(() => "");
  ok("today-list shows mock today booking", today.includes("モック 太郎"));
  ok("today-list join button present (meeting_url)", (await page.locator("#today-list a.button.primary").count()) >= 1);
  const share = await page.textContent("#share-url").catch(() => "");
  ok("share-url shows real booking page url", /\/b\/taro$/.test(share.trim()));
  ok("share copy button visible", await page.locator("#share-copy").isVisible());
  // #321: プレビューは削除し、「＋ 新しい予約ページ」は見出しの横へ
  ok("no preview button in the share card", (await page.locator("#share-preview").count()) === 0);
  ok("new page button sits next to the heading", (await page.locator('.side-card-head a[href="/booking-settings.html?new=1"]').count()) === 1);
  const week = await page.textContent("#todo-week-count").catch(() => "");
  ok("todo-week-count is numeric", /^\d+$/.test(week.trim()));
  // #321: 今週の予約は件数があるときだけ出す（モックは今日の予約あり）
  ok("this week's row is shown when there are bookings", await page.locator("#todo-week").isVisible());
  ok("empty note is hidden when there is something to do", !(await page.locator("#todo-empty").isVisible()));
  // 「回答待ちの質問」は停止中（#314）。要対応に出さず、APIも叩かない。
  ok("no pending-questions link in todos", (await page.locator('a[href="/pending-questions.html"]').count()) === 0);
  ok("no 回答待ちの質問 row", !(await page.textContent(".todo")).includes("回答待ち"));
  ok("pending-answers API is not called", !page._requests.some((u) => u.includes("/api/pending-answers")));
  await page.close();
}

// ===== 3) schedule 実データ＋週ナビ =====
section("schedule: real grid + nav");
{
  const page = await newPage();
  await page.goto(`${base}/schedule.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#week-grid .week-col").length === 7, null, { timeout: 8000 }).catch(() => {});
  ok("week-grid has 7 columns", (await page.locator("#week-grid .week-col").count()) === 7);
  ok("week-grid shows today's mock booking", (await page.textContent("#week-grid")).includes("モック 太郎"));
  const before = await page.textContent("#weekRange");
  await page.click("#weekNext");
  await page.waitForTimeout(150);
  ok("week nav changes range", (await page.textContent("#weekRange")) !== before);
  await page.close();
}

// ===== 4) answers 実データ＋既読 =====
section("answers: real cards + mark read");
{
  const page = await newPage();
  await page.goto(`${base}/answers.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#ans-list .ans-card").length > 0, null, { timeout: 8000 }).catch(() => {});
  const cards = await page.locator("#ans-list .ans-card").count();
  ok("answer cards rendered from real data", cards >= 1);
  ok("answers show mock guest", (await page.textContent("#ans-list")).includes("モック 太郎"));
  // bookings.topic は実在しない質問なので、回答履歴のどこにも「今回お話したい内容」を出さない（#312）。
  const ansText = await page.textContent("#ans-list");
  ok("no 今回お話したい内容 row anywhere", !ansText.includes("今回お話したい内容"));
  ok("real question label is shown instead", ansText.includes("ご相談の背景"));
  ok("the answer itself is shown once", (ansText.match(/初回相談したい/g) || []).length === 1);
  // topic しか持たない予約（回答レコード無し）は、回答一覧に出さない。
  ok("booking without answer records is not listed", !ansText.includes("モック 花子"));
  const unreadBefore = Number(await page.textContent("#unread-count"));
  await page.locator("#ans-list [data-mark-read]").first().click();
  await page.waitForTimeout(150);
  const unreadAfter = Number(await page.textContent("#unread-count"));
  ok("mark-read decrements unread count", unreadAfter === unreadBefore - 1);
  await page.close();
}

// ===== 5) meeting 実データ＋管理リンク＋既読 =====
section("meeting: real briefing");
{
  const page = await newPage();
  await page.goto(`${base}/meeting.html?id=b-today`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#meeting-survey")?.textContent?.includes("初回相談"), null, { timeout: 8000 }).catch(() => {});
  ok("meeting h1 shows guest name", (await page.textContent("#meeting-h1")).includes("モック 太郎"));
  ok("meeting survey shows real topic", (await page.textContent("#meeting-survey")).includes("初回相談したい"));
  ok("meet url is real", (await page.textContent("#meet-url")).includes("mock-today"));
  const mgrHref = await page.locator("[data-meeting-manage]").first().getAttribute("href");
  ok("manage link has real href", (mgrHref || "").includes("id=b-today"));
  await page.waitForFunction(() => document.querySelector("#meeting-memos")?.textContent?.includes("丁寧な問い合わせ"), null, { timeout: 8000 }).catch(() => {});
  ok("memo shows conversation note (booking_notes)", (await page.textContent("#meeting-memos")).includes("丁寧な問い合わせ"));
  ok("memo add button opens note editor", await (async () => { await page.click("#meeting-note-add"); await page.waitForTimeout(200); const vis = await page.locator("#note-edit-modal").isVisible(); await page.locator("#note-edit-modal [data-note-close]").first().click().catch(() => {}); return vis; })());
  ok("meeting survey has no 今回お話したい内容 row", !(await page.textContent("#meeting-survey")).includes("今回お話したい内容"));
  await page.close();
}

// ===== 5b) 回答レコードが無い面談は「アンケートが未設定です」 =====
section("meeting: no questionnaire message (#312)");
{
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
    const body = name === "owner-bookings"
      ? { bookings: [{ ...MOCK_BOOKINGS[0], topic: "初回相談したい", answers: [] }] }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/meeting.html?id=b-today`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const survey = await page.textContent("#meeting-survey");
  ok("shows アンケートが未設定です", survey.includes("アンケートが未設定です"));
  ok("does not fall back to topic", !survey.includes("初回相談したい"));
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

// ===== 6) 予約ページの編集で設定が消えない（#300） =====
// 保存済みの値が select の選択肢に無いと、代入しても「選択なし」＝空表示になり、
// そのまま保存すると 0 に落ちて設定が消える。選択肢へ足してから選ぶこと。
section("booking-settings: edit keeps out-of-list values (#300)");
{
  const PAGE = {
    id: "p1", slug: "taro", title: "初回相談", description: "",
    duration_minutes: 60, buffer_before_minutes: 15, buffer_after_minutes: 15, // 15分=UIの選択肢に無い旧データ（本番に実在）
    // バッファありのページは予定名が必須（#321）。空だと送信がブラウザ側で止まり、この節の検証に入れない。
    buffer_before_title: "準備", buffer_after_title: "片付け",
    location_type: "google_meet", location_value: "", booking_range_months: 2, candidate_days: 0,
    accept_holidays: true, lead_time_hours: 18, slot_interval_minutes: 30, is_active: true,
    // 保存済み質問には id が付いてくる。保存時にそのまま返さないとサーバ側で
    // 「追加」扱いになり、質問のUUIDが変わって過去の回答との紐付けが切れる（#304）。
    questionnaire_questions: [{ id: "q-1", question_text: "ご予算感", is_required: true, answer_type: "text", options: [], sort_order: 1 }],
    availability: [{ day_of_week: 1, start_time: "10:00:00", end_time: "18:00:00" }],
  };
  const page = await newPage();
  let sent = null;
  await page.route("**/api/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
    if (name === "booking-page-save") { sent = JSON.parse(route.request().postData() || "{}"); }
    const body = name === "booking-pages" ? { pages: [PAGE], availability: [], default_availability: [] }
      : name === "booking-page-save" ? { ok: true, booking_page: PAGE }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-page-action="edit"]', { timeout: 8000 }).catch(() => {});
  await page.click('[data-page-action="edit"]');
  await page.waitForTimeout(300);
  const form = await page.evaluate(() => {
    const f = document.querySelector("#booking-page-form");
    const g = (n) => { const e = f.elements[n]; return { value: e ? e.value : null, idx: e ? e.selectedIndex : null }; };
    return { bufB: g("buffer_before_minutes"), bufA: g("buffer_after_minutes"), interval: g("slot_interval_minutes"), lead: g("lead_time_hours") };
  });
  ok("edit form shows stored buffer 15 (not blank)", form.bufB.value === "15" && form.bufB.idx >= 0);
  ok("edit form shows stored after-buffer 15", form.bufA.value === "15" && form.bufA.idx >= 0);
  ok("edit form shows stored interval 30", form.interval.value === "30");
  ok("edit form shows stored lead time 18", form.lead.value === "18");
  await page.click('#booking-page-form button[type="submit"]');
  await page.waitForTimeout(400);
  ok("saving unchanged keeps buffers (not reset to 0)", sent?.buffer_before_minutes === 15 && sent?.buffer_after_minutes === 15);
  ok("saving unchanged keeps interval", sent?.slot_interval_minutes === 30);
  // #304: 保存済み質問の id を往復させる（サーバ側の「更新」判定に使う）
  ok("existing question keeps its id on save", sent?.questions?.[0]?.id === "q-1");
  ok("existing question keeps its text", sent?.questions?.[0]?.question_text === "ご予算感");
  await page.close();
}

// ===== 7) 質問ゼロの予約ページはアンケート欄を出さない（#312） =====
section("booking page with no questions shows no questionnaire");
{
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
    const body = name === "availability"
      ? { host: { title: "初回相談", duration_minutes: 30, location_type: "google_meet", slug: "taro" }, questions: [], slots: [], axis: { start_min: 600, end_min: 1080 } }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking.html?slug=taro`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok("no questionnaire field is rendered", (await page.locator("#questionnaire-fields .q-field").count()) === 0);
  ok("no default 今回お話したい内容 question", !(await bodyText(page)).includes("今回お話したい内容"));
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

// ===== 8) ゲストの5日グリッド（週表の描画は week-grid.js をホストと共用）=====
section("guest week grid renders slots (shared week-grid.js)");
{
  const day = new Date(Date.now() + 2 * 86400000);
  day.setHours(11, 0, 0, 0);
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const gridSlots = [
    { start: day.toISOString(), end: new Date(day.getTime() + 1800000).toISOString() },
    { start: new Date(day.getTime() + 86400000).toISOString(), end: new Date(day.getTime() + 86400000 + 1800000).toISOString() },
  ];
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
    const body = name === "availability"
      ? { host: { title: "初回相談", duration_minutes: 30, location_type: "google_meet", slug: "taro" }, questions: [], slots: gridSlots, range_start: ymd, days: 5, axis: { start_min: 600, end_min: 1080 }, hasPrev: false, hasNext: true }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking.html?slug=taro`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  ok("week grid shows the open slots", (await page.locator("#wk-grid .wk-slot").count()) === 2);
  await page.locator("#wk-grid .wk-slot").first().click();
  await page.waitForTimeout(200);
  ok("picking a slot marks it selected", (await page.locator("#wk-grid .wk-slot.sel").count()) === 1);
  ok("picking a slot fills the form", (await page.inputValue('#booking-form input[name="start"]')) === gridSlots[0].start);
  // #321: 時間軸は右の1本だけ（左右に置くと日の列が細くなる）
  ok("time axis is shown once, on the right", (await page.locator("#wk-grid .wk-axis").count()) === 1);
  ok("no how-it-works bullets on the guest page (#321)", !(await bodyText(page)).includes("重ならない空き枠だけを表示"));
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

// ===== 8c) #321 デザイン・文言の修正 =====
section("#321 copy and layout fixes");
{
  // --- 予約ページ一覧: ボタンの並びと文言 ---
  {
    const page = await newPage();
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#booking-pages-list .actions", { timeout: 8000 }).catch(() => {});
    const labels = (await page.locator("#booking-pages-list .actions .button").allTextContents()).map((s) => s.trim());
    ok("list buttons start with copy/edit/delete", labels.slice(0, 3).join("|") === "URLをコピー|編集|削除");
    ok("open button names the booking page", labels[labels.length - 1] === "予約ページを開く");
    ok("mobile line break marker exists", (await page.locator("#booking-pages-list .actions .actions-break").count()) === 1);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- 受付停止中の予約ページは 404 へ飛ばす ---
  {
    const page = await newPage();
    await page.route("**/api/**", (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
      const body = name === "availability" ? { paused: true, slots: [], questions: [], host: {} } : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/b/taro`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    ok("paused booking page redirects to 404", new URL(page.url()).pathname === "/404.html");
    ok("404 page explains the page is gone", (await bodyText(page)).includes("ページが見つかりません"));
    await page.close();
  }
  // --- 事前アンケート回答: 10件ごとのページ送り ---
  {
    const page = await newPage();
    const many = Array.from({ length: 23 }, (_, i) => ({
      id: `pg-${i}`, visitor_name: `回答者${i}`, visitor_email: `a${i}@example.com`,
      start_at: iso(-i - 1, 10, 0), end_at: iso(-i - 1, 10, 30), status: "confirmed", location_type: "google_meet",
      answers: [{ question_text: "ご相談の背景", answer_text: `本文${i}` }],
    }));
    await page.route("**/api/**", (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
      const body = name === "owner-bookings" ? { bookings: many }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/answers.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    ok("first page shows 10 answers", (await page.locator("#ans-list .ans-card").count()) === 10);
    ok("pager is visible", await page.locator("#ans-pager").isVisible());
    ok("pager shows 3 pages", (await page.textContent("#ans-pager .pg-status")).includes("3"));
    ok("prev is disabled on the first page", await page.locator('#ans-pager [data-page-step="-1"]').isDisabled());
    await page.click('#ans-pager [data-page-step="1"]');
    await page.waitForTimeout(300);
    ok("second page shows the next 10", (await page.locator("#ans-list .ans-card").count()) === 10);
    ok("second page starts at the 11th answer", (await page.textContent("#ans-list")).includes("回答者10"));
    await page.click('#ans-pager [data-page-step="1"]');
    await page.waitForTimeout(300);
    ok("last page shows the remainder", (await page.locator("#ans-list .ans-card").count()) === 3);
    ok("next is disabled on the last page", await page.locator('#ans-pager [data-page-step="1"]').isDisabled());
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- ダッシュボード「要対応」: 何も無いときは0を並べず、代わりに一文だけ出す ---
  {
    const page = await newPage();
    await page.route("**/api/**", (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 予約ゼロ・プロフィール全項目入力済み＝要対応が1つも無い状態
      const body = name === "owner-bookings" ? { bookings: [] }
        : name === "profile" ? { profile: { profile_name: "a", profile_title: "a", profile_strengths: "a", profile_style: "a", profile_offer: "a", profile_values: "a", profile_goal: "a" } }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/dashboard.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    ok("this week's row is hidden at zero (#321)", !(await page.locator("#todo-week").isVisible()));
    ok("no zero rows are left in the todo card", (await page.locator(".todo a.has:visible").count()) === 0);
    ok("empty note is shown instead", await page.locator("#todo-empty").isVisible());
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- 設定: ログイン情報から連携行を消し、解除は外部連携に一本化 ---
  {
    const page = await newPage();
    await page.goto(`${base}/settings.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    ok("no duplicate Google row in account info", (await page.locator("#calendar-badge").count()) === 0);
    ok("disconnect lives in the integrations panel", (await page.locator("#integrations #calendar-disconnect").count()) === 1);
    // #321: 解約枠の「Squareを開く」は削除（squareup.com のトップに飛ぶだけで解約にたどり着けなかった）
    ok("no dead link to squareup.com", (await page.locator('a[href="https://squareup.com/"]').count()) === 0);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
}

// ===== 9) ピンポイント日程調整（#303） =====
section("pinpoint scheduling link (#303)");
{
  const future = new Date(Date.now() + 5 * 86400000);
  future.setHours(14, 0, 0, 0);
  const SLOTS = [
    { start: future.toISOString(), end: new Date(future.getTime() + 1800000).toISOString() },
    { start: new Date(future.getTime() + 86400000).toISOString(), end: new Date(future.getTime() + 86400000 + 1800000).toISOString() },
  ];
  // --- ゲスト: /p/<token> は候補一覧＋ラジオで出る ---
  {
    const page = await newPage();
    let booked = null;
    await page.route("**/api/**", (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
      if (name === "book") { booked = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, manage_url: "/manage-booking.html?k=x" }) }); }
      const body = name === "pinpoint"
        ? { token: "toke2e", slots: SLOTS, questions: [], host: { slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", name: "テスト オーナー" } }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    // /p/* は booking.html を返す（netlify.toml の rewrite 相当）
    await page.goto(`${base}/p/toke2e`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const radios = await page.locator('input[name="pp-slot"]').count();
    ok("pinpoint shows candidate radios", radios === 2);
    ok("week calendar is hidden", !(await page.locator("#weekcal").isVisible().catch(() => false)));
    // 候補は日付ごとにまとめ、日付は見出しに1回だけ出す（行は時間のみ）。SLOTS は別日の2件。
    ok("candidates are grouped by date", (await page.locator(".pp-daylabel").count()) === 2);
    ok("rows show only the time range", /^\d{2}:\d{2}〜\d{2}:\d{2}$/.test((await page.locator(".pp-item .pp-time").first().textContent()).replace(/\s/g, "")));
    ok("heading says these are the host's candidates", (await page.textContent('[data-i18n="booking.pinpoint.slotsHeading"]')).includes("候補"));
    // ラジオ本体は見た目を .pp-mark に譲って隠してあるので、実ユーザーと同じくラベルを押す。
    await page.locator(".pp-item").first().click();
    await page.waitForTimeout(200);
    ok("selecting a candidate marks the row", (await page.locator(".pp-item.sel").count()) === 1);
    ok("selecting a candidate reveals the form", await page.locator("#booking-form").isVisible());
    ok("selected slot label is filled", (await page.textContent("#selected-slot")).includes("〜"));
    await page.fill('input[name="visitor_name"]', "ピン 太郎");
    await page.fill('input[name="visitor_email"]', "pin@example.com");
    await page.locator("#booking-form").evaluate((f) => f.requestSubmit());
    await page.waitForTimeout(300);
    await page.click("#confirm-book").catch(() => {});
    await page.waitForTimeout(400);
    ok("booking payload carries pinpoint_token", booked?.pinpoint_token === "toke2e");
    ok("booking payload uses the chosen slot", booked?.start === SLOTS[0].start);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- ホスト: 一覧 → 候補選択画面（予約と同じカレンダー）→ リンク発行 ---
  {
    const page = await newPage();
    let created = null;
    // グリッドは range_start から5日分の列に枠を割り振るので、先頭日を候補の初日に合わせる。
    const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    await page.route("**/api/**", (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
      if (name === "pinpoint-create") { created = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, url: "https://kimaru-co.jp/p/tok-new" }) }); }
      // 当面プレミアム限定で配信するので、ホスト側の確認はプレミアムで行う（既定モックは pro）。
      const body = name === "me" ? { ...MOCK.me, owner: { ...MOCK.me.owner, plan: "premium" } }
        : name === "availability" ? { slots: SLOTS, range_start: ymd, days: 5, questions: [], host: {}, hasPrev: false, hasNext: true }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-page-action="pinpoint"]', { timeout: 8000 }).catch(() => {});
    ok("pinpoint button is next to copy button", (await page.locator('[data-page-action="pinpoint"]').count()) === 1);
    await page.click('[data-page-action="pinpoint"]');
    await page.waitForTimeout(500);
    ok("picker screen replaces the list", await page.locator("#pinpoint-view").isVisible() && !(await page.locator("#list-view").isVisible()));
    ok("slots are shown on the week calendar", (await page.locator("#pp-grid .wk-slot").count()) === 2);
    ok("hold is a select, not a checkbox", (await page.locator("#pp-hold").evaluate((el) => el.tagName)) === "SELECT");
    // 枠を押す＝候補に入る／もう一度押す＝外れる
    await page.locator("#pp-grid .wk-slot").first().click();
    await page.waitForTimeout(150);
    ok("clicking a slot marks it as a candidate", (await page.locator("#pp-grid .wk-slot.is-picked").count()) === 1);
    ok("chosen candidate appears as a chip", (await page.locator("#pp-chips .pp-chip").count()) === 1);
    await page.locator("#pp-grid .wk-slot").first().click();
    await page.waitForTimeout(150);
    ok("clicking again removes it", (await page.locator("#pp-grid .wk-slot.is-picked").count()) === 0);
    await page.locator("#pp-grid .wk-slot").first().click();
    await page.selectOption("#pp-hold", "hold");
    await page.click("#pp-create");
    await page.waitForTimeout(400);
    ok("create request carries the chosen slot", created?.slots?.length === 1 && created.slots[0].start === SLOTS[0].start);
    ok("create request carries hold flag", created?.hold_slots === true);
    ok("issued url is shown for copying", (await page.inputValue("#pp-url")).includes("/p/tok-new"));
    await page.click("#pp-back");
    await page.waitForTimeout(200);
    ok("back returns to the list", await page.locator("#list-view").isVisible() && !(await page.locator("#pinpoint-view").isVisible()));
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- プレミアム限定の配信（#303）: pro には導線が出ない ---
  {
    const page = await newPage();
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#booking-pages-list .list-item", { timeout: 8000 }).catch(() => {});
    ok("pro sees the page list", (await page.locator("#booking-pages-list .list-item").count()) === 1);
    ok("pro does not see the pinpoint button", (await page.locator('[data-page-action="pinpoint"]').count()) === 0);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} e2e: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
