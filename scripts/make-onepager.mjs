// sales/kimaru-onepager.html を A4 1枚の PDF に書き出す（Playwright headless）。
// 使い方: node scripts/make-onepager.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = "file://" + path.join(repo, "sales", "kimaru-onepager.html");
const out = path.join(repo, "sales", "キマル営業資料.pdf");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(src, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});
await browser.close();
console.log("saved", out);
