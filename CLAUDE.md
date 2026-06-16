# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

キマル (Kimaru) — a Japanese, free-first 1-on-1 scheduling tool. Static HTML/CSS/vanilla JS frontend + serverless functions + Supabase. **No build step, no test framework, no linter.** The product is built incrementally; the working language is Japanese.

## Commands

```bash
npm run dev      # netlify dev → http://localhost:8888 (serves public/ + functions at /api/*)
npm run deploy   # netlify deploy --prod
```

- There are **no tests, no lint, no build**. Don't invent them.
- DB changes: apply `supabase-schema.sql` manually in the Supabase SQL editor (no migration tool).
- Reminder-mail dry run: `GET /api/reminder-mails?dry_run=1` (returns targets/message without sending). (Birthday-mail auto-send was removed — decision 17 / #180.)

## Architecture (the non-obvious parts)

### Netlify only — functions
Endpoint logic lives in `netlify/functions/<name>.js` as a Netlify-style handler:
```js
exports.handler = async (event) => { /* event.httpMethod, event.headers, readJson(event) */ return json(200, {...}); }
```
`netlify.toml` routes `/api/*` → `/.netlify/functions/:splat`, so `/api/me` calls `netlify/functions/me.js`.

**To add an endpoint:** just create `netlify/functions/<name>.js`. (The project is Netlify-only — the old Vercel adapters `api/*` + `lib/vercel-adapter.js` + `vercel.json` were removed.)

### Edge middleware
`netlify/edge-functions/auth-gate.js` runs on HTML requests: (1) redirects unauthenticated users away from protected app pages to `/login.html`; (2) injects `<body data-auth="authed|guest">` for CSS-based nav show/hide (no flash); (3) injects the shared header (`SITE_HEADER`) into pages that contain the `<!-- site-header -->` placeholder. Protected paths & the access matrix are documented in `docs/screen-flow.md`.

### Shared helpers — always use these (`netlify/functions/_lib/`)
- `response.js` — `json(status, body)`, `redirect(location)`, `readJson(event)`. Return these from handlers.
- `config.js` — `required(name)` (throws `Missing env var: X`), `optional(name, fallback)`, `appBaseUrl()`, `googleRedirectUri()`. Read env through these, never `process.env` directly.
- `supabase.js` — DB access via **Supabase REST (PostgREST) over `fetch`** using the service-role key; there is no Supabase client SDK. Build filters with the `eq()` helper and table-specific functions (`findOwnerById`, `upsertOwner`, …).
- `auth.js` — `currentOwner(event)` / `requireOwner(event)` (throws 401). Guard protected endpoints with `requireOwner`.
- `crypto.js` — HMAC-signed session cookie `kimaru_session` (30d, HttpOnly/Secure), and token encryption for stored Google tokens.
- `google.js` — Google OAuth + Calendar (freeBusy, event creation, Google Meet via conferenceData).

### Auth & accounts
Google OAuth (`google-auth-start` → `google-auth-callback`) upserts into the **`owners`** table and sets the `kimaru_session` cookie. `owners` is the **live** account table. Note the schema also contains legacy/aspirational duplicates that are **not** the source of truth: `users` (legacy of `owners`), `google_calendar_tokens` (legacy of `google_connections`), and duplicate columns on `bookings` (`visitor_*`/`guest_*`, `start_at`/`start_time`). Prefer `owners` / `google_connections` / `visitor_*` / `start_at`.

### Plan tiers & gating
`owners.plan` ∈ `free` / `pro` / `premium`. Gate with `auth.js` helpers: `requireProOwner` passes **pro and premium** (premium includes all Pro features), `requirePremiumOwner` passes premium only; `isPro()`/`isPremium()` for inline checks. **Pro ¥980/mo and premium ¥2,200/mo both have no free trial (charged on signup)** — the Pro 1-month trial was removed because Square couldn't implement it; `square-webhook.js` no longer sets `trial_ends_at`. Square grant: `square-webhook.js` sets `premium` when the subscription's plan id matches `SQUARE_PREMIUM_PLAN_ID`, else `pro`.

### AI assist (premium)
`/api/ai-assist` (`ai-assist.js`, premium-only) generates relationship suggestions via `_lib/llm.js` (OpenAI Chat Completions over `fetch`, no SDK; default model `gpt-5.4-mini`, override `OPENAI_MODEL`). **Monthly fair-use cap** (`AI_ASSIST_MONTHLY_LIMIT`, default 300) counted from `ai_assist_logs` rows in the current JST month. `OPENAI_API_KEY` unset → 503, and `ai-assist.html` falls back to the client-side rule-based suggestions.

### Mail routing (decision 13)
`_lib/mail.js` `sendMail({..., category})`: `transactional` (default; from `TRANSACTIONAL_EMAIL_FROM`/notify subdomain) vs `marketing` (from `MARKETING_EMAIL_FROM`/news subdomain). Marketing mail skips suppressed recipients (`email_suppressions`) and gets `List-Unsubscribe` + one-click (RFC 8058). `mail-unsubscribe.js` records opt-outs (HMAC token, no DB column); `resend-webhook.js` auto-suppresses bounces/complaints.

### Frontend (`public/`)
Vanilla JS, no framework. i18n is attribute-driven: `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` resolved by `i18n.js` (`window.KimaruI18n`, languages ja/en/zh-TW, persisted in localStorage). `app.js` drives the admin/booking-settings screens; `booking-week.js` drives the guest booking grid. Pages call `/api/*` with `fetch`. Booking-page plan limits are enforced both client-side (`app.js`) and server-side (`booking-page-save.js`).

### Scheduled jobs
リマインダー（予約22分前）は **Netlify Scheduled Functions** で起動する。コアは `reminder-mails.js` の `run()` に切り出し、`reminder-scheduled.js` が呼ぶ。スケジュールは `netlify.toml` の `[functions."reminder-scheduled"] schedule="*/5 * * * *"`。`run()` 元の HTTP エンドポイント（`/api/reminder-mails?dry_run=1`。認証 `REMINDER_CRON_SECRET` or `CRON_SECRET`）はローカル確認用に残る。メール送信は `_lib/mail.js`（Gmail→Resend、未設定時は送信スキップ）。リマインダーは無料=基本／Pro=プロフィール付き（`owner.plan` で出し分け）。**誕生日メールの自動送信は廃止（決定17・#180）— 生年月日入力と占いベース相手分析は継続。**

### 予約のキャンセル・日程変更
ゲストは確認メール/完了画面の管理リンク（`/manage-booking.html?id=&t=`、`t` は `bookingToken`=booking idのHMAC）から、ログイン不要でキャンセル・日程変更できる（`booking-manage.js`）。リスケは同一bookingを更新し、Googleイベントは新規作成成功時のみ旧を削除して差し替え。新規予約・キャンセル・変更時はホストへも通知メール（`book.js sendHostNotification`）。

## Hosting — Netlify only
本番ホストは **Netlify 一本化**（2026-06 決定。Vercel対応は廃止＝`vercel.json`/`api/`/`lib/vercel-adapter.js` を削除済み）。`npm run dev`(=`netlify dev`)/`npm run deploy`。`netlify.toml` が `/api/*`→`/.netlify/functions/`、`/b/*`→`booking.html` をルーティング。Edge Function（`netlify/edge-functions/`）が認証ゲート＋ヘッダー注入を担う。

## Required env vars
`APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`. Optional: `SQUARE_WEBHOOK_SHARED_SECRET`, `SQUARE_PREMIUM_PLAN_ID` (premium grant); mail vars (`RESEND_API_KEY`, `BIRTHDAY_EMAIL_FROM`, `BIRTHDAY_EMAIL_REPLY_TO`, `BIRTHDAY_CRON_SECRET`/`CRON_SECRET`, `TRANSACTIONAL_EMAIL_FROM`, `MARKETING_EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`); AI-assist vars (`OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_ASSIST_MONTHLY_LIMIT`). Missing a required var makes the relevant function throw at request time. See `.env.example`.

## Product spec lives in `docs/`
`docs/` is the authoritative product spec and decision log — consult it before implementing features. Start at `docs/README.md` (index), then `docs/open-decisions.md` (decisions + open/uncertain items), `docs/features/README.md` (per-feature specs + implementation priority), and `docs/db-schema.md` (real schema + legacy notes). Confirmed plan values: free vs pro = booking range 2mo/6mo, questionnaire 2/5 questions, booking pages 2/5, price ¥980/mo via Square. Cat Key invite code `Neko20240222` (normalized `NEKO20240222`) grants pro for free.

## Conventions
- CommonJS (`require`/`module.exports`); handlers export `{ handler }`.
- UI/copy is Japanese and must avoid poker-specific wording (general-audience product).
- Don't re-introduce Vercel or rewrite the DB schema without explicit instruction.
