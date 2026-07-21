# キマル タスク一覧（人間タスク / 実装タスク）

最終更新: 2026-06-18

タスクを **👤 人間が行うタスク**（外部アカウント・購入・審査・法務・認証情報など、コードでは完結しないもの）と **💻 実装タスク**（コードで行う開発作業）に分けて管理する。
決定の根拠は [open-decisions.md](./open-decisions.md)、機能詳細は [features/README.md](./features/README.md)。

> 多くの実装タスクは、対応する人間タスク（鍵・ドメイン・外部設定）が完了しないと**動作確認できない**。依存は各項目に明記。

---

# 👤 人間が行うタスク

コード化できない／人間の判断・外部操作・契約が必要なもの。

## A. インフラ・ドメイン
- [x] **独自ドメインを取得** → 〔2026-06-18〕**`kimaru-co.jp` をお名前.comで取得**（メール用途・サーバー無し／名義 一般社団法人ぴんころ）。
- [ ] `kimaru-co.jp` を Netlify に接続し `APP_BASE_URL` を確定（DNS は Cloudflare 管理へ）。
- [ ] **Netlify 本番プロジェクト**の設定（デプロイ、Scheduled Functions 有効化）。
- [ ] **Supabase プロジェクト**を用意し、[`../supabase-schema.sql`](../supabase-schema.sql) を本番に適用（マイグレーション実行）。

## B. Google（ログイン・カレンダー）
- [ ] **Google Cloud Console** で OAuth クライアント作成（クライアントID/シークレット発行）。
- [ ] OAuth 同意画面の設定、**リダイレクトURI登録**（`{APP_BASE_URL}/api/google-auth-callback`）。
- [ ] **制限付きスコープ（カレンダー）のセキュリティ審査**を申請（プライバシーポリシー公開URLが前提・数週間想定）。

## C. メール（Resend）
- [ ] **Resend アカウント作成**、API キー取得 → **Pro($20/月)へアップグレード**（無料は100通/日上限）。
- [ ] **送信専用サブドメインを2つ**（取引=`notify` / 営業=`news`）登録し **SPF / DKIM / DMARC** を DNS 設定。送信元アドレス決定。
- [ ] **受信**: Cloudflare Email Routing で `info@` → 既存Gmail へ転送（コード不要）。

## C2. AIアシスト（OpenAI）
- [x] ~~OpenAI APIアカウント/キー~~ **不要**（決定31でMCP一本化・旧サーバLLMは撤去 2026-07-21。AIはユーザー自身の ChatGPT/Claude を接続）。

## D. 決済（Square）
- [ ] **Square アカウント作成**（本番）。
- [ ] サブスク商品 **¥980/月（1ヶ月トライアル）** と **プレミアム ¥2,200/月（トライアルなし）** を作成。プレミアムの plan variation id を `SQUARE_PREMIUM_PLAN_ID` に設定。
- [ ] **Webhook URL 登録**（`{APP_BASE_URL}/api/square-webhook`）、API キー・署名鍵取得。

## E. 環境変数（Netlify に設定）
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `APP_BASE_URL`
- [ ] `SESSION_SECRET` / `TOKEN_ENCRYPTION_KEY`（セッション署名・トークン暗号化）
- [ ] `ADMIN_SECRET`（運営コンソール用）
- [ ] メール: `RESEND_API_KEY` / `TRANSACTIONAL_EMAIL_FROM`(notify) / `MARKETING_EMAIL_FROM`(news) / `RESEND_WEBHOOK_SECRET` / `THANKYOU_CRON_SECRET`（or `CRON_SECRET`）
- [ ] Square: アクセストークン・署名鍵・`SQUARE_WEBHOOK_SHARED_SECRET`・¥980プランID・`SQUARE_PREMIUM_PLAN_ID`
- [ ] （任意）Zoom: `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`

## F. 法務・運用
- [x] [legal/](./legal/) ドラフトの**差し込み情報を確定**（一般社団法人ぴんころ／代表理事 内山 文雄／西本町 fabbit／インボイス T1030005019164／電話 080-6882-9783）。
- [ ] **法務3ページの最終確認（内山さん）** → 公開OK。※塩尻の修正（下記 💻 2026-06-18 フォローアップ）後に再確認。ChatGPT/Gemini 等でのセルフチェック含む。
- [x] 連絡先メールを確定 → **`info@kimaru-co.jp`**（法務3ページ反映済み）。⚠️ **要 Cloudflare Email Routing で `info@kimaru-co.jp` → 既存Gmail へ受信転送設定**（未設定だと受信できない）。
- [ ] **Cat Key の運用ルール**（最新コード管理・承認の判断基準・承認者）を決める。**Cat Key 2種（プロキー/マスターキー）**を誰に渡すかは内山さん判断。

## G. デザイン・コンテンツ（保留含む）
- [ ] デザイン最終決定（青構成ベース＋タケダ氏相談）・ロゴ（保留9）。
- [ ] 3言語の翻訳文言の最終確認（[features/15](./features/15-i18n.md)）。

---

# 💻 実装タスク（✅ 全完了・2026-06-09）

下記はすべて実装・PRマージ済みで、GitHub の `実装` ラベル issue は全クローズ。
ただし **本番動作には対応する人間タスク（env・外部設定）が前提**のものがある（「設定待ち」と表記）。

## 優先度 🔴 高（完了）
- [x] 受付期間 無料2ヶ月（[05](./features/05-booking-range.md)）
- [x] 複数の予約ページ `/b/{slug}`・保存数上限（[24](./features/24-multiple-booking-pages.md)）
- [x] 事前アンケートのゲスト表示＋回答保存（[10](./features/10-questionnaire.md)）
- [x] メール+パスワード認証＋**パスワード再設定・メール確認**（[25](./features/25-auth-architecture.md)・#72/#73）
- [x] プロフィールのサーバ保存（[17](./features/17-profile.md)）
- [x] 22分前リマインダー（[21](./features/21-reminder.md)）
- [x] 解約/降格時のデータ凍結・再昇格で復元（#174）
- [x] 誕生日メール自動送信の廃止（#180）

## 優先度 🟡 中（完了）
- [x] Cat Key 承認制 / 運営コンソール（[19](./features/19-cat-key-admin.md)/[22](./features/22-admin-console.md)）
- [x] **プレミアムプラン**判定・ゲーティング・Square連携（#191）　設定待ち: Square商品＋`SQUARE_PREMIUM_PLAN_ID`
- [x] Square トライアル課金の連携（[13](./features/13-plans.md)）　設定待ち: 👤D
- [x] 予約完了メール＋**メール経路分離/サプレッション**（[11](./features/11-notification-email.md)・#192）　設定待ち: 👤C
- [x] 占いインサイト高度化・生年月日非公開（[16](./features/16-birthday.md)・#20）
- [x] 無料版に相手管理（閲覧のみ）開放（#182）
- [x] 顧客管理拡張（印象スコア構造化・集約）（#175）
- [x] 高度プロフィール＋公開ページ（#176）　※画像アップロードは将来
- [x] 会員獲得の自動導線（サンキューメール）（#181）　設定待ち: 👤C・法務文面
- [x] **AIアシスト（MCP連携）**（[18](./features/18-ai-assist.md)・決定31）※旧サーバLLM（月300回上限）は撤去（2026-07-21）

## 優先度 ⚪ 低（完了）
- [x] 会員同士の相互質問（ゲスト→ホスト・最小実装）（[20](./features/20-member-mutual-questions.md)・#21）
- [x] Zoom 自動発行（[06](./features/06-location-type.md)・#23）　設定待ち: `ZOOM_*`
- [ ] 議事録アプリ連携（将来構想・[23](./features/23-meeting-minutes.md)）※暫定の汎用inbound webhookは誤動作防止のため削除（2026-07-21・#24廃止）
- [x] DBレガシー整理（非破壊・ドキュメント明示）（#25・[db-schema.md](./db-schema.md)）

> 未着手の実装タスクは現状なし。新規要望が出たら本セクションに追加する。

## 💻 2026-06-18 フォローアップ（実装・小修正）

打ち合わせ [`mtg/2026-06-18.md`](./mtg/2026-06-18.md) で出た塩尻側の修正・調査タスク。

- [x] **法務3ページの修正**〔2026-06-18〕: 特商法/規約から「¥2,200プラン」削除・連絡先メールを `info@kimaru-co.jp` へ・更新日を6/18に（`public/*.html` ＋ `docs/legal/*.md`）。
- [x] **サービスURL表記揺れ**: 「Appoint」綴り揺れは Netlify サブドメイン `apointkimaru.netlify.app` のこと。本番 `kimaru-co.jp` 接続で解消（`docs/legal/README.md` 反映）。公開法務HTMLにURL直書きは無し。
- [ ] **（運用）Netlify サイト/カスタムドメイン接続時**にサービスURLを `kimaru-co.jp` で確定（旧 netlify.app 表記は不要に）。
- [ ] **Zoom 連携の実装時**にプライバシーポリシー外部連携欄へ追記（現状は Google 連携のみ）。
- [ ] **OpenAI API 無料枠の調査・繋ぎ込みテスト**（実装段階で内山さんにカード登録依頼）。
- [ ] 全体デザインの仕上げ＋告知用チラシ（AI生成）作成。
- [x] **プラン段階 予約ページ 1/2/5 を確定・コード反映**（決定27）: `_lib/plan-limits.js`（PLAN_LIMITS集約）・`booking-page-save.js`・`_lib/plan-freeze.js`（3段階 `applyPlanLimits`）・`square-webhook.js`/`invite-apply.js`・`public/i18n.js`(ja/en/zh)・`booking-settings.html`。アンケートは2/5/5で従来どおり（変更なし）。
- [ ] **（運用/移行）既存Proの2ページ超の扱い**: 現状は grandfather（新規作成のみ上限2・プラン変更時に新上限へ凍結）。全Proを即時に2ページへ強制縮小したい場合は手動リコンサイル（SQL or 管理操作）が必要。要方針確定。
- [ ] **Cat Key 2種（プロキー=Pro / マスターキー=プレミアム）の実装**（現状は単一キー=Pro付与）。
- [x] **事前アンケートの選択式回答（決定27・2026-06-19・実装済）**: 無料=自由入力のみ／Pro・プレミアム=選択式（プルダウン/チェックボックス）も設定可。`questionnaire_questions.answer_type/options`＋`app.js`設定UI＋`booking-page-save.js`プラン検証＋`availability.js`/`booking-pages.js`配信＋`booking-week.js`ゲスト表示。
- [x] **相手の手動追加（決定27・2026-06-19・実装済）**: プレミアムのみ。`manual_contacts`＋`manual-contact.js`(`requirePremiumOwner`)＋`contacts.html`(`#manual-contact-form`/`.premium-feature`)、`owner-bookings.js` が相手一覧へマージ。
- [ ] 👤 **DB適用**: `supabase-schema.sql` の `questionnaire_questions.answer_type`/`options` と `manual_contacts` テーブルを dev/本番の両Supabaseに手動適用（未適用でも自由入力/空配列にフォールバック）。

---

## 依存関係の要点

| 実装タスク | 先に必要な人間タスク |
|---|---|
| Google ログイン／カレンダー連携の動作確認 | B（OAuthクライアント・審査）＋ E（環境変数） |
| 22分前リマインダー・予約完了メール | C（Resend・DNS） |
| Square トライアル課金 | D（Square設定・Webhook） |
| 本番公開全般 | A（ドメイン・Supabase適用）＋ F（法務ページ掲載） |

> コード実装は人間タスクの完了前でも進められる（ローカル/モックで開発）。ただし**本番動作確認**は対応する人間タスクが前提。
