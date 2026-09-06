# キマル 画面一覧・アクター別アクセス権

最終更新: 2026-06-09

画面・URL の詳細・**4アクター別の番号付き一覧とヘッダー戦略**は [`screens.md`](./screens.md)、API は [`api.md`](./api.md)、DB は [`db-schema.md`](./db-schema.md)。本書はアクセス権マトリクスと主要フローに焦点を当てる。

---

## 1. アクター（5属性）

| 記号 | アクター | 説明 |
|---|---|---|
| **無登録** | 未登録ユーザー | アカウントを持たない。予約URLから予約する相手（ゲスト）含む |
| **無課金** | 登録・無料プラン | 登録済みで無料版を利用 |
| **課金者** | 登録・有料プラン（Pro） | ¥980/月 を支払い、有料機能を利用 |
| **猫メンバー** | 登録・Cat Key 適用 | 猫の集会メンバー。**有料機能を無料で利用**（≒課金者と同権限） |
| **運営** | サービス運営者 | 運営コンソールを使う提供側 |

> 「猫メンバー」は権限上は課金者と同等（有料機能が使える）。違いは課金の有無と、運営が承認・降格できる点（[features/19](./features/19-cat-key-admin.md) / [22](./features/22-admin-console.md)）。

---

## 2. 画面一覧

| # | URL | 画面名 | 認証 | 区分 | 配信（2026-09 移行中） |
|---|---|---|---|---|---|
| 1 | `/` | トップ / ランディング | 不要 | 公開 | **Next**（#418・静的生成） |
| 2 | `/plan`（旧 `/plan.html` → 恒久リダイレクト） | 料金・プラン（旧Pro版紹介） | 不要 | 公開 | **Next**（#419・静的生成） |
| 3 | `/signup.html` | 無料登録 | 不要 | 公開 | 旧（public/） |
| 4 | `/login.html` | ログイン（メール+PW / Google） | 不要 | 公開 | 旧（public/） |
| 5 | `/dashboard.html` | ホーム（ログイン後ハブ） | 要ログイン | ユーザー | 旧（public/） |
| 6 | `/contacts.html` | 相手管理（予約一覧・面談メモ） | 要ログイン | ユーザー | 旧（public/） |
| 7 | `/booking-settings.html` | 予約設定 | 要ログイン | ユーザー | 旧（public/） |
| 8 | `/profile.html` | プロフィールシート | 要ログイン | ユーザー | 旧（public/） |
| 9 | `/ai-assist.html` | AIアシスト | 要ログイン | ユーザー（有料） | 旧（public/） |
| 10 | `/square.html` | Pro版決済（Square） | 要ログイン | ユーザー | 旧（public/） |
| 11 | `/operator-login.html` | 運営ログイン（共有キー → 運営セッション発行） | 共有管理キー | 運営 | 旧（public/） |
| 12 | `/cat-key-admin.html` | 運営コンソール（Cat Key・ユーザー管理） | 運営セッション | 運営 | 旧（public/） |
| 13 | `/operators.html` | 運営者管理（運営アカウントの一覧・追加・削除） | 運営セッション | 運営 | 旧（public/） |
| 14 | `/analytics.html` | 分析ダッシュボード（利用状況・転換率・定着の集計） | 運営セッション | 運営 | 旧（public/） |
| 14 | `/booking.html`（`/b/{slug}`） | 予約ページ（ゲスト用） | 不要 | 公開 | 旧（public/） |
| 15 | `/guide`（旧 `/guide.html` は 308） | 使い方ガイド（機能一覧＋機能ごとのModal） | 不要 | 公開 | Next（#423） |
| 16 | `/terms`（旧 `/terms.html` は 308） | 利用規約 | 不要 | 公開（法務） | Next（#420） |
| 17 | `/privacy`（旧 `/privacy.html` は 308） | プライバシーポリシー | 不要 | 公開（法務） | Next（#421） |
| 18 | `/tokushoho`（旧 `/tokushoho.html` は 308） | 特定商取引法に基づく表記 | 不要 | 公開（法務） | Next（#422） |

> **配信列**: フロント刷新（#406〜#411）で画面を Next.js（`app/`）へ移すたびに「旧（public/）」→「Next」に更新する（規約 [`frontend-conventions.md`](./frontend-conventions.md) 11 章）。

---

## 3. アクセス権マトリクス

凡例: ✅ アクセス可 / − アクセス不可 / △ アクセス可だが制限 or 不要

| 画面 | 無登録 | 無課金 | 課金者 | 猫メンバー | 運営 |
|---|:---:|:---:|:---:|:---:|:---:|
| 1. トップ `/` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2. 無料登録 `/signup.html` | ✅ | △ 登録済 | △ 登録済 | △ 登録済 | − |
| 3. 予約ページ `/booking.html` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4. Pro紹介 `/plan.html` | ✅ | ✅ | △ 不要 | △ 不要 | ✅ |
| 5. 決済 `/square.html` | − | ✅ | △ 契約済 | △ 不要 | − |
| 6. ホーム `/dashboard.html` | − | ✅ | ✅ | ✅ | − |
| 7. 相手管理 `/contacts.html` | − | − Pro専用 | ✅ | ✅ | − |
| 8. 予約設定 `/booking-settings.html` | − | △ 無料制限 | ✅ | ✅ | − |
| 9. プロフィール `/profile.html` | − | △ 基本のみ | ✅ 高度版 | ✅ 高度版 | − |
| 10. AIアシスト `/ai-assist.html` | − | − | ✅ | ✅ | − |
| 11. 運営コンソール `/cat-key-admin.html` | − | − | − | − | ✅ |
| 14. 分析ダッシュボード `/analytics.html` | − | − | − | − | ✅ |

### △（制限）の中身

- **予約設定（無料制限）**: 予約ページ（日程調整URL）の保存数は無料2つ／有料・猫5つ（[24](./features/24-multiple-booking-pages.md)）、受付期間は無料2ヶ月／有料6ヶ月（[05](./features/05-booking-range.md)）、事前アンケートは無料2問／有料5問（[10](./features/10-questionnaire.md)）。
- **相手管理（Pro専用）**: 予約一覧・検索・面談メモ・印象スコア・予約履歴は **有料(Pro)のみ**（[plan-comparison.md](./plan-comparison.md) / [14](./features/14-customer-management.md)）。無料会員はロック表示＋アップグレード導線。サーバー側も `requireProOwner` で 403（`owner-bookings` / `appointment-log`）。
- **AIアシスト（Pro専用）**: 同上で有料(Pro)のみ。無料会員はロック表示。
- **プロフィール（基本／高度版）**: 基本入力は無料も可。色・太字・見出し・画像など高度版は有料（🔜 [17](./features/17-profile.md)）。
- **Pro紹介・決済（不要）**: 課金者・猫メンバーは契約/特典済みのため利用不要（アクセス自体は可）。

---

## 4. アクター別「使える画面」まとめ

| アクター | 使える画面 |
|---|---|
| **無登録** | トップ / 無料登録 / 予約ページ / Pro紹介 |
| **無課金** | 上記 ＋ 相手管理（基本）/ 予約設定（無料制限）/ プロフィール（基本）/ 決済（アップグレード） |
| **課金者** | 無課金の全画面 ＋ AIアシスト。各設定が有料上限まで解放 |
| **猫メンバー** | 課金者と同じ（決済は不要） |
| **運営** | 運営コンソール（Cat Key 一覧・取消/復元・監査） |

---

## 5. 主要フロー（テキスト）

- **無登録 → 登録**: トップ → 無料登録 or Googleログイン → ホーム（`/dashboard.html`）
- **無課金 → 課金者**: ホーム/ Pro紹介 → 決済（Square）→ 有料機能が解放
- **無課金 → 猫メンバー**: ホームで Cat Key 入力 →（運営承認 ※将来）→ 有料機能が無料で解放
- **ゲスト予約**: 予約URL受領 → 予約ページ → 空き枠選択 → アンケート/生年月日入力 → 予約確定 → Googleカレンダー＋Meet 発行
- **運営**: 運営ログイン（`/operator-login.html` で共有管理キー → 運営セッション発行）→ 運営コンソール → Cat Key 利用者一覧 → 承認/却下/取消(revoke)/復元(restore) → 監査ログ ＋ **運営者管理**（`/operators.html`：運営者アカウントの一覧・追加・削除。運営者は `owners` と別テーブル `operators`）

> 各画面の遷移は基本「ホーム（`/dashboard.html`）」がユーザーのハブ。そこから相手管理（`/contacts.html`）・設定系（予約設定・プロフィール・AIアシスト）へ分岐する。

## 6. 認証の実装（Edge Function ミドルウェア）

上記マトリクスは `netlify/edge-functions/auth-gate.js`（Netlify Edge Function）で実装する。

- **ルート保護（ユーザー）**：マトリクスで「無登録=−」のユーザー画面はログイン必須。未ログイン（`kimaru_session` Cookie 無）でアクセスすると `/login.html` へリダイレクト。
  - 対象: `/dashboard.html` `/contacts.html` `/booking-settings.html` `/profile.html` `/ai-assist.html` `/square.html`
- **運営の認証（ユーザーと完全分離）**：運営は専用ログイン `/operator-login.html` で共有管理キー（`ADMIN_SECRET`）を入力し、**運営専用セッション `kimaru_admin_session`**（ユーザーの `kimaru_session` とは別Cookie・別署名）を発行する。
  - 運営画面（`/cat-key-admin.html` / `/operators.html` / `/analytics.html`）は **`kimaru_admin_session` で保護**。無ければ `/operator-login.html` へリダイレクト（ユーザーの `/login.html` には送らない）。
  - 各運営APIも運営セッション（または互換のため Bearer 管理キー）で認可。運営者は `owners` ではなく `operators` テーブルで管理（一般ユーザー登録は不要）。
  - 将来: 共有キー → 運営者ごとのメール+パスワード（`operators.password_hash`）ログインへ拡張。
- **公開ページ**（無登録=✅）：`/` `/signup.html` `/booking.html` `/plan.html` `/login.html` `/reset-password.html` `/guide`（使い方ガイド。中身は操作の説明だけでユーザーのデータを含まないため、登録前でも読める。ヘッダーの導線自体はログイン時のみ）`/u/<slug>`（公開プロフィール）、法務（`/terms.html` `/privacy.html` `/tokushoho.html`）はそのまま表示。
- **ナビ出し分け**：全HTMLの `<body>` に `data-auth="authed|guest"` を注入し、CSS（`[data-auth] .app-only / .guest-only`）で表示制御（JSトグル廃止・チラつき無し）。
- 判定はCookie存在ベースの前段ゲート。**厳密な認可は各APIの署名検証**（`_lib/crypto.js` / `requireOwner`）＋運営キー（`ADMIN_SECRET`）が担保。
- プラン差（△の中身：無料2ヶ月/2問・有料の高度機能等）はページ内＋API側で制御。
