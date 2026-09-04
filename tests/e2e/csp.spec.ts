import { expect, test } from "@playwright/test";

// CSP の 2 モード（#415・規約 8 章）を実ブラウザで固定する。
// - 静的ページ（/ と旧 HTML）: 旧サイトと同じ CSP（'unsafe-inline' あり・nonce なし）
// - 動的ページ（/dev/csp・KIMARU_DEV_ROUTES=1 で存在）: nonce 付き CSP で hydration が通り、CSP 違反が出ない

test.describe("CSP 2 モード（#415）", () => {
  test("静的ページ / は旧サイトと同じ CSP（nonce なし）", async ({ request }) => {
    const res = await request.get("/");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("nonce-");
  });

  test("動的ページ /dev/csp は nonce 付き CSP で、Client 部品が動き、CSP 違反が出ない", async ({
    page,
  }) => {
    const violations: string[] = [];
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto("/dev/csp");
    expect(res?.status()).toBe(200);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("'unsafe-inline'");
    // nonce は要求ごとに変わる（base64 の UUID＝48 文字）
    await expect(page.getByTestId("nonce-length")).toHaveText("48");

    // hydration の確認: Client 部品のボタンで state が動く
    await page.getByRole("button", { name: "押した回数を増やす" }).click();
    await expect(page.getByTestId("probe-count")).toHaveText("1");

    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("動的ページの <html lang> は Cookie の言語（サーバー描画）", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "en", url: baseURL ?? "http://localhost" },
    ]);
    await page.goto("/dev/csp");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("動的ページは要求ごとに違う nonce", async ({ request }) => {
    const a = (await request.get("/dev/csp")).headers()["content-security-policy"];
    const b = (await request.get("/dev/csp")).headers()["content-security-policy"];
    expect(a).not.toEqual(b);
  });
});
