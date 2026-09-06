import { expect, test } from "@playwright/test";

import enTerms from "../../messages/en/terms.json";
import jaTerms from "../../messages/ja/terms.json";

// 利用規約 /terms（#420）。旧 public/terms.html と同じ文言・構造・導線を固定する。
// 本文は法務レビュー済みなので、更新日・条の数・価格の記載・MCP 条項の見出しをそのまま確かめる。

test.describe("利用規約 /terms（#420）", () => {
  test("文言・構造・導線が旧と同じで、JS 例外が無い", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    const res = await page.goto("/terms");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(jaTerms.title);
    await expect(page.locator("h1")).toHaveText(jaTerms.h1);
    await expect(page.locator(".legal .eyebrow")).toHaveText(jaTerms.eyebrow);
    await expect(page.locator(".legal .muted")).toHaveText(jaTerms.updated);
    await expect(page.locator(".legal .lead")).toHaveText(jaTerms.intro);

    // 条は 11（第1〜11条）。第6条（MCP）は決定31 で差し込んだ s6ai
    const heads = page.locator(".legal h2");
    await expect(heads).toHaveCount(11);
    await expect(heads.nth(0)).toHaveText(jaTerms["s1.h"]);
    await expect(heads.nth(5)).toHaveText(jaTerms["s6ai.h"]);
    await expect(heads.nth(10)).toHaveText(jaTerms["s10.h"]);
    // 壊さないこと: 価格の記載（第3条）
    await expect(page.locator(".legal")).toContainText(jaTerms["s3.p"]);
    await expect(page.locator(".legal")).toContainText("¥980");
    await expect(page.locator(".legal")).toContainText("¥4,800");

    // 共通ヘッダー/フッター（フッターの利用規約は新 URL）
    await expect(page.locator("header.site-header")).toHaveCount(1);
    await expect(
      page.locator("footer.footer").getByRole("link", { name: jaTerms.h1 }),
    ).toHaveAttribute("href", "/terms");

    expect(errors).toEqual([]);
  });

  test("Cookie kimaru_lang=en なら、旧と同じく英語の辞書に差し替わる", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "en", url: baseURL ?? "http://localhost" },
    ]);
    await page.goto("/terms");
    await expect(page.locator("h1")).toHaveText(enTerms.h1, { timeout: 10_000 });
    await expect(page).toHaveTitle(enTerms.title, { timeout: 10_000 });
    await expect(page.locator(".legal h2")).toHaveCount(11);
  });

  test("旧 URL /terms.html は /terms へ恒久リダイレクト。静的 CSP（nonce なし）", async ({
    request,
  }) => {
    const r = await request.get("/terms.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(r.status());
    expect(r.headers()["location"]).toMatch(/\/terms$/);
    const res = await request.get("/terms");
    expect(res.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers()["content-security-policy"]).not.toContain("nonce-");
  });
});
