# キマル（Kimaru）現状機能一覧

最終更新: 2026-06-09（打ち合わせ 2026-06-03 / 2026-06-09 の決定と実装を反映）

このドキュメントは、現在のコードベースに**実装済みの機能**を棚卸ししたもの。
「やりたいこと（仕様）」は [`spec.md`](./spec.md)、機能ごとの詳細は [`features/README.md`](./features/README.md)、画面/URLは [`screens.md`](./screens.md)、画面アクセス権は [`screen-flow.md`](./screen-flow.md)、API は [`api.md`](./api.md)、DB構成は [`db-schema.md`](./db-schema.md)、プラン比較は [`plan-comparison.md`](./plan-comparison.md)。

技術構成: 静的 HTML / CSS / バニラ JS（`public/`）＋ サーバレス関数（`netlify/functions/`）＋ Supabase。ビルド工程なし。

凡例: ✅ 実装済 / ⚠️ 部分実装 / ❌ 未実装

## 🔐 認証・ログイン

| 機能 | 状態 | 実装場所 |
|---|---|---|
| Google ソーシャルログイン（OAuth2） | ✅ | `google-auth-start.js` / `google-auth-callback.js` |
| メール/パスワード 登録・ログイン | ✅ | `auth-register.js` / `auth-login.js`（scrypt・`owners.password_hash`） |
| パスワード再設定（メールリンク・1時間有効） | ✅ | `password-reset-request.js` / `password-reset.js` / `reset-password.html` |
| メール確認（任意・非ブロッキング） | ✅ | `verify-email.js`（`owners.email_verified`・登録時に送信） |
| セッション管理（HMAC Cookie・30日） | ✅ | `_lib/crypto.js`, `_lib/auth.js` |
| ログアウト / ログイン状態確認 | ✅ | `logout.js` / `me.js` |

## 📅 予約ページ設定（発行者）

| 機能 | 状態 | 実装場所 |
|---|---|---|
| 予約時間（30〜120分・10分刻み） | ✅ | `booking-settings.html`, `booking-page-save.js`, `availability.js` |
| 前後バッファ（0〜60分） | ✅ | 同上 |
| 受付期間（無料2ヶ月/有料6ヶ月・プラン制限） | ✅ | 同上＋`app.js` |
| 開催方法（対面/Meet/Zoom/電話/URL/後で連絡） | ✅（Zoomは env設定で自動発行） | `booking-settings.html`, `book.js`, `_lib/zoom.js` |
| 受付可能時間（曜日・時間帯） | ✅ | `availability_settings` 利用。**予約ページ単位**（`booking_page_id`・#263） |

## 🗓 Google カレンダー連携・予約

| 機能 | 状態 | 実装場所 |
|---|---|---|
| 空き判定（freeBusy で既存予定を除外） | ✅ | `_lib/google.js` `freebusy()`, `availability.js` |
| 予約作成＋カレンダー予定自動登録 | ✅ | `book.js`, `_lib/google.js` |
| Google Meet 自動発行（conferenceData） | ✅ | `_lib/google.js`（`meeting_url` 保存） |
| 1週間スケジュールグリッド予約UI（3ステップ：日程調整→確認→完了） | ✅ | `booking.html`, `booking-week.js` |
| カレンダー招待メール（Meet リンク込み） | ✅ | `createCalendarEvent`（`sendUpdates=all`） |
| 予約のキャンセル・日程変更（ゲスト・メールリンク） | ✅ | `booking-manage.js`, `manage-booking.html`（[features/26](./features/26-booking-cancel.md)/[27](./features/27-booking-reschedule.md)） |
| 予約ページの受付一時停止（is_active） | ✅ | `booking-settings`/`availability`/`book.js`（[features/29](./features/29-suspend-booking.md)） |
| 22分前リマインダー（無料=基本/Pro=プロフィール付き） | ✅ | `reminder-mails.js`+`reminder-scheduled.js`（要 Resend 設定。[features/21](./features/21-reminder.md)） |

## 📝 アンケート・メール

| 機能 | 状態 | 実装場所 |
|---|---|---|
| 事前アンケート（設定・保存・プラン別問数） | ✅ | `booking-settings.html`, `booking-page-save.js` |
| 事前アンケート（ゲスト動的表示・回答保存） | ✅ | `booking-week.js`（動的描画）/ `book.js`（`questionnaire_answers` 保存）/ `availability.js`（凍結質問は除外） |
| 予約完了メール（独自テンプレ・管理リンク付き） | ✅ | `book.js` `sendBookingConfirmation`（要 Resend/Gmail 設定。`_lib/mail.js`） |
| ホストへの予約通知メール | ✅ | `book.js` `sendHostNotification`（[features/28](./features/28-host-notification.md)） |
| メール経路分離（取引/営業）＋List-Unsubscribe＋サプレッション | ✅ | `_lib/mail.js`, `mail-unsubscribe.js`, `resend-webhook.js` |
| 会員獲得サンキュー導線（翌日・未登録者へ） | ✅ | `thankyou-mails.js`+`thankyou-scheduled.js`（marketing経路） |
| ~~誕生日メール自動送信~~ | 廃止 | 機能削除（決定17・#180）。生年月日入力・占い分析は継続 |

## 👤 アカウント・プラン・顧客管理

| 機能 | 状態 | 実装場所 |
|---|---|---|
| 無料サインアップ | ✅ | `signup.js`, `signup.html` |
| 招待コード Cat Key（`NEKO20240222`） | ✅ | `invite-apply.js`, `dashboard.html` |
| 運営ログイン（共有キー→運営セッション・ユーザーと分離） | ✅ | `operator-login.html`, `operator-login.js`, `_lib/crypto.js`（`kimaru_admin_session`） |
| 運営コンソール（Cat Key 承認/却下/取消/復元・監査） | ✅ | `cat-key-admin.html`, `invite-apply.js?admin=cat-key`（運営セッション認可） |
| 運営者管理（operators 一覧/追加/削除・ユーザーと別テーブル） | ✅ | `operators.html`, `operators.js`, `operators` テーブル |
| プラン制限（受付期間・問数・ページ数／無料2・Pro5） | ✅ | `booking-page-save.js`（premium=Pro扱い） |
| プラン区分（無料/Pro/プレミアム）の判定・ゲーティング | ✅ | `_lib/auth.js`（`requireProOwner` / `requirePremiumOwner`） |
| Square 決済での Pro/プレミアム 昇格・降格 | ✅（Webhook） | `square-webhook.js`（`SQUARE_PREMIUM_PLAN_ID` で premium 判定・要設定） |
| 解約/降格時のデータ凍結・再昇格で復元 | ✅ | `_lib/plan-freeze.js`（予約ページ・質問を凍結/復元） |
| 相手管理（予約一覧・検索／無料は閲覧のみ・編集はPro） | ✅ | `contacts.html`, `owner-bookings.js`（要Owner）, `appointment-log.js`（要Pro） |
| 面談メモ・印象スコア構造化＋相手集約ビュー | ✅ | `appointment-log.js`（`scores`）, `app.js` `renderLogAggregate` |
| 生年月日インサイト（算命学=年柱五行＋数秘術=ライフパス） | ✅ | `booking-week.js` / `app.js` `buildRelationshipProfile` |
| プロフィール（サーバ保存）＋高度プロフィール＋公開ページ | ✅ | `profile.js`, `profile.html`, `profile-public.js`, `public-profile.html`（`/u/<slug>`） |
| AIアシスト（LLM連携・プレミアム・月300回上限） | ✅（要 `OPENAI_API_KEY`） | `ai-assist.js`, `_lib/llm.js`, `ai_assist_logs` |

## 🌐 フロントエンド

| 機能 | 状態 | 実装場所 |
|---|---|---|
| 多言語対応（日/英/繁中・全ページセレクタ） | ✅（4画面） | `i18n.js`, `app.js` |
| レスポンシブ CSS（フレームワーク不使用） | ✅ | `styles.css`, `booking-redesign.css` |
| ビルド工程なし（静的配信） | ✅ | `netlify.toml` |
| 認証ミドルウェア（ルート保護・data-auth 注入・ヘッダー/フッター注入） | ✅ | `edge-functions/auth-gate.js` |
| 共通ヘッダー一本化（手動ナビ廃止）／共通フッター（法務リンク） | ✅ | Edge `<!-- site-header -->` / `<!-- site-footer -->` |
| 予約ページ：軽量ヘッダー＋下部に製品説明/CTA | ✅ | `booking.html` |
| 法務ページ（利用規約/プライバシー/特商法・枠） | ✅（本文ドラフト別） | `terms.html`, `privacy.html`, `tokushoho.html` |

## DB（現状の主なテーブル）

`owners`(plan: free/pro/premium・email_verified), `operators`, `google_connections`, `booking_pages`(frozen), `availability_settings`, `bookings`(guest_message), `questionnaire_questions`, `questionnaire_answers`, `appointment_logs`(scores), `ai_assist_logs`, `email_suppressions`, `thankyou_deliveries`, `free_signups`, `payment_events`, `cat_key_events` ほか。レガシー（`users`/`google_calendar_tokens` 等）は非破壊で残置。詳細は [`db-schema.md`](./db-schema.md) と `supabase-schema.sql`。

---

## ✅ 2026-06-09 反映済み（決定→実装）

- **プレミアムプラン**（¥2,200・無料お試しなし）＋ **AIアシスト**（GPT-5.4 Mini・月300回上限）。
- **メール/パスワード認証**・パスワード再設定・メール確認。
- **占いインサイト高度化**（算命学＋数秘術）、**高度プロフィール＋公開ページ**、**相互質問**、**印象スコア構造化＋集約**。
- **降格時のデータ凍結/復元**、**メール経路分離＋サプレッション**、**会員獲得サンキュー導線**。
- 事前アンケートのゲスト表示・回答保存（配線済み）。**誕生日メール自動送信は廃止**。GitHub の `実装` ラベル issue は全クローズ。

## ⚠️ 主な残課題（設定待ち・将来）

- **設定待ち（コードは完了・env/外部設定が必要）**: プレミアム課金（Square商品＋`SQUARE_PREMIUM_PLAN_ID`）、AIアシスト本番稼働（`OPENAI_API_KEY`）、メール送信（Resend Pro＋送信元env＋DNS SPF/DKIM/DMARC）、Zoom自動発行（`ZOOM_*`）、`supabase-schema.sql` の本番適用、本番デプロイ。→ 人間タスクは [`tasks.md`](./tasks.md)。
- **将来**: 高度プロフィールの画像アップロード、算命学の日柱精密化、AI要約/AI検索（プレミアム上位）、議事録ツール提携、法人プラン。
- 注: DB はレガシー重複あり（`owners`/`users`、`google_connections`/`google_calendar_tokens` ほか・非破壊で残置）。詳細は [`db-schema.md`](./db-schema.md)。
