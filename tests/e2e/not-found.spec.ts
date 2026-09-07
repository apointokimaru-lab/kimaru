import { expect, test } from "@playwright/test";

import enNf from "../../messages/en/nf.json";
import jaNf from "../../messages/ja/nf.json";

// 見つからないページ /（未マッチ URL 全部）・#424。旧 public/404.html と同じ文言・導線を固定する。
// 旧サイトでは Netlify が 404.html を自動で返していた。Next 同居後は (public) のキャッチオールが
// notFound() を呼び、同じグループの not-found.tsx が出る。

test.describe("404 ページ（#424）", () => {
  test("存在しない URL は 404 で、旧と同じ文言・導線が出る", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      // このページ自身が 404 で返るので、ブラウザは必ず「Failed to load resource: … 404」を出す。
      // これは JS 例外ではなくステータスの報告なので数えない（他のページの spec と同じ基準を保つため、ここだけ除外する）
      if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text()))
        errors.push(m.text());
    });

    const res = await page.goto("/__no_such_page__");
    expect(res?.status()).toBe(404);
    await expect(page.locator(".eyebrow")).toHaveText(jaNf.eyebrow);
    await expect(page.locator("h1")).toHaveText(jaNf.heading);
    await expect(page.locator(".lead")).toHaveText(jaNf.desc);
    await expect(page.getByRole("link", { name: jaNf.goTop })).toHaveAttribute("href", "/");

    // 共通ヘッダー/フッターは公開ページと同じものが出る（レイアウトを共有している証拠）
    await expect(page.locator("header.site-header")).toHaveCount(1);
    await expect(page.locator("footer.footer")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("Cookie kimaru_lang=en なら英語の辞書に差し替わる", async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "en", url: baseURL ?? "http://localhost" },
    ]);
    await page.goto("/__no_such_page__");
    await expect(page.locator("h1")).toHaveText(enNf.heading, { timeout: 10_000 });
    await expect(page).toHaveTitle(enNf.pageTitle, { timeout: 10_000 });
  });

  test("旧 URL /404.html は /404 へ恒久リダイレクトし、その先も 404 で返る", async ({
    request,
  }) => {
    const r = await request.get("/404.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(r.status());
    expect(r.headers()["location"]).toMatch(/\/404$/);
    // 受付停止中の予約ページ（booking-week.js）の誘導先。ここも 404 で返る
    const res = await request.get("/404");
    expect(res.status()).toBe(404);
  });

  test("移行済みの公開ページは 404 にならない（キャッチオールが実ページを飲み込まない）", async ({
    request,
  }) => {
    for (const path of ["/", "/plan", "/terms", "/privacy", "/tokushoho", "/guide"]) {
      const res = await request.get(path);
      expect(res.status(), `${path} が 404 になっている`).toBe(200);
    }
    // 旧ページ（public/ の実ファイル）も従来どおり配信される
    const legacy = await request.get("/login.html");
    expect(legacy.status()).toBe(200);
  });
});
