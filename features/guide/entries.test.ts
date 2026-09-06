import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import en from "@/messages/en/guide.json";
import ja from "@/messages/ja/guide.json";
import zhTW from "@/messages/zh-TW/guide.json";

import { CHROME_KEYS, ENTRIES, GROUPS, requiredKeys, resolvePages } from "./entries";

// 使い方ガイドの項目 ↔ 文言キーの対応（#353 の scripts/test/unit.mjs から #423 で移した）。
// ENTRIES は「1 項目＝1 つの説明」を部品の件数（steps / points / fields / note）で持ち、文言だけ辞書にある。
// 必要なキーはその件数から機械的に決まるので、対応をここで固定する。
// ずれると、ガイドにキー文字列（guide.zoom.p1.step3 など）がそのまま出る。

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const DICTS: Record<string, Record<string, string>> = { ja, en, "zh-TW": zhTW };

test("すべての項目の文言が 3 言語ぶんそろっている", () => {
  for (const entry of ENTRIES) {
    const keys = requiredKeys(entry);
    for (const [lang, dict] of Object.entries(DICTS)) {
      const missing = keys.filter((key) => !dict[key]);
      assert.deepEqual(missing, [], `${lang}: guide.${entry.key} の文言が足りない`);
    }
  }
});

test("どのページにも本文の部品がある（見出しと要約だけの空の説明を作らない）", () => {
  for (const entry of ENTRIES) {
    for (const page of resolvePages(entry)) {
      assert.ok(
        page.steps || page.points || page.fields,
        `guide.${page.prefix}: 部品（steps/points/fields）が 1 つも無い`,
      );
    }
  }
});

test("項目のキーは重複しない（URL の #<key> で 1 つに定まる）", () => {
  const keys = ENTRIES.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("「該当画面を開く」の行き先は実在する自サイトのページ", () => {
  for (const entry of ENTRIES) {
    if (!entry.href) continue;
    assert.ok(pageExists(entry.href), `guide.${entry.key}: ${entry.href} が無い`);
  }
});

test("すべての項目がいずれかの章に属し、章の文言が 3 言語ぶんある", () => {
  for (const entry of ENTRIES) {
    assert.ok(
      GROUPS.includes(entry.group),
      `guide.${entry.key}: 一覧に無い章（${entry.group}）に属している`,
    );
  }
  for (const group of GROUPS) {
    assert.ok(
      ENTRIES.some((entry) => entry.group === group),
      `guide.group.${group}: 項目が 1 つも無い章は一覧に出ない`,
    );
    for (const [lang, dict] of Object.entries(DICTS)) {
      assert.ok(dict[`group.${group}`], `${lang}: guide.group.${group} が無い`);
      assert.ok(dict[`group.${group}.desc`], `${lang}: guide.group.${group}.desc が無い`);
    }
  }
});

test("項目に依らない文言（一覧の見出し・Modal の操作）が 3 言語ぶんある", () => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const missing = CHROME_KEYS.filter((key) => !dict[key]);
    assert.deepEqual(missing, [], `${lang}: 共通の文言が足りない`);
  }
});

/**
 * 行き先が実在するか。旧ページは public/<x>.html、Next に移した画面は app/**\/<route>/page.tsx で見る
 * （外部 URL や打ち間違いを弾く。移行が進むたびに ENTRIES の href を直し忘れないため）
 */
function pageExists(href: string): boolean {
  const clean = href.replace(/[?#].*$/, "");
  if (clean.endsWith(".html")) return existsSync(path.join(REPO, "public", clean.slice(1)));
  const route = clean.replace(/^\//, "").replace(/\/$/, "");
  const walk = (dir: string): boolean =>
    readdirSync(dir, { withFileTypes: true }).some((item) => {
      const full = path.join(dir, item.name).replace(/\\/g, "/");
      if (item.isDirectory()) return walk(full);
      // ルート直下（route === ""）はルートグループ配下の page.tsx（app/(public)/page.tsx）
      return (
        item.name === "page.tsx" &&
        (route === ""
          ? /\/app\/\([a-z]+\)\/page\.tsx$/.test(full)
          : full.endsWith(`/${route}/page.tsx`))
      );
    });
  return walk(path.join(REPO, "app"));
}
