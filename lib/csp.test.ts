import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DYNAMIC_ROUTES,
  SECURITY_HEADERS,
  STATIC_CSP,
  dynamicRoutesRegexSource,
  isDynamicPath,
  nonceCsp,
} from "./csp";

// CSP の唯一の出どころ lib/csp.ts が、netlify.toml（CDN 側）と同じ値であること、
// 動的ルート判定と nonce ポリシーが意図どおりであることを固定する（#415・規約 8 章）。

const netlifyToml = fs.readFileSync(path.join(process.cwd(), "netlify.toml"), "utf8");

function tomlHeader(name: string): string {
  const m = netlifyToml.match(new RegExp(`^\\s*${name.replace(/-/g, "\\-")} = "([^"]*)"`, "m"));
  assert.ok(m, `netlify.toml に ${name} が無い`);
  return m[1] ?? "";
}

test("STATIC_CSP と各セキュリティヘッダーは netlify.toml の [[headers]] と同じ値（3 経路で同じにする）", () => {
  assert.equal(STATIC_CSP, tomlHeader("Content-Security-Policy"));
  for (const { key, value } of SECURITY_HEADERS) {
    assert.equal(value, tomlHeader(key), `${key} が netlify.toml とずれている`);
  }
});

test("isDynamicPath: 末尾 / は配下すべて、それ以外は同一パスとその配下", () => {
  assert.ok(DYNAMIC_ROUTES.includes("/dev/"));
  assert.equal(isDynamicPath("/dev/csp"), true);
  assert.equal(isDynamicPath("/dev/"), true);
  assert.equal(isDynamicPath("/dev"), false);
  assert.equal(isDynamicPath("/development"), false);
  // 公開ページと旧 HTML は静的のまま
  for (const p of ["/", "/plan", "/guide", "/dashboard.html", "/b/zoom-review", "/nope"]) {
    assert.equal(isDynamicPath(p), false, p);
  }
});

test("dynamicRoutesRegexSource: next.config の否定先読みに使える形（動的だけに一致）", () => {
  const re = new RegExp(`^/((?!${dynamicRoutesRegexSource()}).*)$`);
  assert.equal(re.test("/dev/csp"), false); // 動的 → 静的 CSP の対象外
  assert.equal(re.test("/"), true);
  assert.equal(re.test("/plan"), true);
  assert.equal(re.test("/development"), true);
});

test("nonceCsp: nonce を含み、script-src に 'unsafe-inline' が無く、開発時だけ 'unsafe-eval'", () => {
  const prod = nonceCsp("abc123");
  assert.match(prod, /script-src 'self' 'nonce-abc123'(;|$)/);
  assert.match(prod, /style-src 'self' 'nonce-abc123'(;|$)/);
  assert.doesNotMatch(prod, /unsafe-inline|unsafe-eval|strict-dynamic/);
  assert.match(prod, /frame-ancestors 'none'/);
  assert.match(prod, /connect-src 'self'/);
  const dev = nonceCsp("abc123", true);
  assert.match(dev, /script-src 'self' 'nonce-abc123' 'unsafe-eval'/);
});
