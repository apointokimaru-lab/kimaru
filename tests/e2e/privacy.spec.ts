import { expect, test } from "@playwright/test";

import enPrivacy from "../../messages/en/privacy.json";
import jaPrivacy from "../../messages/ja/privacy.json";

// プライバシーポリシー /privacy（#421）。旧 public/privacy.html と同じ文言・構造・導線を固定する。
// 壊さないこと（issue）: 第3条の外部 AI 送信（MCP）条項と、利用計測（#342）の文。

test.describe("プライバシーポリシー /privacy（#421）", () => {
  test("文言・構造・導線が旧と同じで、JS 例外が無い", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    const res = await page.goto("/privacy");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(jaPrivacy.title);
    await expect(page.locator("h1")).toHaveText(jaPrivacy.h1);
    await expect(page.locator(".legal .muted")).toHaveText(jaPrivacy.updated);
    await expect(page.locator(".legal .lead")).toHaveText(jaPrivacy.lead);

    // 節は 9（1〜9）。5 節（MCP）は決定31 で差し込んだ s5ai
    const heads = page.locator(".legal h2");
    await expect(heads).toHaveCount(9);
    await expect(heads.nth(0)).toHaveText(jaPrivacy["s1.h"]);
    await expect(heads.nth(4)).toHaveText(jaPrivacy["s5ai.h"]);
    await expect(heads.nth(8)).toHaveText(jaPrivacy["s8.h"]);
    // 壊さないこと: 第3条の MCP 条項・第1条の利用計測の文（生の URL と IP は保存しない）
    const legal = page.locator(".legal");
    await expect(legal).toContainText(jaPrivacy["s3.p"]);
    await expect(legal).toContainText("生の URL と IP アドレスは保存しません");
    await expect(legal).toContainText(jaPrivacy["s7.p"]);
    // Google のポリシーへのリンク（別タブ）
    const link = legal.getByRole("link", { name: jaPrivacy["s4.link"] });
    await expect(link).toHaveAttribute(
      "href",
      "https://developers.google.com/terms/api-services-user-data-policy",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    // 連絡先 3 段落
    await expect(legal).toContainText(jaPrivacy["s8.addr"]);
    await expect(legal).toContainText(jaPrivacy["s8.mail"]);

    // 共通ヘッダー/フッター（フッターのプライバシーポリシーは新 URL）
    await expect(page.locator("header.site-header")).toHaveCount(1);
    await expect(
      page.locator("footer.footer").getByRole("link", { name: jaPrivacy.h1 }),
    ).toHaveAttribute("href", "/privacy");

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
    await page.goto("/privacy");
    await expect(page.locator("h1")).toHaveText(enPrivacy.h1, { timeout: 10_000 });
    await expect(page).toHaveTitle(enPrivacy.title, { timeout: 10_000 });
    await expect(page.locator(".legal h2")).toHaveCount(9);
  });

  test("旧 URL /privacy.html は /privacy へ恒久リダイレクト。静的 CSP（nonce なし）", async ({
    request,
  }) => {
    const r = await request.get("/privacy.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(r.status());
    expect(r.headers()["location"]).toMatch(/\/privacy$/);
    const res = await request.get("/privacy");
    expect(res.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers()["content-security-policy"]).not.toContain("nonce-");
  });
});
