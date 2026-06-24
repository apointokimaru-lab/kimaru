# 01. Google ソーシャルログイン

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済
- 対象プラン: 共通
- 仕様: [`../spec.md`](../spec.md) 技術構成（Auth）

## 概要

発行者が Google アカウントでログインする。ログインと同時に Google カレンダーの権限も取得し、カレンダー連携（[02](./02-google-calendar.md)）に利用する。

## 仕様詳細

- Auth は Supabase Auth または Google ログイン。現状は **Google OAuth を直接利用**。
- ログイン時に Calendar スコープも同時取得する設計。

## 現状の実装

- OAuth2 認可フロー（`access_type=offline` / `prompt=consent`）実装済。
- 取得スコープ（最小権限）: `openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy`（空き確認＝freebusy／予定の作成・更新・削除＝events。フルの calendar は要求しない）
- ログイン後 `owners` テーブルへ upsert、デフォルト予約ページ作成、トークンを暗号化保存。
- セッションは HMAC 署名 Cookie（30日）。

## 関連ファイル

- `netlify/functions/google-auth-start.js` — 認可開始
- `netlify/functions/google-auth-callback.js` — コールバック処理
- `netlify/functions/_lib/google.js` — `googleAuthUrl()` / `exchangeCode()` / `userInfo()`
- `netlify/functions/_lib/crypto.js` — セッション署名・トークン暗号化
- `netlify/functions/_lib/auth.js` — セッション検証
- `netlify/functions/me.js` / `logout.js`

## 補足: 別ログイン方式との関係

現状は Google ログイン1回で認証＋カレンダー権限を同時取得しているが、**認証（ログイン）と外部連携（認可）は分離可能**。別ログイン方式（メール+パスワード等）を採用しても、後から Google カレンダー連携を追加できる（DB は `owners` と `google_connections` で分離済み）。方針は [25 認証アーキテクチャ](./25-auth-architecture.md) を参照。

## 残タスク

- Google Cloud OAuth クライアント作成と環境変数（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` ほか）の設定 → 動作させるために必須。
- リダイレクト URI を Google Cloud 側に登録（`{APP_BASE_URL}/api/google-auth-callback`）。
- エンドツーエンドの動作検証。
