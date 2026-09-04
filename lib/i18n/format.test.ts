import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMessage } from "./format";

test("formatMessage: {name} を置き換える（旧辞書の記法）", () => {
  assert.equal(formatMessage("{name} さんからの質問", { name: "太郎" }), "太郎 さんからの質問");
});

test("formatMessage: 複数・同じ名前の繰り返し・数値", () => {
  assert.equal(formatMessage("{page} / {pages} ページ", { page: 2, pages: 10 }), "2 / 10 ページ");
  assert.equal(formatMessage("{n}〜{n}", { n: 3 }), "3〜3");
});

test("formatMessage: 渡していない名前はそのまま残す（旧の replace と同じ）", () => {
  assert.equal(formatMessage("{name} と {loc}", { name: "A" }), "A と {loc}");
});

test("formatMessage: vars 無しなら文字列をそのまま返す", () => {
  assert.equal(formatMessage("{name} さん"), "{name} さん");
});
