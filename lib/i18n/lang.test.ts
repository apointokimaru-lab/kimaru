import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LANG, LANG_COOKIE, langCookieString, normalizeLang, resolveLang } from "./lang";

// 旧 public/i18n.js の normalizeLanguage と同じ規則であることを固定する（#414）

test("normalizeLang: 完全一致（大文字小文字を無視）", () => {
  assert.equal(normalizeLang("ja"), "ja");
  assert.equal(normalizeLang("JA"), "ja");
  assert.equal(normalizeLang("zh-tw"), "zh-TW");
  assert.equal(normalizeLang(" en "), "en");
});

test("normalizeLang: zh で始まるものはすべて zh-TW（旧の割り切り）", () => {
  assert.equal(normalizeLang("zh"), "zh-TW");
  assert.equal(normalizeLang("zh-CN"), "zh-TW");
  assert.equal(normalizeLang("zh-Hant-TW"), "zh-TW");
});

test("normalizeLang: 基底言語で一致（en-US → en）", () => {
  assert.equal(normalizeLang("en-US"), "en");
  assert.equal(normalizeLang("ja-JP"), "ja");
});

test("normalizeLang: 対応しない・空・非文字列は null", () => {
  assert.equal(normalizeLang("fr"), null);
  assert.equal(normalizeLang(""), null);
  assert.equal(normalizeLang(undefined), null);
  assert.equal(normalizeLang(null), null);
  assert.equal(normalizeLang(42), null);
});

test("resolveLang: Cookie が無効・未設定なら既定の ja（ブラウザ言語では切り替えない＝旧と同じ）", () => {
  assert.equal(resolveLang(undefined), DEFAULT_LANG);
  assert.equal(resolveLang("xx"), "ja");
  assert.equal(resolveLang("en"), "en");
  assert.equal(resolveLang("zh-CN"), "zh-TW");
});

test("langCookieString: 名前・Path・有効期限・SameSite、https のときだけ Secure", () => {
  const plain = langCookieString("en", false);
  assert.match(plain, new RegExp(`^${LANG_COOKIE}=en; Path=/; Max-Age=\\d+; SameSite=Lax$`));
  assert.match(langCookieString("zh-TW", true), /; Secure$/);
  assert.match(langCookieString("zh-TW", true), /kimaru_lang=zh-TW;/);
});
