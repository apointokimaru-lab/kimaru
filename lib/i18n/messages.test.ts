import assert from "node:assert/strict";
import { test } from "node:test";

import { LANGS, NAMESPACES, loaders } from "@/messages";

import { diffAgainstDisk, extract, render } from "../../scripts/i18n/split.mjs";
import { createT, loadDict } from "./messages";

// messages/ は public/i18n.js からの生成物（#414）。次の 3 点を固定する:
//  1) 生成物が旧 i18n.js と 1 キーも違わない（差分ゼロ。忘れずに再生成させる）
//  2) 3 言語でキー集合が同一（旧 scripts/test/unit.mjs の対称性テストの新側）
//  3) 遅延 import の辞書から作った t() が旧と同じ値を返す

test("messages/ は public/i18n.js から再生成した結果と一致する（npm run i18n:split を忘れていない）", () => {
  const diffs = diffAgainstDisk(render(extract()));
  assert.deepEqual(diffs, [], `差分あり。npm run i18n:split で再生成する:\n${diffs.join("\n")}`);
});

test("3 言語で namespace とキーの集合が同一（対称性）", async () => {
  assert.deepEqual([...LANGS], ["ja", "en", "zh-TW"]);
  for (const ns of NAMESPACES) {
    const [ja, en, zh] = await Promise.all([
      loaders.ja[ns](),
      loaders.en[ns](),
      loaders["zh-TW"][ns](),
    ]);
    const keys = (d: Readonly<Record<string, string>>) => Object.keys(d).sort();
    assert.deepEqual(keys(en), keys(ja), `en の "${ns}" が ja とずれている`);
    assert.deepEqual(keys(zh), keys(ja), `zh-TW の "${ns}" が ja とずれている`);
  }
});

test("生成物のキー総数が旧 i18n.js と一致し、namespace に必ずドット区切りの接頭辞がある", async () => {
  const { messages } = extract();
  let total = 0;
  for (const ns of NAMESPACES) total += Object.keys(await loaders.ja[ns]()).length;
  assert.equal(total, Object.keys(messages.ja ?? {}).length);
  for (const key of Object.keys(messages.ja ?? {})) assert.match(key, /^[a-z]+\./i);
});

test("t(): 旧 t() と同じ値を返し、{name} を置換し、空文字は空のまま尊重する", async () => {
  const { messages } = extract();
  const tEn = createT("nf", await loadDict("en", "nf"));
  assert.equal(tEn("heading"), messages.en?.["nf.heading"]);
  const tJa = createT("aq", await loadDict("ja", "aq"));
  assert.equal(
    tJa("metaFrom", { name: "太郎" }),
    (messages.ja?.["aq.metaFrom"] ?? "").replace("{name}", "太郎"),
  );
  // 未知のキー（動的に来た場合）はキー名を返して落ちない
  const tAny = tJa as unknown as (key: string) => string;
  assert.equal(tAny("__no_such_key__"), "aq.__no_such_key__");
});
