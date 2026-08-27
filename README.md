# キマル（Kimaru）

**キマル**は、日本語の「無料ではじめられる」1対1の日程調整ツールです。
日程を決めるだけで終わらせず、**会う前に相手を知り、会った後に関係を育てる**ところまでを後押しします。

> 会う前に、相手を知る。
> 会った後に、ご縁が育つ。
> 予定を決めるだけでなく、明るい未来につながる出会いを増やす。

- **ホスト（使う人）**: 予約ページのURLを共有 → ゲストが空き枠から予約 → Google カレンダー連携・Google Meet 自動発行・確認/リマインドメール。
- **ゲスト（予約する人）**: ログイン不要。空き枠を選び、事前アンケートに答えて予約。キャンセル・日程変更も管理リンクから。
- **言語**: 日本語 / English / 繁體中文（画面右上で切替）。

> ℹ️ このREADMEは「初めてキマルに触れる運営者・開発者」が全体像をつかむための入口です。
> 製品仕様・決定ログ・画面/APIの詳細は [`docs/`](./docs/README.md) が正本です。

---

## プラン

| | 無料 | Pro | プレミアム |
|---|---|---|---|
| 料金 | ¥0 | ¥980 / 月（1ヶ月無料お試し） | ¥4,800 / 月（無料お試しなし） |
| 受付できる期間 | 2ヶ月先まで | 6ヶ月先まで | 6ヶ月先まで |
| 予約ページ数 | 2 | 5 | 5 |
| 事前アンケート | 2問 | 5問（編集・必須設定可） | 5問 |
| 予約履歴の閲覧 | ✅ | ✅ | ✅ |
| 相手管理（面談メモ・印象スコア） | − | ✅ | ✅ |
| 高度プロフィール＋公開ページ（`/u/<slug>`） | − | ✅ | ✅ |
| 占いベース相手分析（生年月日インサイト・算命学＋数秘術） | − | ✅ | ✅ |
| AIアシスト（相手データから次の一手を提案） | − | − | ✅（近日公開・フェーズ2） |

- 決済は **Square**。AIアシストは **GPT-5.4 Mini**（月300回・プレミアム限定）。
- **Cat Key**（招待コード `Neko20240222`）を入力すると、Pro 機能を無料で使えます（運営の**承認制**）。

---

## システム構成（運営者向けの全体像）

ビルド工程・テスト・Lint はありません。**静的フロント ＋ サーバレス関数 ＋ Supabase** の素朴な構成です。

- **フロント**: `public/` の静的 HTML/CSS/バニラJS。`/api/*` を `fetch` で呼ぶ。
- **API**: `netlify/functions/<name>.js`（Netlify ハンドラ）。`netlify.toml` が `/api/*` → `/.netlify/functions/` にルーティング。
- **エッジ**: `netlify/edge-functions/auth-gate.js` が認証ゲート＋共通ヘッダー注入を担当。
- **DB**: Supabase（PostgREST を `fetch` 経由で利用。クライアント SDK は使わない）。
- **認証**: Google ログイン ＋ メール/パスワード（HMAC 署名 Cookie セッション・パスワードは scrypt）。Google トークンは暗号化保存。
- **カレンダー**: Google Calendar API ／ Google Meet 自動発行（Zoom は env 設定時のみ）。
- **メール**: `_lib/mail.js`（Gmail SMTP → Resend → 未設定ならスキップ）。取引メールと営業メールで送信元を分離。
- **定期実行**: Netlify Scheduled Functions（予約22分前のリマインダー等）。

ホストは **Netlify 一本化**（旧 Vercel 対応は 2026-06 に廃止）。コード規約・非自明な設計は [`CLAUDE.md`](./CLAUDE.md) を参照。

---

## ローカルで動かす

```bash
npm run dev      # netlify dev → http://localhost:8888
npm run deploy   # netlify deploy --prod（本番）
```

環境変数は `.env`（gitignore 済み）に設定します。雛形は [`.env.example`](./.env.example)。

- **必須**: `APP_BASE_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `SESSION_SECRET` / `TOKEN_ENCRYPTION_KEY`
- **運営コンソール用**: `ADMIN_SECRET`（未設定だと運営ログインが 500 になり使えません）
- **任意**: `SQUARE_WEBHOOK_SHARED_SECRET` / `SQUARE_PREMIUM_PLAN_ID`（プレミアム付与）、`OPENAI_API_KEY` ほか（AIアシスト）、`GMAIL_*` または `RESEND_API_KEY` ＋ 送信元（メール）、`ZOOM_*`（Zoom 自動発行）

Google OAuth リダイレクト URI: `{APP_BASE_URL}/api/google-auth-callback`

---

## データベース（Supabase）

利用前に **`supabase-schema.sql`** を Supabase SQL Editor で実行します（マイグレーションツールは無し。スキーマ変更も手動適用）。

- ライブの正テーブルは **`owners`**（アカウント）／**`google_connections`**（Google トークン）。`users` や `google_calendar_tokens` は旧称の重複で**正本ではありません**。
- ER 図・レガシー重複・今後の変更は [`docs/db-schema.md`](./docs/db-schema.md)。

---

## 運営コンソール（運営者専用）

ユーザー用ログイン（`/login.html`）とは **完全に別系統**です（運営セッション Cookie `kimaru_admin_session`）。

**運営ログインURL**: `/operator-login.html`

- ローカル: `http://localhost:8888/operator-login.html`
- 本番: `{APP_BASE_URL}/operator-login.html`（例: `https://<サイト名>.netlify.app/operator-login.html`）

手順:

1. 上記の運営ログインURLを開く
2. 「管理者キー」に **`ADMIN_SECRET` の値**を入力してログイン
3. 入れる画面:
   - **`/cat-key-admin.html`** — Cat Key 申請の**承認 / 却下**、プランの**昇格 / 降格**、監査ログ
   - **`/operators.html`** — 運営者の一覧 / 追加 / 削除

> Cat Key は承認制です。ユーザーがコードを入力すると「申請（保留）」になり、運営が承認すると Pro に昇格します。降格すると上限超過データは凍結され、再昇格で復元されます。

---

## 定期ジョブ・メール

- **リマインダー**: `reminder-scheduled.js`（Netlify Scheduled・約5分間隔）が予約22分前の確認メールを送信。手動確認は `{APP_BASE_URL}/api/reminder-mails?dry_run=1`。
- **サンキュー導線**: 面談翌日に未登録の相手へ登録案内（営業メール・配信停止/サプレッション対応）。
- メール各種は env 未設定時に自動でスキップ（誤送信防止）。

> 誕生日メールの自動送信は **廃止** しました（決定17）。生年月日の入力と占いベースの相手分析は継続しています。

---

## もっと詳しく

- 製品仕様・決定ログ・画面/API: [`docs/README.md`](./docs/README.md)（ドキュメント索引）
- コード規約・アーキテクチャの要点: [`CLAUDE.md`](./CLAUDE.md)
