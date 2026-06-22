// 静的に public/（または mock/）を配信して Playwright でスクリーンショットを撮る開発用ツール。
// 使い方:
//   node scripts/shoot.mjs <page> [lang]          → public/ を撮る   例) index ja
//   node scripts/shoot.mjs mock <page> [lang]     → mock/ を撮る（資産は public/ にフォールバック） 例) mock index ja
// 出力: /tmp/kimaru-shots/<page>[-mock]-{desktop,mobile}-<lang>.png
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

const args = process.argv.slice(2);
const isMock = args[0] === "mock";
if (isMock) args.shift();
const pageName = args[0] || "index";
const lang = args[1] || "ja";
const plan = isMock ? (args[2] || "") : ""; // mock: free|pro|premium → ?plan=

// mock 時は mock/ を優先し、無いファイル（styles.css 等の資産）は public/ にフォールバック。
const roots = isMock ? [path.join(repo, "mock"), path.join(repo, "public")] : [path.join(repo, "public")];

function resolveFile(urlPath) {
  for (const root of roots) {
    const file = path.join(root, urlPath);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

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
const url = `http://localhost:${port}/${pageName}.html` + (plan ? `?plan=${plan}` : "");

const outDir = "/tmp/kimaru-shots";
fs.mkdirSync(outDir, { recursive: true });
const suffix = (isMock ? "-mock" : "") + (plan ? `-${plan}` : "");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((l) => { try { localStorage.setItem("kimaru.lang", l); localStorage.setItem("lang", l); } catch (e) {} }, lang);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900); // fonts + i18n 反映待ち
  const out = `${outDir}/${pageName}${suffix}-${name}-${lang}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log("saved", out);
  await ctx.close();
}
await browser.close();
server.close();
