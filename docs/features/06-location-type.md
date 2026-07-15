# 06. 開催方法

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済（Zoom 自動発行もコードは実装済み・`ZOOM_*` env 設定時のみ有効＝現状未設定・未検証）
- 対象プラン: 共通
- 仕様: [`../spec.md`](../spec.md) 主要機能 5

## 概要

予約ページ作成時に発行者が開催方法を選択できる。選択により入力欄や予約後の挙動が変わる。

## 仕様詳細

選択肢: 対面 / Google Meet 自動発行 / Zoom 自動発行(将来) / 電話 / カスタム URL / 後で連絡。

## 現状の実装

- 予約設定画面に開催方法の選択 UI（`location_type`）あり。`app.js` の `updateBookingPageControls` が対面/電話/カスタムURLのとき詳細入力欄（`location_value`）を表示し、種別に応じた placeholder を切替。
- `booking-page-save` が `location_type ∈ {in_person, google_meet, zoom, phone, custom_url, later}` を検証して保存。
- `book.js` は予約の `location_type`（既定 `google_meet`）を保存。Google Meet の場合は [09](./09-google-meet.md) でリンク自動発行。
- **Zoom 自動発行（#23・実装済み）**: `_lib/zoom.js` が **Server-to-Server OAuth**（`ZOOM_ACCOUNT_ID`/`ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET`）で `users/me/meetings` を作成し、`book.js` が `location_type=zoom` の予約時に join_url を `meeting_url` へ保存。env 未設定なら発行スキップ（予約自体は成立）。**発行元は env に設定した単一 Zoom アカウント（＝運営名義）**で、ユーザーごとに自分の Zoom を接続する口（user-level OAuth）は未実装（`settings.html` に「今後対応予定」の注記のみ）。

## 関連ファイル

- `public/booking-settings.html` / `public/app.js` — UI・種別別入力欄
- `netlify/functions/booking-page-save.js` — 検証・保存
- `netlify/functions/book.js` — 予約への `location_type` 反映
- DB: `booking_pages.location_type` / `location_value`、`bookings.location_type` / `meeting_url`

## 残タスク

- **Zoom の残り**: ①`ZOOM_*` env の設定と実機検証（S2S トークンで `users/me` が拒否される場合は `users/{メールアドレス}` へ切替の小修正）②**ユーザー自身の Zoom アカウントで発行する user-level OAuth 連携**（Google 連携と同型: zoom-auth-start/callback＋トークン暗号化保存＋settings に接続ボタン。外部ユーザーへ公開するには Zoom Marketplace のアプリ審査が必要）。Google Meet と同様、**無料・有料の両プランで提供**（有料限定ではない）。
- 対面/電話/カスタムURLの値を予約完了メール（[11](./11-notification-email.md)）へ反映する導線の整備。
