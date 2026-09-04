#!/usr/bin/env node
// 旧フロントの辞書 public/i18n.js（ja / en / zh-TW を 1 ファイルに持つ・4,900 行）を、
// 新フロント用に「言語別・画面（namespace）別の JSON」と型・レジストリへ機械変換する（#414・規約 6 章）。
//
//   node scripts/i18n/split.mjs           … messages/ を書き出す
//   node scripts/i18n/split.mjs --check   … 書き出し結果が今の messages/ と一致するか（CI・テスト用）
//
// なぜ手で写さないか: 4,900 行を手で分けると必ず欠ける。旧 i18n.js が正本である間（旧ページが残る間）は
// この変換を何度でも流せる形にし、「1 キーも欠けない」ことをテストで固定する（lib/i18n/messages.test.ts）。
// 旧 i18n.js を消す段階（#454）で、生成物 messages/ が正本に切り替わる。
//
// 評価方法は scripts/test/unit.mjs と同じ: 自リポジトリのソースを node:vm で実行して window.KimaruI18n を取り出す
// （外部入力ではない）。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LEGACY_FILE = "public/i18n.js";
export const OUT_DIR = "messages";

/** 旧 i18n.js を評価して { languages: ["ja", ...], messages: { ja: {key: value} ... } } を返す */
export function extract(repoRoot = repo) {
  const src = fs.readFileSync(path.join(repoRoot, LEGACY_FILE), "utf8");
  const ctx = {
    window: {},
    navigator: { language: "ja" },
    console,
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      addEventListener() {},
      readyState: "complete",
      querySelectorAll: () => [],
      dispatchEvent() {},
      documentElement: { lang: "" },
      body: { dataset: {} },
      title: "",
      cookie: "",
    },
    CustomEvent: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const api = ctx.window.KimaruI18n;
  if (!api || !api.messages) throw new Error(`${LEGACY_FILE}: window.KimaruI18n.messages が取れない`);
  const languages = api.supportedLanguages.map((l) => l.code);
  return { languages, messages: api.messages };
}

/** "dash.todo.title" → ["dash", "todo.title"]。先頭の 1 語が namespace（= JSON ファイル名） */
export function splitKey(key) {
  const i = key.indexOf(".");
  if (i <= 0) throw new Error(`namespace の無いキー: ${JSON.stringify(key)}`);
  return [key.slice(0, i), key.slice(i + 1)];
}

/** { key: value } → { ns: { rest: value } }（namespace・キーとも辞書順） */
export function byNamespace(dict) {
  const out = {};
  for (const key of Object.keys(dict)) {
    const [ns, rest] = splitKey(key);
    (out[ns] ??= {})[rest] = dict[key];
  }
  const sorted = {};
  for (const ns of Object.keys(out).sort()) {
    sorted[ns] = Object.fromEntries(Object.entries(out[ns]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return sorted;
}

const HEADER = "// 自動生成（scripts/i18n/split.mjs・正本は public/i18n.js）。手で編集しない。`npm run i18n:split` で再生成。\n";

/** 書き出すファイル一覧を Map<相対パス, 内容> で返す（ディスクに触らない。--check とテストで比較に使う） */
export function render({ languages, messages }) {
  const files = new Map();
  const perLang = Object.fromEntries(languages.map((lang) => [lang, byNamespace(messages[lang] ?? {})]));
  // namespace の一覧は ja を正とする（対称性は lib/i18n/messages.test.ts が別に固定する）
  const namespaces = Object.keys(perLang.ja ?? {});

  for (const lang of languages) {
    for (const ns of Object.keys(perLang[lang])) {
      files.set(`${OUT_DIR}/${lang}/${ns}.json`, JSON.stringify(perLang[lang][ns], null, 2) + "\n");
    }
  }

  // 型: キーの union（ja 基準）。存在しないキーをコンパイルで止めるため
  const keysTs = [
    HEADER,
    "export type MessageKeys = {",
    ...namespaces.map(
      (ns) =>
        `  ${JSON.stringify(ns)}: ${
          Object.keys(perLang.ja[ns])
            .map((k) => JSON.stringify(k))
            .join(" | ") || "never"
        };`,
    ),
    "};",
    "",
  ].join("\n");
  files.set(`${OUT_DIR}/keys.ts`, keysTs);

  // レジストリ: 言語×namespace の遅延 import。画面ごとに必要な辞書だけを読む（旧 i18n.js は 3 言語 338KB を全ページで読んでいた）
  const indexTs = [
    HEADER,
    `export const LANGS = ${JSON.stringify(languages)} as const;`,
    `export const NAMESPACES = ${JSON.stringify(namespaces)} as const;`,
    "export type Lang = (typeof LANGS)[number];",
    "export type Namespace = (typeof NAMESPACES)[number];",
    "export type Dict = Readonly<Record<string, string>>;",
    "",
    "export const loaders: Readonly<Record<Lang, Readonly<Record<Namespace, () => Promise<Dict>>>>> = {",
    ...languages.map((lang) => [
      `  ${JSON.stringify(lang)}: {`,
      ...namespaces.map(
        (ns) =>
          `    ${JSON.stringify(ns)}: () => import(${JSON.stringify(`./${lang}/${ns}.json`)}).then((m) => m.default as Dict),`,
      ),
      "  },",
    ]).flat(),
    "};",
    "",
  ].join("\n");
  files.set(`${OUT_DIR}/index.ts`, indexTs);

  return files;
}

/** 今ディスクにある生成物と比べて差分（パスの配列）を返す。空なら最新 */
export function diffAgainstDisk(files, repoRoot = repo) {
  const diffs = [];
  for (const [rel, content] of files) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || fs.readFileSync(abs, "utf8") !== content) diffs.push(rel);
  }
  // 消えた namespace の残骸（生成対象に無いファイル）も差分扱い
  const outAbs = path.join(repoRoot, OUT_DIR);
  if (fs.existsSync(outAbs)) {
    for (const entry of walk(outAbs)) {
      const rel = path.relative(repoRoot, entry).split(path.sep).join("/");
      if (!files.has(rel) && !rel.endsWith(".test.ts")) diffs.push(`${rel}（生成対象に無い）`);
    }
  }
  return diffs;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function writeAll(files, repoRoot = repo) {
  // 古い namespace のファイルが残らないよう、生成対象のディレクトリを作り直す
  const outAbs = path.join(repoRoot, OUT_DIR);
  fs.rmSync(outAbs, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const abs = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = extract();
  const files = render(data);
  const keyCount = Object.fromEntries(data.languages.map((l) => [l, Object.keys(data.messages[l] ?? {}).length]));
  if (process.argv.includes("--check")) {
    const diffs = diffAgainstDisk(files);
    if (diffs.length) {
      console.error(`✗ messages/ が public/i18n.js と一致しない（${diffs.length} 件）。npm run i18n:split で再生成:`);
      for (const d of diffs) console.error("  - " + d);
      process.exit(1);
    }
    console.log(`✓ messages/ は最新（${files.size} ファイル・キー数 ${JSON.stringify(keyCount)}）`);
  } else {
    writeAll(files);
    console.log(`✓ ${files.size} ファイルを ${OUT_DIR}/ に書き出した。キー数 ${JSON.stringify(keyCount)}`);
  }
}
