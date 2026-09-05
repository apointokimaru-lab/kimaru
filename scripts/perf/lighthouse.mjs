#!/usr/bin/env node
// Lighthouse でページの速度を測り、Markdown の表と要約 JSON を出す（#417・規約 9 章）。
//
//   node scripts/perf/lighthouse.mjs --base https://kimaru-co.jp [--runs 3] [--cookie "kimaru_session=…"]
//                                    [--only /,/b/zoom-review] [--out <保存先ディレクトリ>]
//   node scripts/perf/lighthouse.mjs --from-dir <保存先ディレクトリ>   … 保存済みの結果から表だけ作り直す
//
// なぜ: フロント刷新（#406〜#411）の効果を「着手前の本番」と比べて数字で示すため。段階0 でベースラインを取り
// （docs/perf/2026-09-baseline.md）、段階5（#454）で同じ条件で測り直して並べる。
// どう測るか: 同じ URL を N 回（既定 3 回）測り、Performance スコアの中央値の回を採用する（Lighthouse は
// 1 回ごとに揺れるため）。モバイルは Lighthouse 既定のエミュレーション（Moto G Power 相当・4G 相当の絞り）、
// デスクトップは lighthouse:default の desktop プリセット。Chrome は Playwright が入れたものを使う。
// 数値は測る PC に依存する（特にモバイルの TBT）。同じ PC・同じ条件で比べること。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 計測する画面。ゲストが最初に触る順。/dashboard.html はログイン Cookie があるときだけ */
export const PAGES = [
  { path: "/", name: "トップ（LP）" },
  { path: "/b/zoom-review", name: "予約ページ /b/{slug}" },
  { path: "/plan.html", name: "料金・プラン" },
  { path: "/guide.html", name: "使い方ガイド" },
  { path: "/dashboard.html", name: "ダッシュボード（要ログイン）", needsCookie: true },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), ".cache", "ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  // chromium-NNNN/chrome-linux64/chrome（Lighthouse は headless shell では動かない。フルの Chrome が要る）
  const dirs = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const dir of dirs) {
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = path.join(root, dir, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

/** Lighthouse の結果（lhr）から、表に使う値だけを取り出す */
export function metrics(lhr) {
  const a = lhr.audits;
  const num = (id) => a[id]?.numericValue ?? null;
  // 種類別のサイズは network-requests（performance カテゴリに必ず含まれる）の resourceSize（圧縮前の実サイズ）を合算する。
  // transferSize は使わない: 同じ Chrome で続けて測ると max-age=0 の資産が再検証（304 相当）になり、ヘッダー分の
  // 数十バイトしか計上されず「JS 0 KB」に見える。実サイズなら解析コストの比較にもなる。総転送量は total-byte-weight
  const items = a["network-requests"]?.details?.items ?? [];
  const byType = (t) =>
    items.filter((i) => i.resourceType === t).reduce((sum, i) => sum + (i.resourceSize ?? 0), 0);
  return {
    score: Math.round((lhr.categories.performance?.score ?? 0) * 100),
    fcpMs: num("first-contentful-paint"),
    lcpMs: num("largest-contentful-paint"),
    tbtMs: num("total-blocking-time"),
    cls: num("cumulative-layout-shift"),
    speedIndexMs: num("speed-index"),
    ttfbMs: num("server-response-time"),
    totalBytes: num("total-byte-weight"),
    scriptBytes: byType("Script"),
    stylesheetBytes: byType("Stylesheet"),
    fontBytes: byType("Font"),
    imageBytes: byType("Image"),
    requests: items.length,
  };
}

async function measure(url, formFactor, chrome, cookie) {
  const settings = {
    output: "json",
    onlyCategories: ["performance"],
    port: chrome.port,
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
  };
  const config = formFactor === "desktop" ? desktopConfig : undefined;
  const result = await lighthouse(url, settings, config);
  return result.lhr;
}

function median(runs) {
  const sorted = [...runs].sort((x, y) => x.m.score - y.m.score);
  return sorted[Math.floor(sorted.length / 2)];
}

const fmtMs = (v) => (v == null ? "-" : `${(v / 1000).toFixed(2)}s`);
const fmtKb = (v) => (v == null ? "-" : `${Math.round(v / 1024)} KB`);

export function tableFromRows(rows) {
  const header =
    "| 画面 | 端末 | Score | FCP | LCP | TBT | CLS | SI | TTFB | 総転送量 | JS 実サイズ | CSS 実サイズ | フォント実サイズ | 画像実サイズ | 要求数 |\n" +
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const lines = rows.map(
    (r) =>
      `| ${r.page} \`${r.path}\` | ${r.formFactor} | **${r.score}**${r.scores ? `（${r.scores.join("/")}）` : ""} | ` +
      `${fmtMs(r.fcpMs)} | ${fmtMs(r.lcpMs)} | ${Math.round(r.tbtMs ?? 0)}ms | ${(r.cls ?? 0).toFixed(3)} | ` +
      `${fmtMs(r.speedIndexMs)} | ${Math.round(r.ttfbMs ?? 0)}ms | ${fmtKb(r.totalBytes)} | ${fmtKb(r.scriptBytes)} | ` +
      `${fmtKb(r.stylesheetBytes)} | ${fmtKb(r.fontBytes)} | ${fmtKb(r.imageBytes)} | ${r.requests} |`,
  );
  return [header, ...lines].join("\n");
}

/** 保存済みの LHR（--out で書いた *.mobile.json / *.desktop.json）から表の行を作り直す。再計測せずに列を直すため */
export function rowsFromDir(dir) {
  const abs = path.resolve(repo, dir);
  const rows = [];
  const files = fs
    .readdirSync(abs)
    .filter((f) => /\.(mobile|desktop)\.json$/.test(f))
    .sort();
  for (const f of files) {
    const lhr = JSON.parse(fs.readFileSync(path.join(abs, f), "utf8"));
    const p = new URL(lhr.finalDisplayedUrl ?? lhr.requestedUrl).pathname;
    const page = PAGES.find((x) => x.path === p);
    const scores = JSON.parse(fs.readFileSync(path.join(abs, "summary.json"), "utf8")).rows.find(
      (r) => r.path === p && r.formFactor === (f.endsWith(".mobile.json") ? "mobile" : "desktop"),
    )?.scores;
    rows.push({
      page: page?.name ?? p,
      path: p,
      formFactor: f.endsWith(".mobile.json") ? "mobile" : "desktop",
      ...metrics(lhr),
      scores,
    });
  }
  // PAGES の順（画面ごとに mobile → desktop）
  const order = (r) => PAGES.findIndex((x) => x.path === r.path) * 2 + (r.formFactor === "mobile" ? 0 : 1);
  return rows.sort((a, b) => order(a) - order(b));
}

async function main() {
  const fromDir = arg("from-dir", "");
  if (fromDir) {
    console.log(tableFromRows(rowsFromDir(fromDir)));
    return;
  }

  const BASE = arg("base", "https://kimaru-co.jp").replace(/\/$/, "");
  const RUNS = Number(arg("runs", "3"));
  const COOKIE = arg("cookie", "");
  const ONLY = arg("only", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const OUT = arg("out", "");

  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome が見つからない。npx playwright install chromium か CHROME_PATH=…");
  // Chrome のプロファイル置き場を明示する。WSL では Windows の環境変数 LOCALAPPDATA（C:\Users\…）が見えるため、
  // chrome-launcher の既定に任せると、その文字列をディレクトリ名にした一時フォルダがカレント直下に作られる
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimaru-lighthouse-"));
  const chrome = await launch({
    chromePath,
    userDataDir,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });
  const pages = PAGES.filter((p) => (!ONLY.length || ONLY.includes(p.path)) && (!p.needsCookie || COOKIE));
  const rows = [];
  try {
    for (const page of pages) {
      for (const formFactor of ["mobile", "desktop"]) {
        const runs = [];
        for (let i = 0; i < RUNS; i++) {
          const lhr = await measure(BASE + page.path, formFactor, chrome, COOKIE);
          runs.push({ lhr, m: metrics(lhr) });
          process.stderr.write(
            `  ${formFactor.padEnd(7)} ${page.path.padEnd(18)} run ${i + 1}/${RUNS}: score ${runs[i].m.score}\n`,
          );
        }
        const picked = median(runs);
        rows.push({ page: page.name, path: page.path, formFactor, ...picked.m, scores: runs.map((r) => r.m.score) });
        if (OUT) {
          fs.mkdirSync(path.join(repo, OUT), { recursive: true });
          const stem = page.path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
          fs.writeFileSync(path.join(repo, OUT, `${stem}.${formFactor}.json`), JSON.stringify(picked.lhr, null, 1));
        }
      }
    }
  } finally {
    await chrome.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const md = tableFromRows(rows);
  console.log(md);
  if (OUT) {
    fs.writeFileSync(
      path.join(repo, OUT, "summary.json"),
      JSON.stringify({ base: BASE, runs: RUNS, measuredAt: new Date().toISOString(), rows }, null, 2),
    );
    fs.writeFileSync(path.join(repo, OUT, "summary.md"), md + "\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
