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
  { id: "b-today", visitor_name: "モック 太郎", visitor_email: "taro@example.com", topic: "初回相談したい", start_at: iso(0, 14, 0), end_at: iso(0, 14, 30), location_type: "google_meet", meeting_url: "https://meet.google.com/mock-today", manage_url: "/manage-booking.html?id=b-today&t=tok", status: "confirmed", answers: [{ question_text: "ご予算感", answer_text: "未定" }] },
  { id: "b-up", visitor_name: "モック 花子", visitor_email: "hana@example.com", topic: "採用の相談", start_at: iso(2, 11, 0), end_at: iso(2, 11, 30), location_type: "zoom", manage_url: "/manage-booking.html?id=b-up&t=tok2", status: "confirmed", answers: [] },
  { id: "b-cancel", visitor_name: "キャンセル 三郎", start_at: iso(0, 16, 0), end_at: iso(0, 16, 30), status: "cancelled", answers: [] },
];
const MOCK = {
  "me": { owner: { id: "o1", name: "テスト オーナー", email: "owner@example.com", plan: "pro" }, calendar_connected: true },
  "owner-bookings": { bookings: MOCK_BOOKINGS },
  "booking-pages": { pages: [{ id: "p1", slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", candidate_days: 0, booking_range_months: 2, is_active: true }], availability: [] },
  "profile": { profile: { profile_name: "テストオーナー", profile_title: "", profile_strengths: "", profile_style: "", profile_offer: "", profile_values: "", profile_goal: "" } },
  "appointment-log": { logs: [{ visitor_email: "taro@example.com", keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} }] },
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
  const week = await page.textContent("#todo-week-count").catch(() => "");
  ok("todo-week-count is numeric", /^\d+$/.test(week.trim()));
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
  ok("memo shows real appointment-log", (await page.textContent("#meeting-memos")).includes("丁寧な問い合わせ"));
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} e2e: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
