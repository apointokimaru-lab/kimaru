# フロント（Next.js）コード規約とフォルダ構造

作成: 2026-09-04（#416・親 #406）／対象: Next.js 16.3・React 19.2・TypeScript 5.9（strict）

[← docs 索引](./README.md)

> **この文書が正本。** `CLAUDE.md` には要点だけを置き、詳細はここに書く。規約を変えるときは **この文書を先に直してから**コードを直す（理由を「変更履歴」に 1 行残す）。
> 旧フロント（`public/` の静的 HTML＋バニラ JS）と Functions（`netlify/functions/`・CommonJS）の規約は従来どおり `CLAUDE.md` にある。本書は **`app/` 以下の新フロント**にだけ適用する。

---

## 0. 決めたこと（一覧）

| 論点 | 決定 | 理由（1 行） |
|---|---|---|
| 枠組み | **Next.js 16 App Router**・**React 19**・**TypeScript strict** | #396。既定でエスケープ・型・SSR/SSG を 1 つの枠組みで |
| 置き場所 | **リポジトリ直下**（`app/` `components/` `features/` `lib/` …）。`src/` は使わない | `public/` を Next の静的フォルダとして旧サイトと同居させるため（#412）。モノレポ化は Bot の T-101（#381） |
| ビルド | **Turbopack**（Next 16 の既定）。`webpack` 設定は書かない | 書くと `next build` が失敗する |
| キャッシュ | **既定モデル**（`cacheComponents` は使わない。`use cache` も使わない） | nonce 付き CSP は PPR と両立しない。キャッシュは `dynamic`／`revalidate` の段階設定で十分 |
| 描画 | **公開ページ＝静的生成／ユーザーデータを描くページ＝動的描画** | 9 章の CSP 2 モードと対応させる |
| ルート保護・CSP | **`proxy.ts`**（Next 16 で `middleware.ts` から改名。Node.js 実行のみ） | 旧 Edge `auth-gate.js` の後継。段階5 で Edge を撤去 |
| データ取得（サーバー） | **`lib/server/` から `netlify/functions/_lib/*.js` を直接 import**。自分の `/api/*` を HTTP で呼ばない | 自己 HTTP 呼び出しは往復とコールドスタートを 2 倍にする |
| データ更新（クライアント） | **既存 `/api/*`（Functions）を `lib/api/` 経由で `fetch`**。**Server Actions は使わない**（当面） | 書き込み責任と CSRF/認証は Functions 側に一本化されている（並行稼働ルール） |
| スタイル | **CSS Modules ＋ グローバルのトークン（`styles/`）**。Tailwind・CSS-in-JS は入れない | 現行 `styles.css` のトークンと部品をそのまま移す。「見た目は作り直さない」 |
| フォント | **`next/font`** で自己ホスト | `fonts.googleapis.com` への依存を切り、CSP を縮める |
| i18n | **自前の薄い `t()`**（`messages/<lang>/<ns>.json`・`{name}` 置換）。ライブラリは入れない | 現行辞書（4,900 行・`{name}` 記法）を無変換で移せる。複数形・ICU が要る日が来たら再検討 |
| 言語の保持 | **Cookie `kimaru_lang`**（旧 localStorage から移行）。URL に `/en/` は入れない | サーバー描画で言語を決めるため。URL は変えない（`/b/{slug}` は配布済み） |
| 状態管理 | React の state と URL だけ。グローバルストアは入れない | 画面ごとに閉じる。サーバー状態はサーバーコンポーネントが持つ |
| 画像 | `next/image`。外部は `images.remotePatterns` に列挙（Google のアバター等） | Next 16 は `images.domains` 廃止 |
| 型付きリンク | `typedRoutes: true` | `href` の打ち間違いをコンパイルで止める |
| React Compiler | **当面 OFF** | Babel 経由でビルドが遅くなる。効果を測ってから |
| lint / format | **ESLint（flat config・`eslint-config-next`）＋ Prettier** | Next 16 は `next lint` 廃止・`next build` は lint しない |
| テスト | **unit = `node:test`（`tsx --test`）／e2e = `@playwright/test`** | 軽量・フレームワーク無しの方針を継続。React 部品は e2e で見る |
| 本番 | Netlify（Next.js ランタイム）。移行完了まで変えない | #396。AWS への移設は P6 で再評価 |

---

## 1. フォルダ構造

```text
kimaru/
├── app/                        # ルート＝URL。ページ・レイアウト・ルートハンドラ「だけ」置く（ロジックを持たない）
│   ├── globals.css             # styles/tokens.css・base.css を import する入口（グローバル CSS の import はルートレイアウトだけ）
│   ├── fonts.ts                # next/font（Noto Sans JP の自己ホスト・--font-noto-sans-jp）
│   ├── (public)/               # 認証不要・**静的生成**。ルートレイアウト①（lang は ja 固定・Cookie を読まない・CSP は静的ポリシー）
│   │   ├── layout.tsx
│   │   ├── page.tsx            #   /（#418）
│   │   ├── plan/page.tsx       #   /plan
│   │   ├── terms/page.tsx …
│   │   ├── not-found.tsx       #   404（#424）
│   │   └── guide/
│   │       ├── page.tsx
│   │       └── _components/    #   このルートでしか使わない部品（先頭 _ は非ルート）
│   ├── (dynamic)/              # **動的描画**。ルートレイアウト②（Cookie の言語で <html lang>・CSP は proxy.ts の nonce）
│   │   ├── layout.tsx
│   │   ├── (auth)/             #   login / signup / reset-password（未ログイン専用）
│   │   ├── (guest)/            #   ゲスト向け: b/[slug] p/[token] u/[slug] manage-booking answer-question
│   │   ├── (app)/              #   ログイン後。layout.tsx で認証必須にする（proxy.ts と二重で守る）
│   │   │   ├── layout.tsx
│   │   │   └── dashboard/page.tsx …
│   │   ├── (operator)/         #   運営コンソール（kimaru_admin_session・別レイアウト・dark）
│   │   └── dev/                #   開発用の確認ページ（KIMARU_DEV_ROUTES=1 のときだけ。本番は 404）
│   ├── _legacy/                # 旧 HTML を返す暫定（#412）。段階1 で削除
│   ├── route.ts                # / → 旧 LP（#412）。#418 で削除
│   └── [...path]/route.ts      # 未マッチ → 旧 404（#412）。#424 で削除
├── components/                 # 画面に依存しない再利用部品
│   ├── ui/                     #   Button / Panel / Field / Modal / Badge …（トークンだけで描ける最小部品）
│   └── layout/                 #   SiteHeader / SiteFooter / Nav / LangSwitch
├── features/                   # 画面（業務）ごとの部品とロジック。1 機能 1 フォルダ
│   ├── booking/                #   予約ページ（WeekGrid・SlotList・BookingForm・availability の型）
│   ├── contacts/               #   相手管理（一覧・並び替え・検索）
│   ├── dashboard/  meeting/  profile/  settings/  booking-settings/  guide/  operator/ …
│   └── <feature>/
│       ├── components/         #   その機能の部品（Client/Server どちらも）
│       ├── api.ts              #   /api/* 呼び出し（Zod スキーマ付き）
│       ├── types.ts
│       └── *.test.ts           #   純ロジックの単体テスト（同じ場所に置く）
├── lib/                        # 横断の共通ロジック（React に依存しない）
│   ├── csp.ts                  #   セキュリティヘッダーと CSP の唯一の出どころ（DYNAMIC_ROUTES もここ）
│   ├── server/                 #   サーバー専用（先頭で import "server-only"）。session / legacy（_lib への橋渡し）/ env
│   ├── api/                    #   クライアント用の fetch ラッパー（同一オリジン・Zod・ApiError）
│   ├── i18n/                   #   t() / 辞書ローダー / 言語 Cookie
│   ├── plan.ts                 #   プラン判定（free/pro/premium）の 1 か所
│   ├── sanitize.ts             #   リッチテキストの allowlist サニタイズ（唯一の HTML 出力経路）
│   └── date.ts                 #   JST 表示・週計算など純関数
├── messages/                   # i18n 辞書。{ja,en,zh-TW}/<namespace>.json（キー集合は 3 言語で同一）
├── styles/                     # tokens.css（:root の変数）・base.css（reset・タイポ）・utilities.css（.shell 等）
├── types/                      # 手書きの型宣言（netlify/functions/_lib の .d.ts、環境変数の型）
├── tests/
│   └── e2e/                    # Playwright（@playwright/test）。*.spec.ts・fixtures/（API モック）
├── proxy.ts                    # 認証ゲート・CSP nonce・言語判定（旧 Edge auth-gate の後継。段階2 で作る）
├── next.config.ts  tsconfig.json  eslint.config.mjs  .prettierrc
├── public/                     # 旧サイト（移行中は触らない）＋ favicon 等の静的資産
├── netlify/functions/          # 既存 API（CommonJS）。当面そのまま。段階5 の後に 1 本ずつ TS 化
├── scripts/                    # shoot.mjs（スクショ）・test/（旧ページ用。旧が消えるまで維持）
└── docs/                       # 仕様・決定ログ（本書を含む）
```

### 置き場所の判定ルール

1. **URL を持つものだけ `app/`**。`page.tsx` は「データを取って部品に渡す」だけの薄い関数にする（目安 60 行）。
2. **1 つのルートでしか使わない部品は、そのルート直下の `_components/`**。2 か所目で使った時点で `features/<feature>/components/` へ**昇格**する。
3. **画面（業務）の語彙を持つものは `features/`**、持たないものは `components/`（例: `WeekGrid` は booking の語彙 → features、`Button` は語彙なし → components）。
4. **React を import しないものは `lib/`**。`lib/` から `features/` や `app/` を import しない（依存は `app → features → components/lib` の一方向）。
5. **秘密情報・DB・Cookie の検証に触るものは `lib/server/`** に置き、先頭に `import "server-only";` を書く（Client から import するとビルドが落ちる＝仕組みで守る）。
6. ルートグループは **認証区分と描画方式**を表す。`(public)` は静的生成（ルートレイアウト①）、`(dynamic)` 配下の `(auth)` `(guest)` `(app)` `(operator)` は動的描画（ルートレイアウト②）。ルートレイアウトが 2 つあるのは、静的ページで Cookie を読まないため（読むと配下すべてが動的になる）。**動的ページを足したら `lib/csp.ts` の `DYNAMIC_ROUTES` にパスを足す**（proxy.ts が nonce を付ける対象になる）。新しい画面はどれかに入れる。グループを増やすときは本書を直す。

---

## 2. 命名規則

| 対象 | 規則 | 例 |
|---|---|---|
| フォルダ | kebab-case。ルートは URL と同じ語 | `booking-settings/`、`features/contacts/` |
| Next の特別ファイル | Next の規約どおり小文字固定 | `page.tsx` `layout.tsx` `loading.tsx` `error.tsx` `not-found.tsx` `route.ts` `default.tsx` |
| コンポーネント | **PascalCase.tsx**、1 ファイル 1 コンポーネント（小さな内部部品は同ファイル可）。ファイル名＝コンポーネント名 | `WeekGrid.tsx` → `export function WeekGrid()` |
| CSS Modules | コンポーネントと同名で隣に置く | `WeekGrid.module.css` |
| フック | `useXxx.ts` | `useSlotSelection.ts` |
| それ以外のモジュール | kebab-case.ts | `session-cookie.ts` `plan-limits.ts` |
| テスト | 対象と同じ場所に `*.test.ts`（unit）／`tests/e2e/*.spec.ts`（e2e） | `date.test.ts` `booking.spec.ts` |
| 型 | PascalCase。Props は `XxxProps`。`I` 接頭辞は付けない | `type WeekGridProps = {...}` |
| 関数・変数 | camelCase。真偽値は `is/has/can`、イベントは props が `onXxx`、実装が `handleXxx` | `isPro` `onSelect` `handleSelect` |
| 定数 | モジュール直下の不変リテラルだけ UPPER_SNAKE | `MAX_QUESTIONS` |
| enum | **使わない**。文字列リテラルの union ＋ `as const` の配列 | `type Plan = "free" \| "pro" \| "premium"` |
| export | **名前付き export**。default は Next が要求するファイル（page/layout 等）だけ | |
| i18n キー | 現行と同じ `<ns>.<path>`（`bs.` `dash.` `pf.` …）。namespace ＝ JSON ファイル名 | `messages/ja/dash.json` の `{"todo.title": ...}` → `getT("dash")` / `useT("dash")` で `t("todo.title")` |
| CSS クラス | CSS Modules は camelCase（`styles.slotList`）。グローバルは現行の kebab-case を維持（`.shell` `.panel` `.button`） | |
| データ属性 | e2e の目印は `data-testid="..."`（kebab-case）。スタイルに使わない | |

---

## 3. TypeScript

- `strict` と `noUncheckedIndexedAccess` は外さない。`any` 禁止（lint）。分からない型は `unknown` で受けて絞る。
- **`as` によるキャストは境界でだけ**（Zod の `parse` の代わりに使わない）。`!`（non-null assertion）は使わず、`?? ` か早期 return で扱う。
- `type` を既定にし、`interface` は拡張（`extends`）が要るときだけ。
- 外部から来る値（`/api/*` の応答・`searchParams`・フォーム入力・Cookie）は **Zod スキーマで検証してから**使う。スキーマは `features/<f>/api.ts` か `lib/` に置き、型はスキーマから `z.infer` で作る（型とスキーマを二重に書かない）。
- 環境変数は `lib/server/env.ts` の `required()` / `optional()` 経由でだけ読む（`process.env` 直読み禁止・Functions の `_lib/config.js` と同じ思想）。`NEXT_PUBLIC_` は原則作らない。
- `import type` を使う（lint で強制）。循環 import を作らない（`app → features → components/lib` の一方向）。
- 型検査は `npm run typecheck`（`next typegen && tsc --noEmit`）。Next が生成する `PageProps<"/b/[slug]">` `LayoutProps` `RouteContext` を使い、`params`/`searchParams` は **Promise なので必ず `await`**。

---

## 4. React / Next の書き方

### サーバーとクライアントの境界
- **既定はサーバーコンポーネント**。`"use client"` は「ブラウザの状態・イベント・効果」が要るファイルにだけ、**できるだけ葉に近い部品**に付ける（週グリッド・フォーム・Modal など）。ページ全体を client にしない。
- Client へ渡す props はシリアライズ可能な値だけ（`Date` は ISO 文字列にして渡す）。Server の部品は `children` として Client の部品に渡せる。
- Context は Client 側の `Provider` 部品に閉じ込め、必要な深さで巻く（言語辞書・プランは Provider で配る）。

### データ取得
- **サーバー**: `page.tsx` / `layout.tsx` で `lib/server/*` を `await` して取る。同じデータを複数箇所で使うときは `React.cache()` で 1 リクエスト内の重複を消す。
- **クライアント**: 操作に応じた再取得だけ（`lib/api/` の `fetch`）。初期表示のためにクライアントで取らない。
- **キャッシュの段階設定**: `(public)` は静的（既定で静的になるよう `cookies()`/`headers()` を呼ばない）。`(guest)` `(app)` `(operator)` は動的（Cookie を読む時点で自動的に動的になる。明示したければ `export const dynamic = "force-dynamic"`）。`fetch` は既定で非キャッシュ。`revalidateTag` は使わない（使う日が来たら第 2 引数が必須になった点に注意）。

### 更新（フォーム）
- フォームは Client 部品で `lib/api/` 経由に `/api/*` へ `fetch`（`credentials: "same-origin"`・`content-type: application/json`）。**Server Actions は使わない**（0 章）。
- 送信中・失敗・成功の 3 状態を必ず持つ（`useState` で足りる。`useActionState` は Server Actions 用なので使わない）。
- 送信後の画面更新は `router.refresh()`（サーバー描画部分の再取得）か、再取得した値で state を更新。`window.location` の再読み込みはしない。

### ルーティング・リンク
- 内部リンクは `next/link`（`typedRoutes` で型付き）。外部は `<a target="_blank" rel="noopener noreferrer">`（lint で強制）。
- 旧ページへのリンク（移行が済むまで）は `<a href="/xxx.html">`（`next/link` はプリフェッチで旧 HTML を取りに行くので使わない）。
- `redirect()` `notFound()` はサーバー側で、`try/catch` の外で呼ぶ。存在しない `/b/{slug}` は `notFound()`。
- `params` `searchParams` は Promise。`searchParams` は Zod で検証してから使う。

### レイアウト・メタデータ・エラー
- `<head>` を手書きしない。`metadata` / `generateMetadata` で出す（title は「キマル | 〜」の現行規則）。
- 各グループに `error.tsx` と `loading.tsx` を置く。`error.tsx` は利用者向けの日本語（i18n）と「再読み込み」だけ。スタックは出さない。
- `<html lang>` は Cookie の言語。`data-scroll-behavior="smooth"` は付けない（Next 16 は既定でスムーズスクロールを上書きしない）。

### 禁止
- `innerHTML` `outerHTML` `insertAdjacentHTML` `dangerouslySetInnerHTML`（lint で error）。例外は `lib/sanitize.ts` を通した **`components/ui/RichText.tsx` の 1 か所**だけ（`eslint-disable-next-line` に理由を書く）。
- **`style` 属性**（`style={{...}}`）。動的ページの CSP は `style-src` に `'unsafe-inline'` が無いので効かない（lint で error）。CSS Modules のクラスで書く。旧 HTML には 232 か所あるが、移すときにクラスへ直す。
- `document.querySelector` 等の DOM 直接操作（`ref` で足りる）。`useEffect` でのデータ取得。`window` をサーバー部品で触る。
- 並列ルート（`@slot`）と intercepting ルートは使わない（Next 16 では `default.tsx` 必須で複雑になる。要らない）。

---

## 5. データアクセス

```text
ブラウザ ──fetch──▶ /api/*（Netlify Functions・CommonJS・書き込み責任はここ）──▶ Supabase
   ▲                                                                          ▲
   │ HTML                                                                     │
Next サーバー（page.tsx）──▶ lib/server/*（import "server-only"）──▶ netlify/functions/_lib/*.js ─┘
```

- **読み取り（サーバー描画）**: `lib/server/<domain>.ts` が `netlify/functions/_lib/supabase.js` 等を **直接 import** して呼ぶ（自分の `/api/*` を HTTP で呼ばない）。`_lib` は JS なので、必要な関数だけ `types/legacy-lib.d.ts` に型を手書きする。Netlify の Functions と同じ環境変数が Next の関数にも入る。
- **セッション**: `lib/server/session.ts` が `cookies()` から `kimaru_session` を読み、`_lib/crypto.js` と同じ検証をする（#425・鍵と形式は完全互換）。Client には「ログイン済みか・プラン・表示名」だけを渡す（`owner` の行をそのまま渡さない）。
- **書き込み**: 既存 `/api/*` だけ。新しい書き込み API が要るときも **Functions に作る**（CommonJS。Functions の TS 化は段階5 の後）。Next の Route Handler で DB に書かない。
- `lib/api/client.ts`: `apiGet` / `apiPost`（同一オリジン固定・JSON・`ApiError`（status・code・message）を投げる・応答を Zod で検証）。画面は `ApiError.code` を i18n キーに引く。

---

## 6. i18n

- 辞書は `messages/{ja,en,zh-TW}/<ns>.json`（33 namespace・1,572 キー×3）。**旧 `public/i18n.js` が正本である間は生成物**で、`npm run i18n:split`（`scripts/i18n/split.mjs`）で再生成する。手で編集しない。`messages/index.ts`（言語×namespace の遅延 import）と `messages/keys.ts`（キーの union 型）も同時に生成される。旧 i18n.js を消す段階（#454）で `messages/` が正本になる。
- **3 言語でキー集合が同一**、かつ**生成物が旧 i18n.js と差分ゼロ**を `lib/i18n/messages.test.ts` が固定する（旧 `scripts/test/unit.mjs` の対称性テストは旧ページが残る間は併走）。
- サーバー: `const t = await getT("dash"); t("todo.title")`（`lib/i18n/server.ts`・Cookie の言語で namespace を読む）。クライアント: `getMessages(["dash", "nav"])` の結果を `I18nProvider` に渡し、部品は `const t = useT("dash")`（`lib/i18n/client.tsx`）。Provider には**画面が使う namespace だけ**を渡す（言語×画面ぶんだけ配信）。
- 置換は `{name}` 記法（現行と同じ）で `t("metaFrom", { name })`。**HTML は入れない**（`t()` の戻りは文字列として描く。強調が要るなら要素を分ける）。
- キーは型で守る（`messages/keys.ts`）。無いキーはコンパイルエラー。動的なキーが未定義だった場合は `ns.key` を返して落ちない（開発時は警告）。
- 既定言語は ja。**ブラウザの `Accept-Language` では切り替えない**（旧 `pickLanguage` と同じ挙動。切り替えは利用者の明示操作だけ）。フォールバックは active → ja → en（旧 `t()` と同じ）。空文字は「意図的に空」として尊重する。
- **JA 据え置き**（翻訳しない）は現行どおり: 法務 3 ページ・運営コンソール・占いベースの相手分析・ルールベース提案の本文。
- 言語の保持は Cookie `kimaru_lang`（`Path=/`・1 年・`SameSite=Lax`・HttpOnly にしない）。切替は `useSetLang()`（Cookie と旧ページ用の localStorage `kimaru.language` の両方に書いて `router.refresh()`）。旧 `i18n.js` も Cookie を最優先で読む（#414）。URL に言語を入れない。

---

## 7. スタイル

- **トークンが唯一の出どころ**: `styles/tokens.css` の `:root` 変数（`--accent` 朱・`--ink`・`--line`・`--fs-*`・`--radius`・`--shadow` …。現行 `styles.css` の値を**そのまま**移す）。色・余白・文字サイズをコンポーネントに直書きしない。
- 部品のスタイルは **CSS Modules**（`X.module.css`）。グローバルは `styles/`（reset・タイポ・`.shell` `.panel` `.button` などの既存クラス）だけ。`app/globals.css` 以外でグローバル CSS を import しない。
- 命名は現行のまま（`.panel` `.button.primary` `.eyebrow` `.lead` …）。**見た目を変えない移行**なので、旧 CSS を「動かす」だけで済むことを優先する。
- レスポンシブは現行の閾値（`620px` / `900px` / `1180px`）を `styles/tokens.css` にコメントで固定。メディアクエリの順序で上書きが効かなくなる事故（#353）を避けるため、**同じ部品の狭幅ルールは同じ Module に、広幅の後に書く**。
- プレミアム面だけオーロラ（`.aurora` `.premium-surface`）。必ず `@media (prefers-reduced-motion: reduce)` で止める。無料・Pro 面は静的。
- フォントは `next/font`（`app/layout.tsx` で `className` を `<html>` に付ける）。`<link href="https://fonts.googleapis.com">` は書かない。
- 角丸・線・影はトークンの既定値に従う（デザインの方針は `docs/` と `frontend-design` スキルの運用に従う。画面を新しく作るときはそちら）。

---

## 8. セキュリティ

### CSP は 2 モード（決定）
| ルートグループ | 描画 | CSP |
|---|---|---|
| `(public)`（LP・料金・法務・ガイド・404） | **静的生成**（CDN 配信・最速） | `script-src 'self' 'unsafe-inline'` を**当面許容**（Next の hydration 用インラインが nonce を持てないため）。ユーザー入力を描かないので影響は限定的。`experimental.sri`（hash 化）が安定したら外す（#453 で再評価） |
| `(auth)` `(guest)` `(app)` `(operator)` | **動的描画** | **nonce**（`proxy.ts` が要求ごとに生成し `x-nonce` と `Content-Security-Policy` に載せる。Next が自動で `<script nonce>` を付ける）。`script-src 'self' 'nonce-…' 'strict-dynamic'`、`style-src 'self' 'nonce-…'`、`connect-src 'self'`、`frame-ancestors 'none'`、`form-action 'self'`、`object-src 'none'`、`base-uri 'self'`。開発時だけ `'unsafe-eval'` |

- nonce を要求ごとに変える以上、**動的ページは CDN にキャッシュされない**。それでよい（ユーザーデータを描くページはもともとキャッシュしない）。
- `'strict-dynamic'` は**当面付けない**。Edge の `auth-gate.js` が全 HTML に `/usage.js` を注入しており、nonce の無い外部スクリプトが止まるため。`script-src 'self' 'nonce-…'` で同一オリジンの外部スクリプトは許し、インラインだけ nonce 必須にする。Edge を撤去する #452 で `'strict-dynamic'` を再検討。
- 値の出どころは `lib/csp.ts` の 1 か所（`STATIC_CSP` / `nonceCsp()` / `SECURITY_HEADERS` / `DYNAMIC_ROUTES`）。`netlify.toml` と同値であることを `lib/csp.test.ts` が照合する。
- `proxy.ts` の `matcher` は **必ず除外パターンを持つ**（`_next/static` `_next/image` `favicon.ico` と `public/` の旧資産）。除外を忘れると旧サイトの CSS/JS が止まる。
- 他のヘッダー（`X-Frame-Options` `X-Content-Type-Options` `Referrer-Policy` `HSTS` `Permissions-Policy`）は `next.config.ts` の `headers()`（静的）と `proxy.ts`（動的）で**同じ値**。値を変えるときは `netlify.toml` も含め 3 か所を同時に直す（段階5 で 1 か所に寄せる）。

### そのほか
- Cookie は Functions が発行する（`HttpOnly` `Secure` `SameSite=Lax`）。Next 側は**読むだけ**（`proxy.ts` と `lib/server/session.ts`）。
- **認証は二重に**: `proxy.ts` で未ログインを弾き、さらに `(app)/layout.tsx` でもセッションを確認する（`proxy` の `matcher` 漏れに備える）。
- 外部から来た値は Zod で検証（3 章）。リッチテキストは `lib/sanitize.ts`（allowlist・保存前と表示時の両方）を通す。
- 秘密情報は `lib/server/`（`server-only`）の外に出さない。`NEXT_PUBLIC_` に秘密を入れない。ログに文字起こし・要約・トークンの生値を出さない。
- `poweredByHeader: false`。`images.remotePatterns` は必要なホストだけ。`target="_blank"` には `rel="noopener noreferrer"`。
- 依存の脆弱性は Dependabot（#413）。`npm audit` の high 以上を放置しない。

---

## 9. テスト

| 種類 | 対象 | 道具 | 置き場所 | 実行 |
|---|---|---|---|---|
| unit | React に依存しない純ロジック（日付・枠計算・i18n・サニタイズ・Cookie 検証・Zod スキーマ） | `node:test`（`tsx --test` で TS と `@/` を解決） | 対象の隣 `*.test.ts` | `npm run test:unit` |
| e2e | 画面（表示・操作・3 言語・レスポンシブ・JS 例外なし・残ダミーなし） | `@playwright/test` | `tests/e2e/*.spec.ts` | `npm run test:e2e`（`next build && next start` に対して） |
| 型 | すべて | `next typegen && tsc --noEmit` | — | `npm run typecheck` |

- React 部品の単体テスト（jsdom・testing-library）は**入れない**。部品は e2e で見る（非同期サーバーコンポーネントは単体テストの道具が追いついていない）。
- e2e は現行 `scripts/test/e2e.mjs` の考え方を引き継ぐ: **`/api/**` は `page.route` でモック**（実 DB に繋がない）、**ダミー文言が残っていない**、**コンソールに JS 例外がない**、**iPhone 12（390×664）とデスクトップの両方**。`data-testid` で要素を取る。
- 移行した画面は、旧の e2e（`scripts/test/e2e.mjs` の該当節）を**削除**し、新の spec を足す。旧の e2e は旧ページが 1 枚でも残る間は残す。
- テストが無いロジックを `lib/` に入れない（純関数はテストが最も安い場所）。
- スクショ: PR には `scripts/shoot.mjs`（`next start` 対応版・#454 で整備）のデスクトップ・モバイル画像を添える。

---

## 10. lint・format・型検査

- `eslint.config.mjs`（flat）: `eslint-config-next/core-web-vitals` ＋ `eslint-config-next/typescript` ＋ `eslint-config-prettier/flat` ＋ 本プロジェクトの禁止ルール（`innerHTML` 系・`dangerouslySetInnerHTML`・`enum`・`any`・`import type` 強制・`netlify/functions` の直 import は `lib/server/` 以外で禁止）。
- `.prettierrc`: 2 スペース・ダブルクォート・セミコロンあり・`printWidth` 100・`trailingComma: "all"`（Functions 側の既存コードと同じ見た目）。
- スクリプト: `npm run lint` / `npm run lint:fix` / `npm run format` / `npm run format:check` / `npm run typecheck`。**PR ごとに CI で全部回す**（#413）。lint を `eslint-disable` で黙らせるときは `--` の後に理由を書く。
- 対象は `app/ components/ features/ lib/ types/ tests/ proxy.ts next.config.ts`。`public/`・`netlify/`・`scripts/` は対象外（旧スタック）。

---

## 11. コメントとドキュメント

- コメントは**日本語**で「**なぜ必要か**（どの不具合・仕様のためか。issue 番号）」と「**何をしているか**（非自明な条件・順序・境界。素直に書くとなぜ壊れるか）」を書く。自明な処理の逐語訳は書かない（`CLAUDE.md` の慣習をそのまま）。
- 各モジュールの冒頭に 1〜3 行で役割を書く。`lib/` の export 関数には JSDoc（引数の単位・例外・副作用）。
- 画面を 1 つ移すたびに: `docs/screen-flow.md` の「配信」列を更新、`docs/features/` の該当ファイルに「実装: `app/...`」を追記、旧 e2e を消して新 spec を足す。
- 規約の変更は本書 → `CLAUDE.md` の要点 → コードの順。本書の末尾「変更履歴」に 1 行。

---

## 12. 旧サイトとの同居ルール（移行が終わるまで）

- **旧ページ（`public/*.html` `app.js` `i18n.js`）に新機能を足さない**。不具合の修正だけ。新しい画面・機能は `app/` に作る。
- **1 ページ＝1 issue＝1 PR**。PR 本文は「症状／原因／修正／確認したこと／残る穴」＋スクショ。
- 移したページは同じ PR で: `public/<x>.html` を削除 → `next.config.ts` の `redirects()` に `/<x>.html → /<x>`（**301・クエリ引き継ぎ**）→ 他ページからのリンクを更新 → `docs/screen-flow.md` の配信列を「Next」に。
- **URL を変えない**: `/b/{slug}` `/p/{token}` `/u/{slug}` `/api/*` `/.well-known/*`、OAuth の redirect URI、Webhook の受信 URL、`/pro-thanks.html`（Square の戻り先。**同じパスで応答し続ける**）。送信済みメールの `manage-booking.html?k=` と旧形式 `?id=&t=` は動く状態を保つ。
- `netlify.toml` の書き換え（`/b/*` 等）は、その画面を Next に移す PR で新ルートへ向ける（切り戻しは 1 行）。
- DB スキーマはこの作業で触らない。Functions（`/api/*`）も画面移行の PR では触らない（触るなら別 PR）。
- 本番デプロイは明示指示があったときだけ（公開ロックの解除 → deploy → 施錠）。

---

## 13. Next 16 で変わった点（規約に効くもの）

1. `middleware.ts` → **`proxy.ts`**（関数名も `proxy`。Node.js 実行のみ・変更不可）。
2. **`next lint` 廃止**・`next build` は lint しない → ESLint CLI と flat config。
3. **Turbopack が既定**（dev/build）。`webpack` 設定を書くとビルドが失敗する。
4. `cookies()` `headers()` `params` `searchParams` は**非同期のみ**（同期アクセスは削除）。
5. キャッシュは 2 モデル。本プロジェクトは**既定モデル**（`cacheComponents` 無し）。`revalidateTag` は第 2 引数必須。
6. `next-env.d.ts` は **gitignore**（Next が管理）。`next typegen` で型生成。
7. `typedRoutes` は安定・トップレベル設定。
8. `next/image` の既定が厳しくなった（`qualities` は `[75]`・`images.domains` 廃止 → `remotePatterns`）。
9. 並列ルートは `default.tsx` 必須（使わない）。
10. `next dev` は `.next/dev` に出力し、`CLAUDE.md` 末尾に `nextjs-agent-rules` ブロックを自動追記する（コミットしておく）。同梱ドキュメントは `node_modules/next/dist/docs/`。

---

## 14. 未決定・見直し予定

| 論点 | いつ |
|---|---|
| 公開ページの CSP から `'unsafe-inline'` を外す（`experimental.sri` の安定待ち） | #453（段階5）で再評価 |
| React Compiler を有効にするか | 段階4 で画面が揃ったら計測して判断 |
| i18n ライブラリ（next-intl 等）への切替 | 複数形・ICU・日付書式が要る画面が出たとき |
| Server Actions の採用 | Functions の TS 化が終わり、書き込み責任を Next 側へ移す判断のとき |
| `features/` の粒度（現行 30 画面ぶんの分割案） | 段階3〜4 で実物に合わせて調整（本書の tree を更新） |

## 変更履歴

- 2026-09-04 初版（#416）。
- 2026-09-04 1・4・8 章: ルートレイアウトを `(public)`（静的）と `(dynamic)`（動的）の 2 つに、`style` 属性を禁止、`'strict-dynamic'` は Edge 撤去まで保留、CSP の正本は `lib/csp.ts`（#415）。
- 2026-09-04 6 章: 辞書は `public/i18n.js` からの生成物、`Accept-Language` は使わない（旧と同じ）、t() の呼び方を実装に合わせた（#414）。
