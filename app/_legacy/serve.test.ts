import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlResponse, legacyHtml } from "./serve";

// 新側の単体テストの型（規約 9 章）: 対象の隣に *.test.ts、node:test、実行は `tsx --test`。
// serve.ts は段階1 で消えるが、それまで「旧 HTML を正しく返す」ことを CI で固定しておく。

test("htmlResponse は text/html と指定したステータスを返す", async () => {
  const res = htmlResponse("<p>x</p>", 404);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await res.text(), "<p>x</p>");
});

test("htmlResponse の既定ステータスは 200", () => {
  assert.equal(htmlResponse("").status, 200);
});

test("legacyHtml は public/ の旧 HTML をそのまま読む（404.html の目印が残っている）", async () => {
  const html = await legacyHtml("404.html");
  assert.match(html, /data-page="not-found"/);
  assert.match(html, /<!doctype html>/i);
});

test("legacyHtml は同じファイルを 2 回読まない（Promise をキャッシュする）", async () => {
  const a = legacyHtml("404.html");
  const b = legacyHtml("404.html");
  assert.equal(a, b);
  assert.match(await a, /ページが見つかりません/);
});
