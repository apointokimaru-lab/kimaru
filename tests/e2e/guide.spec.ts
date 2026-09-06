import { expect, test, type Page } from "@playwright/test";

import { ENTRIES, GROUPS, resolvePages } from "../../features/guide/entries";
import enGuide from "../../messages/en/guide.json";
import jaGuide from "../../messages/ja/guide.json";

// 使い方ガイド /guide（#423・段階1）。旧 public/guide.html + guide.js と同じ挙動を固定する
// （旧 scripts/test/e2e.mjs の「setup card + user guide (#353)」から移した）。
// 守ること: 一覧は項目名だけ／送りは 1 項目の中だけ／単ページには送りを出さない／#<key> で直接開く／
// 1 ページが iPhone 12（390×664）でスクロールせずに収まる。

const dialog = (page: Page) => page.getByRole("dialog");
/** 翻訳キーがそのまま出ていないか（辞書の貼り忘れ検出）。未定義キーは "guide.<key>" として描かれる */
const RAW_KEY = /guide\.[a-z-]+\.(p\d\.)?(lead|title|step\d|point\d|field\d|note)/;

test.describe("使い方ガイド /guide（#423）", () => {
  test("一覧は章ごとに項目名だけを並べ、Modal は押すまで開かない", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    const res = await page.goto("/guide");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(jaGuide.pageTitle);
    await expect(page.locator("h1")).toHaveText(jaGuide["index.heading"]);
    await expect(page.locator(".pagehead .eyebrow")).toHaveText(jaGuide["index.eyebrow"]);
    await expect(page.locator(".pagehead .sub")).toHaveText(jaGuide["index.lead"]);

    // 項目・章の数は features/guide/entries.ts が唯一の出どころ（HTML に項目名を書かない）
    await expect(page.getByTestId("guide-group")).toHaveCount(GROUPS.length);
    await expect(page.locator("[data-testid^='guide-item-']")).toHaveCount(ENTRIES.length);
    // 一覧はタイトルだけ（図も要約も置かない）
    await expect(page.getByTestId("guide-index").locator("svg")).toHaveCount(0);
    await expect(page.getByTestId("guide-index").locator("small")).toHaveCount(0);
    await expect(page.getByTestId("guide-index")).not.toContainText(/guide\.(group|index)\./);
    await expect(dialog(page)).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("単ページの項目: 送りを出さず、Esc で一覧に戻る", async ({ page }) => {
    await page.goto("/guide");
    await page.getByTestId("guide-item-change").click();
    await expect(dialog(page)).toBeVisible();
    // 押しても何も起きないボタンを置かない
    await expect(page.getByTestId("guide-count")).toHaveCount(0);
    await expect(dialog(page).locator("ol li")).toHaveCount(4);
    await expect(page.getByTestId("guide-heading")).toHaveText(jaGuide["change.title"]);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("複数ページの項目: 1 つのボタンから開き、Modal の中だけで送る", async ({ page }) => {
    await page.goto("/guide");
    const entry = ENTRIES.find((e) => e.key === "page-create");
    const pages = entry ? resolvePages(entry).length : 0;
    // 予約ページ設定の画面で触る項目は、この 1 つの Modal に揃っている（別ボタンに散らさない）
    expect(pages).toBe(7);

    const entryTitle = jaGuide["page-create.title"];
    await page.getByTestId("guide-item-page-create").click();
    await expect(page.getByTestId("guide-count")).toHaveText(`1 / ${pages}`);
    // 項目名は上のラベルへ回り、見出しはページ名になる（送っても同じ画面に見えないように）
    await expect(page.getByTestId("guide-eyebrow")).toHaveText(entryTitle);
    await expect(page.getByTestId("guide-heading")).not.toHaveText(entryTitle);
    await expect(page.getByTestId("guide-prev")).toBeDisabled();
    await expect(dialog(page).locator("ol li")).toHaveCount(5);

    const first = await page.getByTestId("guide-heading").textContent();
    await page.getByTestId("guide-next").click();
    await expect(page.getByTestId("guide-count")).toHaveText(`2 / ${pages}`);
    await expect(page.getByTestId("guide-heading")).not.toHaveText(first ?? "");
    await expect(dialog(page).locator("dl dt")).toHaveCount(4);
    await expect(dialog(page).locator("dl dd")).toHaveCount(4);
    await expect(dialog(page).locator("ol li")).toHaveCount(0);

    await page.getByTestId("guide-prev").click();
    await expect(page.getByTestId("guide-heading")).toHaveText(first ?? "");

    // 最後のページで止まる（別の項目へは送らない）。左右キーでも送れる
    for (let i = 1; i < pages; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("guide-count")).toHaveText(`${pages} / ${pages}`);
    await expect(page.getByTestId("guide-next")).toBeDisabled();

    // 一覧に「受付時間」「前後バッファ」「事前アンケート」の単独ボタンは無い（似た名前が並ぶと選べない）
    await page.getByTestId("guide-close").click();
    await expect(
      page.locator(
        "[data-testid='guide-item-hours'], [data-testid='guide-item-buffer'], [data-testid='guide-item-survey-setup']",
      ),
    ).toHaveCount(0);
  });

  test("説明の型: 概要は順序なしの箇条書き、注意のある項目は注記が出る", async ({ page }) => {
    await page.goto("/guide");
    await page.getByTestId("guide-item-page-about").click();
    await expect(dialog(page).locator("ul li")).toHaveCount(3);
    await expect(dialog(page).locator("ol li")).toHaveCount(0);
    // 「該当画面を開く」の行き先（旧ページはまだ .html）
    await expect(dialog(page).getByRole("link", { name: jaGuide.open })).toHaveAttribute(
      "href",
      "/booking-settings.html",
    );
    await page.getByTestId("guide-close").click();

    await page.getByTestId("guide-item-pause").click();
    await expect(dialog(page).getByText(jaGuide.note, { exact: true })).toBeVisible();
    await expect(dialog(page)).toContainText(jaGuide["pause.note"]);
  });

  test("すべてのページに本文があり、翻訳キーがそのまま出ない", async ({ page }) => {
    await page.goto("/guide");
    for (const entry of ENTRIES) {
      const pages = resolvePages(entry);
      await page.getByTestId(`guide-item-${entry.key}`).click();
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) await page.getByTestId("guide-next").click();
        const body = dialog(page).getByTestId("guide-body");
        await expect(body).not.toHaveText(RAW_KEY);
        // 要約だけの空の説明にしない（部品が 1 つ以上描かれている）
        await expect(body.locator("li, dt")).not.toHaveCount(0);
      }
      await page.getByTestId("guide-close").click();
    }
  });

  test("#<項目> の直リンクで開き、閉じると URL から消える", async ({ page }) => {
    // 案内メールから 1 つの説明へ送れるようにしてある
    await page.goto("/guide#contacts-about");
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId("guide-heading")).toHaveText(jaGuide["contacts-about.title"]);

    // 開いた項目は URL に載る。閉じたら消える（残すと再読み込みでまた開き、一覧に戻れない）
    await page.getByTestId("guide-close").click();
    await expect(dialog(page)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("");

    await page.getByTestId("guide-item-zoom").click();
    expect(new URL(page.url()).hash).toBe("#zoom");
  });

  test("Cookie kimaru_lang=en なら、旧と同じく英語の辞書に差し替わる", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "kimaru_lang", value: "en", url: baseURL ?? "http://localhost" },
    ]);
    await page.goto("/guide");
    await expect(page.locator("h1")).toHaveText(enGuide["index.heading"], { timeout: 10_000 });
    await expect(page).toHaveTitle(enGuide.pageTitle, { timeout: 10_000 });
    await page.getByTestId("guide-item-change").click();
    await expect(page.getByTestId("guide-heading")).toHaveText(enGuide["change.title"]);
  });

  test("旧 URL /guide.html は /guide へ恒久リダイレクト（#zoom 付きも届く）。静的 CSP（nonce なし）", async ({
    request,
  }) => {
    const r = await request.get("/guide.html", { maxRedirects: 0 });
    expect([301, 308]).toContain(r.status());
    expect(r.headers()["location"]).toMatch(/\/guide$/);
    const res = await request.get("/guide");
    expect(res.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers()["content-security-policy"]).not.toContain("nonce-");
  });

  // 収まらなくなったら、文を削るのではなくページを足す、という判断のための固定（#353）。
  // 許容は「和文 1 行ぶん」まで（LINE_HEIGHT）: 公開ページはシステムフォント（#418）になったので、
  // 同じ文でも実行環境のフォントで折り返しが 1 行ぶれる（CI・端末・開発機で辞書は同じでも高さが変わる）。
  // 文が 1 つ増えれば 1 行では収まらない（手順 1 件 = 53px）ので、分量が増えたときはここで落ちる。
  const LINE_HEIGHT = 27;
  test("1 ページぶんが iPhone 12（390×664）でスクロールせずに収まる", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone12", "iPhone 12 の幅でだけ見る");
    await page.goto("/guide");
    const over: string[] = [];
    for (const entry of ENTRIES) {
      const pages = resolvePages(entry);
      await page.getByTestId(`guide-item-${entry.key}`).click();
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) await page.getByTestId("guide-next").click();
        const gap = await dialog(page).evaluate((el) => el.scrollHeight - el.clientHeight);
        if (gap > LINE_HEIGHT) over.push(`${entry.key}#${i + 1}+${gap}`);
      }
      await page.getByTestId("guide-close").click();
    }
    expect(over).toEqual([]);
  });
});
