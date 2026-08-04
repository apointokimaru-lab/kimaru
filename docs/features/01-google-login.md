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

## ログイン と カレンダー連携 の区別（#265・2026-08-04）

`google-auth-start` は用途を **state の先頭1文字**で持ち回る（state は署名 cookie に保持するので改ざん不可）。

| 入口 | パラメータ | state | callback の挙動 | 遷移先 |
|---|---|---|---|---|
| `login.html` / `signup.html` | なし | `l…` | Google のメールで `owners` を upsert してログイン | `/dashboard.html` |
| `settings.html`（カレンダー連携／別アカウントで再連携） | `?connect=1` | `c…` | **ログイン中ならそのアカウントにカレンダーを繋ぐだけ**（アカウントを切り替えない）。セッション切れならログイン扱いにフォールバック | `/settings.html?calendar=connected` |

修正前は用途を区別しておらず、常に Google のメールで owner を解決していたため、設定画面の「別アカウントで再連携」で別の Google アカウントを選ぶと、カレンダーが繋がるのではなく**そのメールの別アカウント（無ければ新規作成）にログインしてしまう**状態だった。

### `owners.slug` を上書きしない

`slug` は公開プロフィールURL `/u/{slug}` になり、予約確認メール・リマインダーメールにも載る。修正前は Google 連携のたびにメールのローカル部（サフィックス無し）で上書きしていたため、

- メール登録ユーザー（`makeSlug()` で `mnie427-r3a1o`）が Google 連携すると slug が `mnie427` に変わり、**共有済みURLが 404 になる**
- ローカル部が他ユーザーと衝突すると `owners_slug_unique` 違反で **ログイン自体が 500**

という2つの問題があった。現在は `_lib/supabase.js` の `upsertOwner` が **新規作成時のみ** `ownerSlugCandidate()`（ローカル部＋ランダム5文字、衝突時は最大5回リトライ）で採番し、既存アカウントの slug は触らない。

## 補足: 別ログイン方式との関係

現状は Google ログイン1回で認証＋カレンダー権限を同時取得しているが、**認証（ログイン）と外部連携（認可）は分離可能**。別ログイン方式（メール+パスワード等）を採用しても、後から Google カレンダー連携を追加できる（DB は `owners` と `google_connections` で分離済み）。方針は [25 認証アーキテクチャ](./25-auth-architecture.md) を参照。

## 残タスク

- Google Cloud OAuth クライアント作成と環境変数（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` ほか）の設定 → 動作させるために必須。
- リダイレクト URI を Google Cloud 側に登録（`{APP_BASE_URL}/api/google-auth-callback`）。
- エンドツーエンドの動作検証。
