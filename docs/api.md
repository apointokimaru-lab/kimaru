# キマル API エンドポイント一覧

最終更新: 2026-06-09

## 共通仕様

- **ベースパス**: `/api/*`
- **実体**: ロジックは `netlify/functions/<name>.js`。`netlify.toml` の rewrite で `/api/*` → `/.netlify/functions/:splat`（**Netlify一本化**。旧 Vercel アダプタ `api/`・`lib/vercel-adapter.js`・`vercel.json` は削除済み）。
- **データ形式**: リクエスト/レスポンスとも JSON。`_lib/response.js` の `readJson` は **`text/plain` / `application/x-www-form-urlencoded` / `multipart/form-data` の本文を解釈しない**（`{}` を返す）。これらはクロスサイトの HTML フォームが送信できる content-type で、特に `<form enctype="text/plain">` は「JSON として妥当な」本文を作れてしまうため、CSRF で JSON API を叩かれないよう塞いでいる。※ `mcp-oauth-token.js` は RFC 6749 の form-urlencoded を自前で `URLSearchParams` で処理しており影響を受けない。
- **認証**: セッション Cookie `kimaru_session`（HMAC 署名・HttpOnly・30日）。`/api/me` 等の「要」エンドポイントは Cookie 必須。ブラウザ側は `fetch(..., { credentials: "include" })`。
- **ログインCSRF対策**: セッションを発行するエンドポイント（`auth-login` / `auth-register` / `operator-login`）は `_lib/csrf.js` の `isCrossSiteRequest(event)` でクロスサイト送信を 403 で弾く（`Sec-Fetch-Site: cross-site`、または `Origin` のホスト不一致）。`Origin` の無い非ブラウザ経由（curl・サーバ間）は従来どおり通す。これが無いと、攻撃サイトが被害者のブラウザを**攻撃者のアカウント**でログイン状態にでき、Google 連携などの後続フローを乗っ取る土台になる。
- **エラー形式**: `{ "error": "<message>" }`。HTTP ステータスは 400（入力不正）/401（未認証）/403（権限・プラン制限）/405（メソッド不正）/500（サーバ）/503（未設定）。
- **DB**: Supabase REST（`_lib/supabase.js`）。テーブルは [`spec.md`](./spec.md) / `supabase-schema.sql` 参照。
- 画面との対応は [`screens.md`](./screens.md)。

凡例: 認証 = 不要 / 要（セッション）/ 署名・シークレット

---

## 認証・セッション

### `GET /api/google-auth-start[?connect=1]` — 認証不要
Google OAuth 認可画面へ 302 リダイレクト。スコープ: `openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy`（最小権限。空き確認＝freebusy／予定の作成・更新・削除＝events。フルの calendar は要求しない）。
- state の**先頭1文字**で用途を持ち回る（state は署名 cookie `kimaru_oauth_state` に保持するので改ざん不可）:
  - **`c` + `signBlob("gconnect", { o: ownerId })`** — 連携（設定画面の `?connect=1`）。ログイン中の owner id を**署名して載せ**、callback で本人一致を検証する（`zoom-auth-start.js` と同じ方式）。
  - **`l` + ランダム** — ログイン／新規登録（`login.html` / `signup.html`）。`connect=1` でも未ログインならこちらへフォールバック。

### `GET /api/google-auth-callback?code=...` — 認証不要
OAuth コールバック。`code` をトークン交換し、`google_connections` にトークンを暗号化保存。
- **連携モード（state 先頭 `c`）**: `verifyBlob("gconnect", …)` の owner id と現在のセッションの owner の**一致を必須**とする。不一致・セッション切れなら**トークンを保存せず中断**し `/settings.html?calendar=state_error` へ。一致すれば、そのアカウントにカレンダーを繋ぐだけで**アカウントは切り替えず**、セッションも張り直さない → `/settings.html?calendar=connected`
  - この検証が無いと、攻撃者のセッションを被害者のブラウザに植え付けたうえで連携させることで、**被害者のGoogleトークン（オフライン refresh_token 含む）を攻撃者のアカウントに紐づけられる**（アカウント連携CSRF）。フォールバックでログイン扱いにしてもいけない。
- **ログインモード（state 先頭 `l`）**: Google のメールで `owners` を upsert してログイン、`kimaru_session` を発行 → `/dashboard.html`
- `owners.slug` は**新規作成時のみ**採番する（`_lib/supabase.js` `ownerSlugCandidate`＝ローカル部＋ランダム5文字、衝突時は最大5回リトライ）。既存アカウントの slug は上書きしない（公開プロフィールURL `/u/{slug}` が切れる／unique 違反でログインが 500 になるため）
- 既定の `booking_pages` は**作成しない**（ユーザーが予約設定で作成する）
- 触る DB: `owners`, `google_connections`
- 外部: Google OAuth token / userinfo

### `GET /api/me` — 要
現在のログインオーナーを返す。
- 応答: `{ "owner": { id, email, name, plan(free/pro/premium), slug, has_password, email_verified, ... } | null, calendar_connected }`

### `POST /api/logout` — 認証不要
セッション Cookie を破棄。
- 応答: `{ "ok": true }`（`Set-Cookie` で失効）

### `POST /api/auth-register` / `POST /api/auth-login` — 認証不要
メール/パスワードで登録・ログイン（既存Googleアカウントへのパスワード追加も可）。`password` 8文字以上・scrypt。登録時に確認メール送信（任意・非ブロッキング）。`kimaru_session` 発行。DB: `owners`

### `POST /api/password-reset-request` — 認証不要
再設定リンクをメール送信（メール列挙対策で常に 200）。body: `{ email* }`

### `POST /api/password-reset` — 認証不要（署名トークン）
1時間有効の署名トークンを検証し `password_hash` 更新。body: `{ id*, ts*, t*, password* }`

### `GET /api/verify-email?id=&ts=&t=` — 認証不要（署名トークン）
7日有効トークンを検証し `owners.email_verified=true`。確認は任意・非ブロッキング。

---

## 公開（ゲスト向け）

### `POST /api/signup` — 認証不要
無料アカウント申請を保存。
- body: `{ name*, email*, purpose?, invite_code?, language? }`（`name`/`email` 必須、email 形式・language 形式を検証）
- 応答: `{ ok: true, signup }`
- DB: `free_signups`

### `GET /api/availability` — 認証不要
空き枠を返す（既存 Google 予定を除外）。
- ロジック: `slug` → `booking_pages`（無ければ `defaultOwner()`）→ そのページの `booking_pages`（duration/buffer/range）と `availability_settings`（曜日・時間帯。**ページ単位**＝`booking_page_id` 一致行、無ければ `booking_page_id=null` の旧共有行）から枠生成 → Google `freeBusy` で busy と重なる枠を除外。タイムゾーンは Asia/Tokyo。最大80枠。
- 応答: `{ slots: [{ start, end }] }`（ISO8601）
- DB: `owners`, `booking_pages`, `availability_settings`
- 外部: Google freeBusy

### `POST /api/book` — 認証不要
予約を作成し Google カレンダー予定を登録。
- body: `{ visitor_name*, visitor_email*, start*, end*, topic?, guest_message?, answers?, filter_request?, birth_date_private?, location_type? }`
  - `filter_request` は `kind: "relationship_context"` の JSON（生年月日インサイト＝算命学＋数秘術）を許容。`birth_date_private="yes"` で生年月日を「非公開」にマスク。`guest_message` はゲスト→ホストへの質問・メッセージ（相互質問・#21）。
  - 検証: email 形式、`start < end`、`now ≤ start ≤ now+6ヶ月`。
- 処理: `bookings` 作成 → 事前アンケート回答を `questionnaire_answers` へ保存 → `location_type=zoom` かつ Zoom設定時は Zoom 自動発行（`_lib/zoom.js`）→ `createCalendarEvent` → `google_event_id`・`meeting_url` 更新。ホスト通知に `guest_message` を反映。**予約者がキマル会員（`visitor_email`↔`owners`・自己予約除く）かつ `guest_message` ありなら、ホスト通知メールに回答ページ導線を付与（#20）**。
- 応答: `{ ok: true, booking, google, manage_url }`
- DB: `bookings`, `questionnaire_answers`
- 外部: Google Calendar events、（設定時）Zoom API

---

### `GET|POST /api/booking-answer` — 認証不要（`hostAnswerToken` で保護）
会員同士の相互質問（#20）。ホストが予約者の質問(`guest_message`)に回答する。トークンは `sign("hostanswer:"+id)`＝**ホスト宛メールにのみ載る**（予約者の manage トークンとは別 namespace のため、予約者は回答ページにアクセス不可）。
- GET `?id&t`: 回答ページ初期表示 → `{ question, visitor_name, start_at, answered, host_answer }`。`guest_message` 無しは 404。
- POST `{ id, t, answer* }`: `bookings.host_answer`(+`host_answer_at`) を保存し、予約者へ「回答が届きました」メール送信。`{ ok: true }`。
- DB: `bookings`（`host_answer` 列が未マイグレーションでも try/catch でメール送信は継続）

---

### `GET /api/pending-answers` — 要ログイン（`requireOwner`）
会員同士の相互質問（#20）の「回答待ち」一覧。自分の予約で **相手がキマル会員（`visitor_email`↔`owners`・自分以外）かつ `guest_message` あり かつ 未回答(`host_answer` 空)** のものを返す。各件に回答ページ用 `hostAnswerToken` を同梱。
- 応答: `{ count, items: [{ id, visitor_name, start_at, question, t }] }`
- 利用: `pending-questions.html`（一覧→各件 `answer-question.html?id&t` へ）、ダッシュボード「要対応」の件数表示。
- DB: `bookings`, `owners`（`host_answer` 列が未適用の環境では全件を未回答として扱う＝劣化動作）

---

## 管理（オーナー向け・要）

### `POST /api/booking-page-save` — 要
予約ページ設定（時間・バッファ・公開範囲・開催方法・受付時間・事前アンケート）を保存。
- body: `{ title?, description?, duration_minutes, buffer_before_minutes, buffer_after_minutes, booking_range_months, location_type, location_value?, availability_settings:[{day_of_week,start_time,end_time,enabled}], questions:[{question_text,is_required}], is_active? }`
- 検証/プラン制限（premium は pro 扱い）:
  - duration ∈ 30〜120（10分刻み）、buffer ∈ 0〜60、range ∈ 1〜6（日数指定 7/14/21 も可）
  - location_type ∈ {in_person, google_meet, zoom, phone, custom_url, later}
  - **無料は range 最大2ヶ月**（超過は 403）、質問は無料2問/Pro・プレミアム5問（超過は 403）
  - **保存数上限**: 無料1 / Pro2 / プレミアム5（凍結ページは上限カウント除外・#174 / 決定27。`_lib/plan-limits.js`）
  - 受付時間（availability）が0件なら 400
- 処理: `booking_pages` を upsert（`updated_at` も明示更新。DBトリガーが無く、`_lib/plan-freeze.js` の「直近更新のページを残す」判定が `updated_at.desc` を使うため）→ `questionnaire_questions` を全削除して再投入 → `availability_settings` を**このページぶんだけ**（`booking_page_id` 一致）削除して再投入（#263。以前は owner 単位で消していたため、ページBの保存がページAの受付時間を書き換えていた。`booking_page_id` 列が未適用の環境では owner 単位の旧挙動へデグレード）
- 応答: `{ ok: true, booking_page, availability_settings, question_limit }`
- DB: `booking_pages`, `questionnaire_questions`, `availability_settings`

### `GET / POST /api/booking-pages` — 要
自分の予約ページ一覧（編集プレフィル用に全列＋ページ単位の事前アンケート・受付時間）／削除。
- GET 応答: `{ pages: [{ ...booking_page, questionnaire_questions: [...], availability: [{day_of_week,start_time,end_time}] }], availability, default_availability }`
  - `pages[].availability` は**そのページの受付時間**（自前の行が無ければ旧オーナー共有行）。`availability` は旧共有行、`default_availability` は新規ページ作成時の初期値（共有行→無ければ先頭ページの設定）。
- POST body: `{ action: "delete", id }` → 質問を削除してからページを削除
- DB: `booking_pages`, `questionnaire_questions`, `availability_settings`

### `GET /api/owner-bookings` — 要（無料も可・閲覧のみ）
自分の予約一覧（最新50件）。生年月日が非公開の予約はマスク。**予約履歴の閲覧は無料にも開放（決定19・#182）**。
- 応答: `{ bookings: [...] }`
- DB: `bookings`

### `GET / POST /api/appointment-log` — 要（Pro/Premium）
面談ログ（面談メモ・印象スコア）。**Pro/Premium 限定**。
- POST body: `{ visitor_email*, notes*, keywords?, next_action?, trait_*（10項目・1〜5） }` → `trait_*` は `scores`(jsonb) に構造化保存（#175・相手ごと集約に利用）。
- 応答: `{ logs: [...] }` / `{ ok: true, log }`
- DB: `appointment_logs`（`scores`）

### `POST /api/invite-apply` — 要
招待コード（Cat Key）を適用して Pro へ昇格。
- body: `{ code* }`（大文字化して照合。形式 `^[A-Z0-9_-]{6,40}$`）
- 有効コード: `NEKO20240222`（= Cat Key `Neko20240222`）
- `cat_key_disabled` のアカウントは 403。無効コードは 400。
- 処理: **承認制** — 即時付与せず `cat_key_pending=true`（運営が承認すると `pro`）。`cat_key_events` に監査ログ。
- 応答: `{ ok: true, pending: true, owner }`
- DB: `owners`, `cat_key_events`

### Cat Key 管理モード（運営用・シークレット）
同じ `invite-apply` 関数が `?admin=cat-key` で管理APIを兼ねる。運営セッション or `ADMIN_SECRET`（Bearer / `?secret=` / body.secret）。
- `GET /api/invite-apply?admin=cat-key`: オーナー一覧＋Cat Key イベント。応答 `{ owners, events }`
- `POST /api/invite-apply?admin=cat-key`: body `{ owner_id*, action, secret }`。action は `approve`（申請承認→`plan=pro`）/ `reject`（申請却下→`invite_code=''`）/ `suspend`（利用停止）/ `resume`（利用再開）/ `demote`（無料降格→`plan=free`・`invite_code` 保持で退会済）。`suspend`/`resume` はメンバー（`invite_code` 有）のみ `plan` を `free`⇄`pro` 切替し、非メンバーは `cat_key_disabled` だけ切替（課金者の誤降格・非メンバーの誤昇格を防止）。Pro 昇格で凍結データ復元、無料降格で超過データ凍結。応答 `{ ok: true, owner }`
- DB: `owners`, `cat_key_events`, `booking_pages`

---

## 決済・ジョブ

### `POST /api/square-webhook` — 署名（シークレット）
Square 決済イベントを受信し、該当オーナーのプランを更新。
- 必須: `SQUARE_WEBHOOK_SHARED_SECRET`（未設定なら 503）。ヘッダ `x-kimaru-webhook-secret` が一致しなければ 401。
- 処理: 課金/サブスク系イベント＋email から `owners` を更新。サブスクの plan が `SQUARE_PREMIUM_PLAN_ID` に一致すれば **`plan='premium'`（無料お試しなし）**、それ以外は `pro`。解約系は `free`。昇格/降格時に `_lib/plan-freeze.js` で凍結データを復元/凍結。`payment_events` に記録。
- 応答: `{ ok: true, pro_granted, plan }`
- DB: `owners`, `payment_events`, `booking_pages`, `questionnaire_questions`

### リマインダー（バッチ）— シークレット
`reminder-mails.js`（コア `run()`）＋ `reminder-scheduled.js`（Netlify Scheduled・約5分間隔）。
- `GET/POST /api/reminder-mails`（`REMINDER_CRON_SECRET`/`CRON_SECRET`、`?dry_run=1` 可）。
- 処理: 22分前の `confirmed` 予約を抽出 → メール送信（無料=基本/Pro=プロフィール付き）→ `reminder_deliveries` で重複防止。

### サンキュー導線（バッチ）— シークレット
`thankyou-mails.js` ＋ `thankyou-scheduled.js`（毎日 JST10:00）。
- `GET/POST /api/thankyou-mails`（`THANKYOU_CRON_SECRET`/`CRON_SECRET`、`?dry_run=1` 可）。
- 処理: 前日(JST)に面談した相手のうち**未登録**へ、marketing 経路でサンキュー＋登録案内（List-Unsubscribe付・`thankyou_deliveries` で重複防止）。

> 誕生日メール自動送信は廃止（決定17・#180）。`/api/birthday-mails` は削除済み。

---

## プレミアム・AI / プロフィール / メール配信

### `POST /api/ai-assist` — 要（**プレミアム限定**）
プロフィール×相手データから LLM（GPT-5.4 Mini）で関係構築の提案を生成。
- body: `{ contact: { name?, email?, text? }, profile? }`
- 上限: 月300回/ユーザー（`AI_ASSIST_MONTHLY_LIMIT`、超過 429）。`OPENAI_API_KEY` 未設定なら 503。
- 応答: `{ ok: true, suggestion, model, used, remaining, limit }` / DB: `ai_assist_logs`

### `GET / POST /api/profile` — 要
プロフィール取得/保存。高度フィールド（`profile_headline`/`bio_rich`/`accent_color`/`links`/`public`）は **Pro/Premium のみ保存**。DB: `profiles`

### `GET /api/profile-public?slug=` — 認証不要
公開プロフィール（owner の slug）。`profile_public='off'` なら 404。公開項目はホワイトリスト。`/u/<slug>` で表示。

### `GET / POST /api/mail-unsubscribe?e=&t=` — 認証不要（署名トークン）
営業メールの配信停止。GET=確認HTML / POST=ワンクリック解除（RFC 8058）。DB: `email_suppressions`

### `POST /api/resend-webhook` — 署名（任意）
Resend の bounce/complaint を `email_suppressions` に自動登録（`RESEND_WEBHOOK_SECRET` 設定時は検証）。

---

## 利用計測（#342）

### `POST /api/usage` — 認証不要
画面表示の記録。全HTMLの `</body>` 直前に Edge Function が差し込む `public/usage.js` から、1ページにつき1回だけ `navigator.sendBeacon` で送られる。
- body: `{ path, ref, lang }`（クライアントは識別子を送らない）
- **常に 204**（ボット・レート超過・DB障害・テーブル未適用でも同じ）。計測の失敗をサービス側の失敗にしないため、エラーを返さない＝クライアントは再送もログ出力もしない。
- 保存前に `_lib/analytics.js` で正規化する: パスは画面の種類まで潰し（`/b/<slug>`→`/b/:slug`、`/p/<token>`→`/p/:token`、クエリは破棄）、リファラは外部ホスト名のみ、IPは保存せず「日付＋IP＋UA」のHMAC（日次ローテーション）を `visitor_hash` に入れる。
- ログイン中は `owner_id` を残す（プラン別の利用差を見るため）。プラン自体は保存せず集計時に `owners` と突き合わせる（1PVごとにアカウント照会をしないため）。
- レート制限: 1IPあたり 300件/10分（`rate_limit_hits`・fail-open）。無認証の書き込み口なので行の氾濫だけは止める。
- ファイル名とパスに `analytics`/`track` を使わないのは、広告ブロッカーの汎用ルールで一部の閲覧者ぶんが黙って欠測するのを避けるため。
- 触る DB: `page_events`（+ `rate_limit_hits`）
- 集計は運営コンソールの分析ダッシュボード（#343）。

### `GET /api/usage-summary?days=30` — 運営セッション必須
分析ダッシュボード（`/analytics.html`）が読む集計。`days` は 7〜365 にクランプ（既定30）。
- 返すもの: `accounts`（登録推移・プラン内訳・有料転換率）/ `revenue`（課金内訳・MRR概算・登録→課金までの日数・解約イベント）/ `conversion.cohorts`（登録月別の転換率）/ `activation`（機能への到達率）/ `bookings`（予約推移・キャンセル率・開催方法）/ `ai`（当月のAIアシスト利用）/ `usage`（画面別PV・UU、画面×プラン、流入元、端末、ファネル）
- **取得できなかった表は `available: false`** で返す（0件と「テーブル未適用」を画面で区別するため。0で出すと「使われていない」と読み違える）。
- 集計は JS 側で行う（`page_events` だけは #342 のビューを使う）。1表あたり 20000 行が上限で、超えたら `notes` にその旨を載せる。
- 触る DB: `owners`, `payment_events`, `bookings`, `booking_pages`, `availability_settings`, `google_connections`, `zoom_connections`, `questionnaire_questions`, `ai_assist_logs`, `pinpoint_links`, `booking_notes`, `appointment_logs`, `manual_contacts`, `page_events_*`（ビュー）

---

## 環境変数（API 関連）

| 変数 | 用途 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase REST アクセス |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `APP_BASE_URL`（or `URL`） | リダイレクト URI 算出（`/api/google-auth-callback`） |
| `SESSION_SECRET` | セッション Cookie 署名 |
| `TOKEN_ENCRYPTION_KEY` | Google トークン暗号化（無ければ SESSION_SECRET 代用） |
| `SQUARE_WEBHOOK_SHARED_SECRET` | Square Webhook 検証 |
| `ADMIN_SECRET` | Cat Key 管理モード認証 |
| `REMINDER_CRON_SECRET` / `THANKYOU_CRON_SECRET`（or `CRON_SECRET`） | リマインダー/サンキュー・ジョブ認証 |
| `RESEND_API_KEY` / `TRANSACTIONAL_EMAIL_FROM`(notify) / `MARKETING_EMAIL_FROM`(news) / `RESEND_WEBHOOK_SECRET` | メール送信（経路分離）・配信イベント |
| `SQUARE_PREMIUM_PLAN_ID` | プレミアム（¥2,200）の付与判定 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `AI_ASSIST_MONTHLY_LIMIT` | AIアシスト（GPT-5.4 Mini・月300回） |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom 自動発行（任意） |
| `USAGE_HASH_SALT` | 利用計測の訪問者ハッシュ用ソルト（任意・未設定なら `SESSION_SECRET` を使う） |
