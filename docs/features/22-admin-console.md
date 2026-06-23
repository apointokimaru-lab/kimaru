# 22. 運営管理ページ（運営コンソール）

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済（運営ログイン `/operator-login.html` ＋ 運営セッション、運営コンソール、運営者管理 `/operators.html`）。本文ドラフト等の周辺は別タスク
- 対象: **運営（運営者）専用**
- 仕様: [`../spec.md`](../spec.md) 主要機能 9（Cat Key 不正対策）

## 概要

運営（サービス提供側）が利用者全体を把握・管理するための画面。**発行者ユーザーが使う「相手管理（[14](./14-customer-management.md)）」とは別物**で、運営だけがアクセスする。

> 打ち合わせ（2026-06-03）で管理画面は2系統あると整理:
> - **ユーザー向け管理**: プロフィール編集（[17](./17-profile.md)）・質問設定（[10](./10-questionnaire.md)）・相手管理（[14](./14-customer-management.md)）。`dashboard.html`（ハブ）/ `contacts.html`（相手管理）/ `profile.html` / `booking-settings.html`。
> - **運営者向け管理**（＝本ドキュメント）: 全ユーザー一覧と、Cat Key の承認・強制降格など。

## 仕様詳細（運営が触る機能）

1. **ユーザー一覧**
   - 全登録ユーザーを一覧表示（名前・メール・プラン・登録経路・Cat Key 利用有無など）。
   - 名前で本人確認できる（運営は名前で「この人おかしい」と気づける、という前提）。
2. **Cat Key 承認制**（[19](./19-cat-key-admin.md) と連動。決定 2026-06-03）
   - Cat Key 入力者を即時付与せず、**運営コンソールの画面から「承認」ボタンを押下**して有効化する。
   - フロー: ユーザーが Cat Key 入力 → **承認待ち**として記録 → 運営が一覧で確認 → 承認（または却下）→ 有料機能を無料で解放。
   - 承認待ち・承認済み・却下の状態を一覧で管理。
3. **プラン強制操作（有料 → 無料への変更）** ★運営の中核機能
   - 運営画面から、**有料ユーザーを無料ユーザーへ変更（強制降格）できる**。
   - **当面の対象は Cat Key 利用者のみ**（2026-06-03 方針: 「今は Cat Key のユーザーだけで大丈夫」）。Cat Key の不正利用・退会判明時に運営が手動で降格する。
   - 復元（free → pro 戻し）も可能。「承認する／降格する」の両方を運営が操作できる。
   - （将来）Square 決済など Cat Key 以外で Pro になったユーザーの降格にも広げる場合は、課金（サブスク解約）との整合を考慮する。**現時点では不要**。
4. **監査ログ**
   - 適用・取消・無効コードなどを記録（`cat_key_events`）。
5. **運営者管理**（決定 2026-06-04・独立画面 `/operators.html`）
   - 運営者アカウントの **一覧・追加・削除** を専用画面（`/operators.html`）で行う。
   - 運営者は **ユーザー（`owners`）とは別テーブル `operators`** で管理する（メール・名前・有効フラグ）。一般ユーザー登録を持つ必要はない。
   - **認証は共有管理キー（`ADMIN_SECRET`）を継続**するが、入力は **専用ログイン画面 `/operator-login.html`（画面#11）** で行い、**運営専用セッション `kimaru_admin_session`** を発行する。`operators` は運営者の登録情報・監査ログの実行者表示に用いる（将来、運営者ごとのメール+パスワード `operators.password_hash` ログインへ拡張）。
   - **ユーザー認証（`/login.html`・`kimaru_session`）とは完全分離**。運営画面は `kimaru_admin_session` で保護し、無ければ `/operator-login.html` へ（[screen-flow.md](../screen-flow.md) §6）。
6. **将来**
   - Cat Key の定期更新（自動ローテーション）と猫の集会グループチャット連携。
   - AI 検索 / 顧客検索（[14](./14-customer-management.md) 将来構想）、質問傾向などビッグデータの参照。

## 現状の実装

- `cat-key-admin.html` ＋ `invite-apply.js`（`?admin=cat-key`）で **Cat Key の一覧・revoke・restore・監査** は実装済み（[19](./19-cat-key-admin.md)）。
- revoke は `plan=free` / `invite_code=''` / `cat_key_disabled=true` を設定する。**Cat Key 利用者を前提とした降格**になっている。
- 認証は `ADMIN_SECRET`。

## 未実装（抜けている運営機能）

- ~~**全ユーザー一覧**~~ ✅ 実装済（`invite-apply?admin=cat-key` GET が全 owners を返却、`cat-key-admin.html` で検索・件数・プラン・登録日付きで一覧表示）。
- ~~**Cat Key 承認制**~~ ✅ 実装済（入力で `cat_key_pending=true`、運営コンソールで承認/却下→承認で pro 付与）。
- 運営コンソールとしての統合 UI（現状は Cat Key 専用ページのみ）。
- **運営者管理**（`operators` テーブル＋一覧/追加/削除 UI・API）。運営者を `owners` と分離して保持する。

> Cat Key 利用者の降格は実装済みで、**当面はこれで十分**（2026-06-03 方針）。任意の有料ユーザー（Square 等）の降格は将来対応・現時点では不要。

## 関連ファイル

- `public/operator-login.html` — 運営ログイン UI（共有管理キー入力 → 運営セッション発行。新規）
- `public/cat-key-admin.html` — 運営 UI（Cat Key・ユーザー管理）
- `public/operators.html` — 運営者管理 UI（運営アカウントの一覧/追加/削除。新規）
- `netlify/functions/invite-apply.js` — 管理モード（`?admin=cat-key`）
- DB: `owners`（`plan` / `cat_key_disabled` 等）、`cat_key_events`、`operators`（運営者アカウント・`owners` と分離）

## 残タスク

- ~~全ユーザー一覧の取得 API と画面~~ ✅ 完了（検索・件数・プラン・登録日表示）。
- ~~Cat Key 承認制（申請 → 承認/却下 → 付与）の導線と状態管理~~ ✅ 完了（`owners.cat_key_pending` ＋ 承認/却下UI・API）。
- 運営コンソールとしての画面統合（ユーザー一覧＋Cat Key＋プラン操作）。
- **運営ログイン**: `/operator-login.html` ＋ 運営専用セッション `kimaru_admin_session`（ユーザーの `kimaru_session` と別系統）。共有管理キーで認証。
- **運営者管理**: `operators` テーブル新設＋運営者の一覧/追加/削除 UI・API（`/operators.html`）。
- 将来: 任意の有料ユーザー（Square 等）の降格（サブスク解約との整合）／ Cat Key 自動更新／ AI 検索・データ参照。**いずれも現時点では不要**。
