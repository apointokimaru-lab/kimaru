// バッチ版スクリーンショット: 1つのサーバ＋1つのブラウザを使い回して
// 複数ページ × 複数言語 × desktop/mobile を一括撮影し、JSエラーも収集する。
// 実装→チェック→修正ループ用（shoot.mjs はページ毎に chromium を起動するため遅い）。
//
// 使い方:
//   node scripts/shoot-batch.mjs <pages> [langs] [viewports] [plan]
//   <pages>     カンマ区切り。例) "dashboard,contacts,booking" / 省略時は全 public/*.html
//   [langs]     カンマ区切り。既定 "ja"。例) "ja,en,zh-TW"
//   [viewports] "desktop" | "mobile" | "both"（既定 both）
//   [plan]      free|pro|premium（任意。?plan= を付ける）
// 出力: /tmp/kimaru-shots/<page>[-plan]-{desktop,mobile}-<lang>.png
// 末尾に各ページの console error / pageerror を要約表示（/api 失敗は静的サーバ由来として除外）。
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

const argv = process.argv.slice(2);
const pagesArg = argv[0];
const langs = (argv[1] || "ja").split(",").map((s) => s.trim()).filter(Boolean);
const vpArg = (argv[2] || "both").toLowerCase();
const plan = argv[3] || "";

const roots = [path.join(repo, "public")];

function resolveFile(urlPath) {
  for (const root of roots) {
    const file = path.join(root, urlPath);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

const pages = (pagesArg && pagesArg !== "all")
  ? pagesArg.split(",").map((s) => s.trim().replace(/\.html$/, "")).filter(Boolean)
  : fs.readdirSync(path.join(repo, "public")).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")).sort();

const viewports = vpArg === "desktop" ? [["desktop", { width: 1280, height: 900 }]]
  : vpArg === "mobile" ? [["mobile", { width: 390, height: 844 }]]
  : [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]];

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = resolveFile(urlPath);
  if (!file) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const outDir = "/tmp/kimaru-shots";
fs.mkdirSync(outDir, { recursive: true });
const suffix = plan ? `-${plan}` : "";

// /api や favicon の失敗はスタティックサーバ由来なので無視する。
// 汎用文言 "Failed to load resource" は response ハンドラが URL 付きで拾うので console 側では落とす。
const ignore = (s) => /\/api\//.test(s) || /favicon/.test(s) || /Failed to load resource/.test(s);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const problems = [];
let shotCount = 0;
for (const [vpName, viewport] of viewports) {
  for (const lang of langs) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.addInitScript((l) => { try { localStorage.setItem("kimaru.lang", l); localStorage.setItem("lang", l); } catch (e) {} }, lang);
    for (const pg of pages) {
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push("JS:" + e.message));
      page.on("console", (m) => { if (m.type() === "error" && !ignore(m.text())) errs.push("console:" + m.text()); });
      page.on("response", (r) => { const s = r.status(); const u = r.url(); if (s >= 400 && !ignore(u)) errs.push(`http${s}:` + u.replace(/^http:\/\/localhost:\d+/, "")); });
      const url = `http://localhost:${port}/${pg}.html` + (plan ? `?plan=${plan}` : "");
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      } catch (e) { errs.push("nav:" + e.message); }
      await page.waitForTimeout(700);
      const out = `${outDir}/${pg}${suffix}-${vpName}-${lang}.png`;
      try { await page.screenshot({ path: out, fullPage: true }); shotCount++; }
      catch (e) { errs.push("shot:" + e.message); }
      if (errs.length) problems.push(`${pg} [${vpName}/${lang}]: ${errs.slice(0, 6).join(" | ")}`);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
server.close();

console.log(`\n=== shot ${shotCount} screenshots → ${outDir} (${pages.length} pages × ${langs.length} langs × ${viewports.length} vp) ===`);
if (problems.length) {
  console.log(`\n=== ${problems.length} page(s) with JS/console errors ===`);
  for (const p of problems) console.log(" •", p);
} else {
  console.log("no JS/console errors detected (excluding /api).");
}
