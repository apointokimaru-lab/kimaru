# 速度のベースライン（2026-09・フロント刷新の着手前）

計測日: 2026-09-05／対象: 本番 `https://kimaru-co.jp`・公開デプロイ `6a97e44a8677df00085a86fc`（2026-09-02 公開・**旧サイトのみ。Next.js 未導入**）／issue #417（親 #406）

[← docs 索引](../README.md)

> **目的**: フロント刷新（#406〜#411）の効果を「着手前の本番」と比べて数字で示す。段階5（#454）で**同じコマンド・同じ PC**で測り直し、この表と並べる。
> **読むときの注意**: Lighthouse の数値は測る PC に依存する（特にモバイルの TBT）。同じ回でもばらつくため、**3 回測って Performance スコアの中央値の回**を採用し、括弧に 3 回のスコアを残した。絶対値ではなく**前後の差**を見る。

## 1. 計測方法

| 項目 | 値 |
|---|---|
| 道具 | Lighthouse 13.4.1（`npm run perf:lighthouse`＝`scripts/perf/lighthouse.mjs`）、Chrome 151（Playwright 同梱・headless） |
| PC | WSL2（Linux 5.15）上の Node 24。ネットワークは自宅回線 |
| モバイル | Lighthouse 既定のエミュレーション（Moto G Power 相当・4G 相当の帯域と CPU 4 倍遅延） |
| デスクトップ | `lighthouse/core/config/desktop-config.js`（絞りなし） |
| 回数 | 各 3 回、スコアの中央値の回を採用 |
| ログイン後 | `/dashboard.html` は運営所有のテストアカウントでログインした Cookie を `--cookie` で渡した |
| 列の意味 | 総転送量＝Lighthouse の total-byte-weight。JS/CSS/フォント/画像は **圧縮前の実サイズ**（`resourceSize`）。同じ Chrome で続けて測ると `max-age=0` の資産が再検証（304 相当）になり転送量が数十バイトに見えるため、実サイズで比べる |

再現:

```bash
npm run perf:lighthouse -- --base https://kimaru-co.jp --runs 3 --out <保存先>
npm run perf:lighthouse -- --base https://kimaru-co.jp --runs 3 --only /dashboard.html --cookie "kimaru_session=…" --out <保存先>
npm run perf:lighthouse -- --from-dir <保存先>   # 保存した結果から表だけ作り直す
```

## 2. 結果（Lighthouse・中央値の回）

| 画面 | 端末 | Score | FCP | LCP | TBT | CLS | SI | TTFB | 総転送量 | JS 実サイズ | CSS 実サイズ | フォント実サイズ | 画像実サイズ | 要求数 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| トップ（LP） `/` | mobile | **96**（85/96/98） | 1.06s | 2.76s | 0ms | 0.000 | 2.65s | 130ms | 566 KB | 5 KB | 15 KB | 0 KB | 556 KB | 6 |
| トップ（LP） `/` | desktop | **99**（98/99/99） | 0.37s | 0.45s | 0ms | 0.068 | 0.39s | 106ms | 560 KB | 5 KB | 15 KB | 0 KB | 556 KB | 6 |
| 予約ページ /b/{slug} `/b/zoom-review` | mobile | **79**（66/84/79） | 3.62s | 3.62s | 0ms | 0.100 | 3.62s | 163ms | 477 KB | 382 KB | 694 KB | 323 KB | 0 KB | 26 |
| 予約ページ /b/{slug} `/b/zoom-review` | desktop | **86**（86/88/86） | 0.95s | 1.15s | 0ms | 0.186 | 1.45s | 147ms | 514 KB | 382 KB | 694 KB | 361 KB | 0 KB | 28 |
| 料金・プラン `/plan.html` | mobile | **89**（89/85/95） | 2.90s | 3.05s | 34ms | 0.000 | 2.90s | 399ms | 806 KB | 341 KB | 670 KB | 542 KB | 0 KB | 37 |
| 料金・プラン `/plan.html` | desktop | **97**（97/97/99） | 0.98s | 0.98s | 0ms | 0.001 | 1.00s | 153ms | 697 KB | 341 KB | 670 KB | 542 KB | 0 KB | 37 |
| 使い方ガイド `/guide.html` | mobile | **75**（75/75/85） | 3.34s | 3.34s | 0ms | 0.205 | 3.34s | 146ms | 546 KB | 356 KB | 670 KB | 394 KB | 0 KB | 28 |
| 使い方ガイド `/guide.html` | desktop | **75**（75/75/75） | 1.00s | 1.00s | 0ms | 0.559 | 1.00s | 147ms | 583 KB | 356 KB | 670 KB | 431 KB | 0 KB | 30 |
| ダッシュボード（要ログイン） `/dashboard.html` | mobile | **58**（61/58/48） | 3.85s | 3.85s | 0ms | 0.529 | 3.85s | 153ms | 610 KB | 474 KB | 670 KB | 451 KB | 0 KB | 38 |
| ダッシュボード（要ログイン） `/dashboard.html` | desktop | **72**（72/72/72） | 1.52s | 1.52s | 0ms | 0.207 | 3.62s | 161ms | 627 KB | 474 KB | 670 KB | 468 KB | 0 KB | 39 |

主要資産の実サイズ（参考。`public/` のファイル。括弧は gzip 後）: `i18n.js` 330 KB（87 KB）／`app.js` 132 KB（40 KB）／`styles.css` 109 KB（25 KB）／`booking-week.js` 37 KB（13 KB）／`guide.js` 16 KB（5 KB）。

## 3. PageSpeed Insights（Google のラボ環境・参考）

自分の PC に依存しない基準として、同じ 4 画面を PageSpeed Insights API（API キー無し・70 秒間隔）でも測った。ログインが要る `/dashboard.html` は測れない。

（取得できなかった。API キー無しの PageSpeed Insights が 429 を返し続けたため。段階5 の事後計測時にブラウザの https://pagespeed.web.dev/ で同じ 4 画面を手で取って併記する）

## 4. 読み取れること（刷新で狙う点）

1. **LP は速い**（mobile 96 / desktop 99）。重いのは画像 556 KB だけで、JS・CSS はほぼ無い。刷新後もこの水準を落とさないことが条件（静的生成＋CDN を維持する理由）。
2. **予約ページ・ガイド・ダッシュボードは、描画が「JS と CSS を全部読み終えるまで」始まらない**。mobile で FCP＝LCP＝Speed Index が同じ値（3.3〜3.9 秒）になっているのがその証拠。原因は次の 3 つ:
   - `styles.css` が `@import` で Google Fonts の CSS（Noto Sans JP 5 ウェイト・**約 560 KB**）を読む。`@import` は直列＝描画をブロックする
   - `i18n.js`（3 言語・**330 KB**）を全ページで読み、`textContent` を入れ替えてから文言が出る
   - フォントの実体（woff2）が 320〜540 KB
   → 刷新側の対策は決定済み: 言語×画面ぶんだけの辞書（#414・LP の `home` 名前空間で約 1/8）、`next/font` の自己ホスト（#415・CSS の `@import` 連鎖が消える）、CSS Modules（#415）。
3. **CLS が悪い**（ガイド desktop 0.559、ダッシュボード mobile 0.529、予約ページ desktop 0.186）。Edge の共通ヘッダー注入と `i18n.js` の文言差し替え、フォントの遅延読み込みで、描画後にレイアウトが動いている。サーバー描画（文言が最初から HTML にある）と自己ホストのフォントで解消できる。
4. **TTFB は 100〜160 ms**（CDN の静的配信）。動的ページ（nonce 付き CSP）は関数描画になるため、刷新後はここが数百 ms 増える見込み。LP は静的生成のまま守る（規約 8 章の CSP 2 モードの根拠）。
5. **ダッシュボードが最も遅い**（mobile 58）。JS 474 KB（`i18n.js`＋`app.js`）と、`/api/*` を複数呼んでから描く構造のため。段階4（#435）でサーバー描画にする効果が最も大きい画面。

### 刷新後の目標（#454 で照合）

| 指標 | 目標 |
|---|---|
| LP `/` | mobile 95 以上を維持。総転送量を増やさない |
| 予約ページ・ガイド・ダッシュボード（mobile） | Score 90 以上（ダッシュボードは 80 以上）、FCP 1.5 秒以内 |
| CLS | 全画面 0.1 以下 |
| JS 実サイズ | 画面あたり 150 KB 以下（辞書は言語×画面ぶんだけ） |
| CSS 実サイズ | 画面あたり 60 KB 以下（Google Fonts の CSS を持たない） |
| フォント | 自己ホスト。初回表示に要る範囲だけ |

## 5. 応答ヘッダーの控え（刷新前・本番）

すべての公開 URL で同じ値（`netlify.toml` の `[[headers]]`）。刷新後も同じ値を保ち、動的ページだけ CSP が nonce 付きになる（`lib/csp.ts`）。

```text
cache-control: public,max-age=0,must-revalidate
content-security-policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; upgrade-insecure-requests
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
```

`/dashboard.html` は未ログインだと `302 → /login.html?next=%2Fdashboard.html`（Edge の auth-gate）。

## 変更履歴

- 2026-09-05 初版（#417）。
