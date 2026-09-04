import { defineConfig, devices } from "@playwright/test";

// 新フロントの e2e（#413・規約 docs/frontend-conventions.md 9 章）。
// - `next build` 済みのアプリを `next start` で立てて、その URL に対して実ブラウザで確認する
//   （旧ページ用の scripts/test/e2e.mjs は public/ を静的配信していた。新側は本番と同じサーバで見る）
// - /api/** は各 spec で page.route によりモックする（実 DB・実 Functions に繋がない）
// - デスクトップと iPhone 12（390×664）の両方で回す。旧 e2e と同じ判定基準（JS 例外なし・残ダミーなし）
const PORT = 3123;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  // CI で test.only を残したまま通ってしまうのを防ぐ
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // 事前に `npm run build` が要る（CI では build ジョブの後に実行）。ローカルで起動済みならそれを使う
    command: `npx next start -p ${PORT}`,
    url: `${baseURL}/styles.css`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // iPhone 12 相当の幅。WebKit は入れず Chromium で見る（ブラウザを 1 種類に絞ってキャッシュと時間を節約）
      name: "iphone12",
      use: {
        ...devices["iPhone 12"],
        browserName: "chromium",
        viewport: { width: 390, height: 664 },
      },
    },
  ],
});
