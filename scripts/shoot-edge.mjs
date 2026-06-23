// 端末(edge function)のヘッダー/フッター注入を再現して撮影するツール。
// shoot-batch.mjs は静的配信のみで edge を実行しないため、注入される <header>/<footer> が出ない。
// このツールは netlify/edge-functions/auth-gate.js から SITE_HEADER / SITE_FOOTER 定数を取り出し、
// <!-- site-header --> / <!-- site-footer --> を置換し、<body> に data-auth を付けてから撮影する。
//
// 使い方:
//   node scripts/shoot-edge.mjs <pages> [langs] [viewports] [auth]
//   <pages>     カンマ区切り（省略時は全 public/*.html）
//   [langs]     既定 "ja"
//   [viewports] desktop|mobile|both（既定 both）
//   [auth]      authed|guest（既定 authed。app-only/guest-only の出し分け確認用）
// 出力: /tmp/kimaru-shots/<page>-edge-<auth>-{desktop,mobile}-<lang>.png
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
const auth = (argv[3] || "authed").toLowerCase() === "guest" ? "guest" : "authed";

// auth-gate.js から template-literal 定数を取り出す
const edgeSrc = fs.readFileSync(path.join(repo, "netlify/edge-functions/auth-gate.js"), "utf8");
function extractConst(name) {
  // const NAME = `....`;  （バッククォート間。${} は含まれない前提）
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*`([\\s\\S]*?)`", "m");
  const m = edgeSrc.match(re);
  return m ? m[1] : "";
}
const SITE_HEADER = extractConst("SITE_HEADER");
const SITE_FOOTER = extractConst("SITE_FOOTER");
if (!SITE_HEADER) console.warn("WARN: SITE_HEADER not found in auth-gate.js (header will not be injected)");

function injectEdge(html) {
  let out = html.replace(/<body(?=[\s>])/i, `<body data-auth="${auth}"`);
  if (out.includes("<!-- site-header -->")) out = out.replace("<!-- site-header -->", SITE_HEADER);
  if (out.includes("<!-- site-footer -->")) out = out.replace("<!-- site-footer -->", SITE_FOOTER);
  return out;
}

const publicRoot = path.join(repo, "public");
function resolveFile(urlPath) {
  const file = path.join(publicRoot, urlPath);
  if (file.startsWith(publicRoot) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return null;
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = resolveFile(urlPath);
  if (!file) { res.writeHead(404); return res.end("not found"); }
  let body = fs.readFileSync(file);
  const ext = path.extname(file);
  if (ext === ".html") body = Buffer.from(injectEdge(body.toString("utf8")));
  res.writeHead(200, { "content-type": MIME[ext] || "text/plain" });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const pages = (pagesArg && pagesArg !== "all")
  ? pagesArg.split(",").map((s) => s.trim().replace(/\.html$/, "")).filter(Boolean)
  : fs.readdirSync(publicRoot).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")).sort();
const viewports = vpArg === "desktop" ? [["desktop", { width: 1280, height: 900 }]]
  : vpArg === "mobile" ? [["mobile", { width: 390, height: 844 }]]
  : [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]];

const outDir = "/tmp/kimaru-shots";
fs.mkdirSync(outDir, { recursive: true });
const ignore = (s) => /\/api\//.test(s) || /favicon/.test(s) || /Failed to load resource/.test(s);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const problems = [];
let n = 0;
for (const [vpName, viewport] of viewports) {
  for (const lang of langs) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.addInitScript((l) => { try { localStorage.setItem("kimaru.lang", l); localStorage.setItem("lang", l); localStorage.setItem("kimaru.language", l); } catch (e) {} }, lang);
    for (const pg of pages) {
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push("JS:" + e.message));
      page.on("console", (m) => { if (m.type() === "error" && !ignore(m.text())) errs.push("console:" + m.text()); });
      page.on("response", (r) => { const s = r.status(); const u = r.url(); if (s >= 400 && !ignore(u)) errs.push(`http${s}:` + u.replace(/^http:\/\/localhost:\d+/, "")); });
      try { await page.goto(`http://localhost:${port}/${pg}.html`, { waitUntil: "networkidle", timeout: 15000 }); }
      catch (e) { errs.push("nav:" + e.message); }
      await page.waitForTimeout(700);
      const out = `${outDir}/${pg}-edge-${auth}-${vpName}-${lang}.png`;
      try { await page.screenshot({ path: out, fullPage: true }); n++; } catch (e) { errs.push("shot:" + e.message); }
      if (errs.length) problems.push(`${pg} [${vpName}/${lang}/${auth}]: ${errs.slice(0, 6).join(" | ")}`);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(`\n=== shot ${n} edge screenshots (auth=${auth}) → ${outDir} ===`);
if (problems.length) { console.log(`=== ${problems.length} with errors ===`); for (const p of problems) console.log(" •", p); }
else console.log("no JS/console errors (excluding /api).");
