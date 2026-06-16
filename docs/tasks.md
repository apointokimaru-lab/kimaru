# キマル タスク一覧（人間タスク / 実装タスク）

最終更新: 2026-06-09

タスクを **👤 人間が行うタスク**（外部アカウント・購入・審査・法務・認証情報など、コードでは完結しないもの）と **💻 実装タスク**（コードで行う開発作業）に分けて管理する。
決定の根拠は [open-decisions.md](./open-decisions.md)、機能詳細は [features/README.md](./features/README.md)。

> 多くの実装タスクは、対応する人間タスク（鍵・ドメイン・外部設定）が完了しないと**動作確認できない**。依存は各項目に明記。

---

# 👤 人間が行うタスク

コード化できない／人間の判断・外部操作・契約が必要なもの。

## A. インフラ・ドメイン
- [ ] **独自ドメインを取得**し、Netlify に接続。`APP_BASE_URL` を確定。
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
- [ ] **OpenAI APIアカウント作成**・APIキー取得・**使用量ハードリミット**設定（プレミアム用 GPT-5.4 Mini）。

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
- [ ] AIアシスト: `OPENAI_API_KEY` / `OPENAI_MODEL`(=gpt-5.4-mini) / `AI_ASSIST_MONTHLY_LIMIT`(=300)
- [ ] （任意）Zoom: `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`、議事録: `MEETING_NOTES_WEBHOOK_SECRET`

## F. 法務・運用
- [ ] [legal/](./legal/) ドラフトの**差し込み情報を確定**（運営者名・責任者・所在地・連絡先・管轄裁判所・制定日）。
- [ ] 利用規約・プライバシーポリシー・特商法表記の**法務レビュー**と**公開ページ掲載**。
- [ ] **Cat Key の運用ルール**（最新コード管理・承認の判断基準・承認者）を決める。

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
- [x] **AIアシスト LLM連携**（GPT-5.4 Mini・月300回上限）（[18](./features/18-ai-assist.md)・#22/#190）　設定待ち: `OPENAI_API_KEY`

## 優先度 ⚪ 低（完了）
- [x] 会員同士の相互質問（ゲスト→ホスト・最小実装）（[20](./features/20-member-mutual-questions.md)・#21）
- [x] Zoom 自動発行（[06](./features/06-location-type.md)・#23）　設定待ち: `ZOOM_*`
- [x] 議事録アプリ連携（汎用inbound webhook）（[23](./features/23-meeting-minutes.md)・#24）　設定待ち: `MEETING_NOTES_WEBHOOK_SECRET`
- [x] DBレガシー整理（非破壊・ドキュメント明示）（#25・[db-schema.md](./db-schema.md)）

> 未着手の実装タスクは現状なし。新規要望が出たら本セクションに追加する。

---

## 依存関係の要点

| 実装タスク | 先に必要な人間タスク |
|---|---|
| Google ログイン／カレンダー連携の動作確認 | B（OAuthクライアント・審査）＋ E（環境変数） |
| 22分前リマインダー・予約完了メール | C（Resend・DNS） |
| Square トライアル課金 | D（Square設定・Webhook） |
| 本番公開全般 | A（ドメイン・Supabase適用）＋ F（法務ページ掲載） |

> コード実装は人間タスクの完了前でも進められる（ローカル/モックで開発）。ただし**本番動作確認**は対応する人間タスクが前提。
