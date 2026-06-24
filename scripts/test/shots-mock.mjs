// 修正4ページをモック実データで描画してスクショ（目視確認用）。/tmp/kimaru-shots/ に出力。
//   node scripts/test/shots-mock.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = path.join(repo, "public");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
  const file = path.join(pub, p);
  if (!file.startsWith(pub) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" }); res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const now = new Date();
const iso = (off, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h, m).toISOString();
const MOCK = {
  "me": { owner: { id: "o1", name: "テスト オーナー", email: "owner@example.com", plan: "pro" }, calendar_connected: true },
  "owner-bookings": { bookings: [
    { id: "b-today", visitor_name: "モック 太郎", visitor_email: "taro@example.com", topic: "初回相談したい", start_at: iso(0, 14, 0), end_at: iso(0, 14, 30), location_type: "google_meet", meeting_url: "https://meet.google.com/mock-today", manage_url: "/manage-booking.html?id=b-today&t=tok", status: "confirmed", answers: [{ question_text: "ご予算感", answer_text: "未定（まず相談）" }] },
    { id: "b-up", visitor_name: "モック 花子", visitor_email: "hana@example.com", topic: "採用の相談", start_at: iso(2, 11, 0), end_at: iso(2, 11, 30), location_type: "zoom", manage_url: "x", status: "confirmed", answers: [] },
  ] },
  "booking-pages": { pages: [{ id: "p1", slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", candidate_days: 0, booking_range_months: 2, is_active: true }], availability: [] },
  "profile": { profile: { profile_name: "テストオーナー", profile_title: "", profile_strengths: "", profile_style: "", profile_offer: "", profile_values: "", profile_goal: "" } },
  "appointment-log": { logs: [{ visitor_email: "taro@example.com", keywords: "初回", notes: "丁寧な問い合わせ。本気度が高そう。", next_action: "体験の日程を案内する。", scores: {} }] },
  "pending-answers": { count: 0, items: [] },
};

const out = "/tmp/kimaru-shots"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await ctx.route("**/api/**", (route) => {
  const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK[name] ?? {}) });
});
for (const [file, route, wait] of [
  ["dashboard", "dashboard.html", "#today-list .appt"],
  ["schedule", "schedule.html", "#week-grid .week-col"],
  ["answers", "answers.html", "#ans-list .ans-card"],
  ["meeting", "meeting.html?id=b-today", "#meeting-survey div"],
]) {
  const page = await ctx.newPage();
  await page.goto(`${base}/${route}`, { waitUntil: "networkidle" });
  await page.waitForSelector(wait, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const f = `${out}/wired-${file}.png`;
  await page.screenshot({ path: f, fullPage: true });
  console.log("saved", f);
  await page.close();
}
await browser.close();
server.close();
