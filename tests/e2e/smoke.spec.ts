import { expect, test } from "@playwright/test";

// 段階0 の同居確認（#412 の netlify dev / Deploy Preview で見た項目のうち、`next start` 単体で確かめられるもの）。
// / は #418 で Next の LP になった（tests/e2e/lp.spec.ts）。
// netlify.toml の書き換え（/b/* 等）と Edge の注入は next start では効かないので、ここでは見ない。

test.describe("旧サイトと Next.js の同居（段階0）", () => {
  test("トップ / は LP（Next・#418）を返し、JS 例外が無い", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/キマル/);
    expect(errors).toEqual([]);
  });

  test("旧ページ（/operator-login.html）は同じ URL でそのまま配信される", async ({ page }) => {
    // 使い方ガイドは #423 で Next に移したので、最後まで public/ に残る運営ログイン（段階5・#448）で見る
    const res = await page.goto("/operator-login.html");
    expect(res?.status()).toBe(200);
    // 旧ページの目印（i18n.js が textContent を入れる前の既定文言）
    await expect(page.locator("body")).toContainText("運営ログイン");
  });

  test("存在しない URL は旧 404 ページを 404 で返す", async ({ page }) => {
    const res = await page.goto("/__no_such_page__");
    expect(res?.status()).toBe(404);
    await expect(page.locator('body[data-page="not-found"]')).toHaveCount(1);
  });

  test("Next が返す応答にもセキュリティヘッダーが付き、X-Powered-By は無い", async ({
    request,
  }) => {
    const res = await request.get("/");
    const headers = res.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
