import { expect, test, type Page } from "@playwright/test";

// トップ（LP）の移行（#418）。旧 public/index.html と同じ文言・導線・画像で表示されることを固定する。

test.describe("LP /（#418）", () => {
  test("見出し・主要文言・導線が旧と同じ", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle("キマル | 予約から次の一手までキマる");
    await expect(page.locator("h1")).toHaveText("キマル");
    await expect(page.getByText("日程調整の、その先へ。")).toBeVisible();
    await expect(page.getByText("相手に送るのは、予約ページ設定で作成したURLだけ。")).toBeVisible();

    // 主要導線（旧ページへのリンクは .html のまま）
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "ログイン" })).toHaveAttribute(
      "href",
      "/login.html",
    );
    await expect(header.getByRole("link", { name: "料金を見る" })).toHaveAttribute(
      "href",
      "/plan.html",
    );
    await expect(header.getByRole("link", { name: "無料で始める" })).toHaveAttribute(
      "href",
      "/signup.html",
    );
    await expect(page.getByRole("link", { name: "できることを見る" })).toHaveAttribute(
      "href",
      "#solve",
    );
    await expect(page.locator("#solve")).toHaveCount(1);
    await expect(page.locator("#plans")).toHaveCount(1);

    // 機能一覧 9 行・プラン 3 枚・フッターの法務リンク
    await expect(page.locator("table tbody tr")).toHaveCount(9);
    await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
    await expect(page.getByText("先着100名限定")).toBeVisible();
    await expect(page.getByText("通常 ¥2,200 /月")).toBeVisible();
    await expect(page.getByRole("link", { name: "特定商取引法に基づく表記" })).toHaveAttribute(
      "href",
      "/tokushoho.html",
    );

    expect(errors).toEqual([]);
  });

  test("画像 3 枚が読み込まれ、寸法を持つ（CLS を起こさない）", async ({ page }) => {
    await page.goto("/");
    const imgs = page.locator("main img");
    await expect(imgs).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const img = imgs.nth(i);
      await expect(img).toHaveAttribute("width", /\d+/);
      await expect(img).toHaveAttribute("height", /\d+/);
    }
    // 先頭の画像（LCP 候補）は遅延読み込みしない
    await expect(imgs.first()).not.toHaveAttribute("loading", "lazy");
    await img0Loaded(page);
  });

  // Next の redirects({ permanent: true }) は 308 を返す（301 と同じ「恒久」。GET では同じ挙動）
  test("旧 URL /index.html は / へ恒久リダイレクト", async ({ request }) => {
    const res = await request.get("/index.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/$/);
  });

  test("廃止した /home.html と /landing3.html はそれぞれの行き先へ恒久リダイレクト", async ({
    request,
  }) => {
    const home = await request.get("/home.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(home.status());
    expect(home.headers()["location"]).toMatch(/\/dashboard\.html$/);
    const l3 = await request.get("/landing3.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(l3.status());
    expect(l3.headers()["location"]).toMatch(/\/$/);
  });

  test("静的ページとして配信され、旧と同じ CSP が付く", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(h["content-security-policy"]).not.toContain("nonce-");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});

async function img0Loaded(page: Page) {
  const ok = await page
    .locator("main img")
    .first()
    .evaluate(
      (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
    );
  expect(ok).toBe(true);
}
