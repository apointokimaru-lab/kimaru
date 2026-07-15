# 06. 開催方法

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済（Zoom 自動発行は**ユーザー個別連携**〔2026-07-15 決定〕・env と Zoom アプリ審査待ち）
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
- **Zoom 自動発行（#23・2026-07-15 にユーザー個別連携へ刷新）**: ホスト本人が設定画面（`settings.html` 外部連携）の「Zoomと連携する」で自分の Zoom アカウントを **user-level OAuth** 接続（`zoom-auth-start.js`/`zoom-auth-callback.js`・state は署名ブロブで本人一致検証・トークンは `zoom_connections` に暗号化保存・リフレッシュ自動）。`book.js` は `location_type=zoom` の予約時に**ホスト本人名義**でミーティングを作成（`_lib/zoom.js createMeetingFor`）し join_url を `meeting_url` へ保存。未連携・env（`ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET`）未設定・テーブル未適用のいずれでも発行スキップ（予約自体は成立＝手動URL運用）。解除は `zoom-disconnect.js`。連携状態は `/api/me` の `zoom_connected`。**運営名義の Server-to-Server 方式は廃止**（`ZOOM_ACCOUNT_ID` 不要）。
- **リスケ・キャンセル連動（booking-manage.js）**: リスケ時は既存 Zoom ミーティングの日時を更新（URL 不変・`meeting_url` は Google イベント再作成でも上書きしない）、キャンセル時はミーティングを削除（404=削除済みは成功扱い）。いずれも失敗は非致命（予約操作は成立）。ミーティングIDは DB 列を持たず `meeting_url` の `/j/{id}` から復元（`zoom.js meetingIdFromUrl`）。

## 関連ファイル

- `public/booking-settings.html` / `public/app.js` — UI・種別別入力欄
- `netlify/functions/booking-page-save.js` — 検証・保存
- `netlify/functions/book.js` — 予約への `location_type` 反映
- DB: `booking_pages.location_type` / `location_value`、`bookings.location_type` / `meeting_url`

## 残タスク

- **Zoom の残り（人間タスク）**: ① Zoom Marketplace で **User-managed OAuth アプリ**を作成（scope: `meeting:write`＋`user:read`、リダイレクトURI `https://kimaru-co.jp/api/zoom-auth-callback`）→ `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` を env 設定 ② `supabase-schema.sql`（`zoom_connections`）を dev/本番へ手動適用 ③ **外部ユーザーに連携させるには Zoom Marketplace の公開審査が必要**（未公開アプリは開発者と同一 Zoom アカウントのユーザーのみ認可可＝開発検証はそれで可能）。Google Meet と同様、**無料・有料の両プランで提供**（有料限定ではない）。
- 対面/電話/カスタムURLの値を予約完了メール（[11](./11-notification-email.md)）へ反映する導線の整備。
