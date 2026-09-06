import { expect, test } from "@playwright/test";

import enTokushoho from "../../messages/en/tokushoho.json";
import jaTokushoho from "../../messages/ja/tokushoho.json";

// 特定商取引法に基づく表記 /tokushoho（#422）。旧 public/tokushoho.html と同じ文言・構造・導線を固定する。
// 本文は項目名と値の 14 組（dl）。価格・連絡先・登録番号はそのまま。

test.describe("特定商取引法に基づく表記 /tokushoho（#422）", () => {
  test("文言・構造・導線が旧と同じで、JS 例外が無い", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    const res = await page.goto("/tokushoho");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(jaTokushoho.title);
    await expect(page.locator("h1")).toHaveText(jaTokushoho.heading);
    await expect(page.locator(".legal .muted")).toHaveText(jaTokushoho.updated);
    await expect(page.locator(".legal .lead")).toHaveText(jaTokushoho.lead);

    // 14 項目。dt/dd は dl の直接の子（2 列の grid が効く）
    const dts = page.locator(".legal-dl > dt");
    const dds = page.locator(".legal-dl > dd");
    await expect(dts).toHaveCount(14);
    await expect(dds).toHaveCount(14);
    await expect(dts.nth(0)).toHaveText(jaTokushoho["seller.label"]);
    await expect(dds.nth(0)).toHaveText(jaTokushoho["seller.value"]);
    await expect(dts.nth(13)).toHaveText(jaTokushoho["refund.label"]);
    await expect(dds.nth(13)).toHaveText(jaTokushoho["refund.value"]);
    // 価格・連絡先・登録番号
    await expect(page.locator(".legal-dl")).toContainText(jaTokushoho["price.value"]);
    await expect(page.locator(".legal-dl")).toContainText("¥980");
    await expect(page.locator(".legal-dl")).toContainText(jaTokushoho["invoice.value"]);
    await expect(page.locator(".legal-dl")).toContainText(jaTokushoho["email.value"]);
    // 枠（.panel）の中に本文がある（旧と同じ見た目の骨格）
    await expect(page.locator("main.shell.narrow > section.panel.legal")).toHaveCount(1);

    // 共通ヘッダー/フッター（フッターの特商法は新 URL）
    await expect(page.locator("header.site-header")).toHaveCount(1);
    await expect(
      page.locator("footer.footer").getByRole("link", { name: jaTokushoho.heading }),
    ).toHaveAttribute("href", "/tokushoho");

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
    await page.goto("/tokushoho");
    await expect(page.locator("h1")).toHaveText(enTokushoho.heading, { timeout: 10_000 });
    await expect(page).toHaveTitle(enTokushoho.title, { timeout: 10_000 });
    await expect(page.locator(".legal-dl > dt")).toHaveCount(14);
  });

  test("旧 URL /tokushoho.html は /tokushoho へ恒久リダイレクト。静的 CSP（nonce なし）", async ({
    request,
  }) => {
    const r = await request.get("/tokushoho.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(r.status());
    expect(r.headers()["location"]).toMatch(/\/tokushoho$/);
    const res = await request.get("/tokushoho");
    expect(res.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers()["content-security-policy"]).not.toContain("nonce-");
  });
});
