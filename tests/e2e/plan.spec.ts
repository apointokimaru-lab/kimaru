import { expect, test, type Page } from "@playwright/test";

import enPricing from "../../messages/en/pricing.json";
import jaPricing from "../../messages/ja/pricing.json";

// 料金・プラン /plan（#419）。旧 public/plan.html と同じ文言・出し分け・導線・Cat Key 申請を固定する。
// body[data-auth] は本番では Edge が付ける。next start 単体では付かないので、ログイン状態のテストは
// 初期スクリプトで data-auth="authed" を付け、/api/me を route でモックする。

/** ページ読み込み前に body に data-auth を付ける（Edge の代わり） */
async function withAuth(page: Page, auth: "authed" | "guest") {
  await page.addInitScript((value) => {
    // 初期スクリプトは <html> より前に走るので document（Node）を監視して body の出現を待つ
    const set = () => {
      if (document.body) document.body.dataset.auth = value;
      return !!document.body;
    };
    if (!set()) {
      const o = new MutationObserver(() => {
        if (set()) o.disconnect();
      });
      o.observe(document, { childList: true, subtree: true });
    }
  }, auth);
}

test.describe("料金・プラン /plan（#419）", () => {
  test("未ログイン: 文言・3 プラン・比較表・導線が旧と同じで、ログイン専用の要素は見えない", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await withAuth(page, "guest");

    const res = await page.goto("/plan");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(jaPricing.pageTitle);
    await expect(page.locator("h1")).toHaveText(jaPricing.heading);
    await expect(page.locator(".plans .plan")).toHaveCount(3);
    await expect(page.locator("table tbody tr")).toHaveCount(10);
    await expect(page.getByText("¥980", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("¥4,800", { exact: false }).first()).toBeVisible();

    // 共通ヘッダー（未ログインの 3 項目）とフッター。スマホ幅ではメニューがハンバーガーの中（display:none）なので
    // role ではなく CSS で取り、href だけ確かめる
    const header = page.locator("header.site-header");
    await expect(header.locator("nav a", { hasText: "料金" })).toHaveAttribute("href", "/plan");
    await expect(header.locator("nav a", { hasText: "無料登録" })).toHaveAttribute(
      "href",
      "/signup.html",
    );
    await expect(header.locator("nav a", { hasText: "ログイン" })).toHaveAttribute(
      "href",
      "/login.html",
    );
    await expect(header.locator("a.app-only").first()).toBeHidden();
    await expect(
      page.locator("footer.footer").getByRole("link", { name: "利用規約" }),
    ).toHaveAttribute("href", "/terms.html");

    // ログイン専用（Cat Key フォーム・Pro を始める）は見えず、未ログイン向けの案内が見える
    await expect(page.locator("#pro-cat-key-form")).toBeHidden();
    await expect(page.locator(".plan-free-only").first()).toBeHidden();
    await expect(page.getByText(jaPricing["catkey.loginNote"])).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("Cookie kimaru_lang=en なら、マウント後に英語へ差し替わる（title・<html lang> も）", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "en", url: baseURL ?? "http://localhost" },
    ]);
    await page.goto("/plan");
    await expect(page.locator("h1")).toHaveText(enPricing.heading, { timeout: 10_000 });
    await expect(page).toHaveTitle(enPricing.pageTitle, { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("ヘッダーの言語選択で切り替わり、Cookie に保存される", async ({ page }) => {
    await page.goto("/plan");
    // スマホ幅ではメニューがハンバーガーの中。開いてから言語を選ぶ（利用者と同じ操作）
    const burger = page.locator("label.nav-burger");
    if (await burger.isVisible()) await burger.click();
    await page.locator("select.lang-select").selectOption("en");
    await expect(page.locator("h1")).toHaveText(enPricing.heading, { timeout: 10_000 });
    const cookie = (await page.context().cookies()).find((c) => c.name === "kimaru_lang");
    expect(cookie?.value).toBe("en");
    await page.locator("select.lang-select").selectOption("ja");
    await expect(page.locator("h1")).toHaveText(jaPricing.heading, { timeout: 10_000 });
  });

  test("ログイン中（Pro）: 有料向けの導線が出て、Cat Key を申請できる", async ({ page }) => {
    await withAuth(page, "authed");
    await page.route("**/api/me", (route) =>
      route.fulfill({ json: { owner: { id: "o1", plan: "pro" }, calendar_connected: true } }),
    );
    let posted: unknown = null;
    await page.route("**/api/invite-apply", async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({ json: { pending: true } });
    });

    await page.goto("/plan");
    await expect(page.locator("body")).toHaveClass(/plan-pro/);
    await expect(page.locator(".plan-paid-only").first()).toBeVisible();
    await expect(page.locator(".plan-free-only").first()).toBeHidden();
    await expect(page.locator("header.site-header a.guest-only").first()).toBeHidden();

    await page.locator("#pro-cat-key-form input[name=code]").fill("Neko20240222");
    await page.locator("#pro-cat-key-form button[type=submit]").click();
    await expect(page.locator("#pro-cat-key-message")).toHaveText(jaPricing["catkey.pendingDone"]);
    await expect(page.locator("#pro-cat-key-message")).toHaveClass(/success/);
    expect(posted).toEqual({ code: "Neko20240222" });
  });

  test("ログイン中（free）: Cat Key の失敗は error で表示され、ログイン系のエラーは言い換える", async ({
    page,
  }) => {
    await withAuth(page, "authed");
    await page.route("**/api/me", (route) =>
      route.fulfill({ json: { owner: { id: "o1", plan: "free" } } }),
    );
    await page.route("**/api/invite-apply", (route) =>
      route.fulfill({ status: 401, json: { error: "unauthorized" } }),
    );
    await page.goto("/plan");
    await expect(page.locator("body")).toHaveClass(/plan-free/);
    await expect(page.locator(".plan-free-only").first()).toBeVisible();
    await page.locator("#pro-cat-key-form input[name=code]").fill("WRONG");
    await page.locator("#pro-cat-key-form button[type=submit]").click();
    await expect(page.locator("#pro-cat-key-message")).toHaveText(jaPricing["catkey.needLogin"]);
    await expect(page.locator("#pro-cat-key-message")).toHaveClass(/error/);
  });

  test("旧 URL /plan.html は /plan へ恒久リダイレクト。静的 CSP（nonce なし）", async ({
    request,
  }) => {
    const r = await request.get("/plan.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(r.status());
    expect(r.headers()["location"]).toMatch(/\/plan$/);
    const res = await request.get("/plan");
    expect(res.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers()["content-security-policy"]).not.toContain("nonce-");
  });
});
