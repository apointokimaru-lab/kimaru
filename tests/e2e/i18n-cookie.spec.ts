import { expect, test } from "@playwright/test";

// 言語の保持を localStorage から Cookie `kimaru_lang` へ移した（#414）。旧ページ（public/i18n.js）が
// 新側と同じ Cookie を最優先で読み、切替時に Cookie にも書くことを実ブラウザで固定する。
// 旧ページはヘッダー注入（Edge）が無いと言語セレクトが無いので、window.KimaruI18n を直接呼ぶ。
// 見る旧ページは運営ログイン（#423 で /guide.html を Next に移したときに移した）。旧ページなら何でもよいが、
// 最後まで public/ に残る画面（段階5・#448）を選ぶと、移行のたびにこの spec を書き換えずに済む。

type KimaruWindow = Window & {
  KimaruI18n: { getLanguage(): string; setLanguage(code: string): void };
};

test.describe("言語 Cookie と旧ページの同期（#414）", () => {
  test("Cookie kimaru_lang=en があれば旧ページは英語で描画される", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "en", url: baseURL ?? "http://localhost" },
    ]);
    await page.goto("/operator-login.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(
      await page.evaluate(() => (window as unknown as KimaruWindow).KimaruI18n.getLanguage()),
    ).toBe("en");
  });

  test("旧ページで言語を切り替えると Cookie にも書かれる（新側と揃う）", async ({ page }) => {
    await page.goto("/operator-login.html");
    await page.evaluate(() => (window as unknown as KimaruWindow).KimaruI18n.setLanguage("zh-TW"));
    const cookie = (await page.context().cookies()).find((c) => c.name === "kimaru_lang");
    expect(cookie?.value).toBe("zh-TW");
    expect(cookie?.path).toBe("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  });

  test("Cookie が無ければ旧 localStorage の選択を使う（既存ユーザーの設定を失わない）", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem("kimaru.language", "en"));
    await page.goto("/operator-login.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("Cookie と localStorage が食い違えば Cookie が勝つ", async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "zh-TW", url: baseURL ?? "http://localhost" },
    ]);
    await page.addInitScript(() => window.localStorage.setItem("kimaru.language", "en"));
    await page.goto("/operator-login.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  });
});
