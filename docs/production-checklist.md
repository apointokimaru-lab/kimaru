# 本番運用チェックリスト（premium=coming soon 前提）

[← docs に戻る](./README.md)

本番（Netlify + Supabase prod）を **無料/Pro で立ち上げ、premium は「近日公開」** で出すための手順。
premium coming-soon は既定状態（コードに組込み済み）なので、特別な作業はほぼ不要。

---

## 0. 順序（推奨）

1. Google OAuth の検証に着手（リードタイム長 → 最優先）
2. 本番DBに `supabase-schema.sql` を全適用
3. 本番 Netlify env を設定
4. 独自ドメイン＋HTTPS、`APP_BASE_URL` 一致
5. PR を main にマージ → `npm run deploy`
6. デプロイ後スモーク（`scripts/prod-smoke.sh`）＋手動確認

---

## 1. DB（本番 Supabase）

- Supabase SQL エディタで **`supabase-schema.sql` を全文実行**（冪等・再実行安全）。
- 今回の追加分: `rate_limit_hits`（レート制限）、`bookings.host_answer`/`host_answer_at`（相互質問）。
- ※ dev にも `host_answer` 系は未適用なら当てる（相互質問の永続化のため）。

## 2. 本番 Netlify 環境変数

| 変数 | 区分 | 本番での値 | 備考 |
|---|---|---|---|
| `APP_BASE_URL` | 🔴必須 | `https://<本番ドメイン>` | 末尾スラッシュ無し。OAuth/メールリンク/HSTSの基準 |
| `SUPABASE_URL` | 🔴必須 | 本番プロジェクトURL | |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔴必須 | 本番 service-role キー | RLSをバイパスする鍵＝厳重管理 |
| `GOOGLE_CLIENT_ID` | 🔴必須 | 本番OAuthクライアント | §3参照 |
| `GOOGLE_CLIENT_SECRET` | 🔴必須 | 同上 | |
| `SESSION_SECRET` | 🔴必須 | **長いランダム値**（生成済） | ⚠️既存本番があるなら**ローテ厳禁**（全セッション無効化） |
| `TOKEN_ENCRYPTION_KEY` | 🔴必須 | **長いランダム値**（生成済） | ⚠️既存本番があるなら**ローテ厳禁**（保存済Googleトークンが復号不能に） |
| `GMAIL_USER` | 🟠実質必須 | 送信元Gmail | 未設定だとメール送信スキップ（予約確認/リマインダー届かない） |
| `GMAIL_APP_PASSWORD` | 🟠実質必須 | 16桁アプリパスワード | |
| `ADMIN_SECRET` | 🟠 | **長いランダム値**（生成済） | 運営コンソール/Cat Key承認。未設定だと operator-login 500 |
| `SQUARE_WEBHOOK_SHARED_SECRET` | 🟡Pro課金時 | 共有シークレット | **未設定だと square-webhook が503＝Pro付与されない**（fail-closed化済） |
| `SQUARE_PREMIUM_PLAN_ID` | ✅coming-soon | **空のまま** | 空＝Square は誰にも premium を付与しない（pro のみ） |
| `OPENAI_API_KEY` | ✅coming-soon | **空のまま** | 空＝AIアシスト503→ルールベースにフォールバック |
| `REMINDER_CRON_SECRET` / `THANKYOU_CRON_SECRET` / `CRON_SECRET` | 🟢推奨 | ランダム値（任意） | HTTP手動cronを保護（定期実行は秘密なしでも動く） |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | 🟢推奨 | Square署名キー | 正規HMAC検証を有効化（無くても共有シークレットで動作） |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` / `TRANSACTIONAL_EMAIL_FROM` / `MARKETING_EMAIL_FROM` | 🟢独自ドメイン化時 | — | Resend移行＋SPF/DKIM/DMARC。バウンス自動配信停止 |
| `ZOOM_*` / `MEETING_NOTES_WEBHOOK_SECRET` | ⚪任意 | — | Zoom自動発行・議事録inbound |
| `OPENAI_MODEL` / `AI_ASSIST_MONTHLY_LIMIT` | ⚪任意 | 既定でOK | premium解禁時に効く |

> 生成済みのランダム値はチャット側に提示（このファイルには載せない）。Netlify env にのみ設定し、リポジトリにコミットしない。

## 3. Google OAuth（本番・最重要／リードタイム長）

- OAuthクライアントの「承認済みリダイレクトURI」に **`https://<本番>/api/google-auth-callback`** を追加。
- 同意画面を **「公開」**＋**検証**。スコープに `.../auth/calendar`（機微スコープ）があるため一般公開には Google の審査が必要。
- 検証完了まではアプリは「テスト」状態で、**登録テストユーザーのみ**ログイン可＋「未確認アプリ」警告。

## 4. 課金（Pro を Square で売る場合）

- Square で Pro サブスク/決済リンク作成 → Webhook を `/api/square-webhook` に向け、`SQUARE_WEBHOOK_SHARED_SECRET`（または `SQUARE_WEBHOOK_SIGNATURE_KEY`）を設定。
- `SQUARE_PREMIUM_PLAN_ID` は**空**（premium を売らない）。
- Cat Key（運営承認制の無料Pro）を使うなら `ADMIN_SECRET` ＋ `/cat-key-admin.html`（要 `/operator-login`）。

## 5. デプロイ

- PR を main にマージ → **`npm run deploy`**（= `netlify deploy --prod`）。CSP/HSTS（netlify.toml）はデプロイで自動適用。

## 6. デプロイ後スモーク

- 自動: `DOMAIN=https://<本番> bash scripts/prod-smoke.sh`
- 手動（dev で検証不可だった項目）:
  - Googleログインの実往復（`state` 検証込み）。
  - テスト予約 → 予約確認/ホスト通知メール着信、22分前リマインダー（`?dry_run=1` でも可）。
  - Square Pro 決済 → webhook → `plan='pro'` 付与を確認。
  - 料金/AIアシスト画面が「近日公開（フェーズ2）」表示、premium が買えないこと。

## 7. Premium 解禁（フェーズ2・将来）

1. `OPENAI_API_KEY` を設定、2. `SQUARE_PREMIUM_PLAN_ID` に Square の premium plan variation id、3. `public/ai-assist.html` の `PREMIUM_AI_LIVE = true`。
（メモ: `premium-3tier-frontend`）

## 法務

- 特商法表記・プライバシー・利用規約は実装済。Pro課金時は特商法の事業者情報・返金条件を最終確認。
