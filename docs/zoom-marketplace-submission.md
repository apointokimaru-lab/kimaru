# Zoom Marketplace 公開申請の提出物（2026-07-16 作成）

[← docs 索引](./README.md)／実装は [features/06-location-type.md](./features/06-location-type.md)

一般ユーザーにZoom連携を開放するための公開審査（Ready for submission → Functional review → Security review → Publish）に使う資料。**申請前チェックリスト**と**貼り付け用の文面**をここに集約する。

## 申請前チェックリスト（Zoom管理画面＝人間タスク）

1. ☐ **Event Subscription を有効化**（Production）: Features → Access → Event Subscription をON
   - Event notification endpoint URL: `https://kimaru-co.jp/api/zoom-deauthorize`
   - イベント: **App Deauthorized**（app_deauthorized）を追加
   - 「Validate」ボタンでURL検証が green になること（デプロイ後に実施）
2. ☐ **Secret Token** を Netlify env `ZOOM_WEBHOOK_SECRET_TOKEN` に設定（Access ページの Secret Token。スクリーンショットに写ったことがあるため **Regenerate してから**設定を推奨）
3. ☐ `supabase-schema.sql` の `zoom_connections.zoom_user_id` 列を dev/本番に適用
4. ☐ 本番デプロイ（zoom-deauthorize エンドポイント含む）
5. ☐ App Listing 記入（下記の文面を使用）＋スクリーンショット添付
6. ☐ Beta Test ページの「supporting security evidence」（セキュリティ質問票）回答（下記草案を使用）
7. ☐ Submit for review

## App Listing 文面（貼り付け用）

- **App name**: キマル (Kimaru)
- **Category**: Scheduling / Productivity
- **Short description (EN)**:
  > Kimaru is a 1-on-1 scheduling tool. Connect your Zoom account and every booking automatically gets a Zoom meeting created under your name — updated on reschedule, deleted on cancellation.
- **Short description (JA)**:
  > 1対1の日程調整ツール「キマル」。Zoomアカウントを接続すると、予約が入るたびにあなた名義のZoomミーティングを自動発行。日程変更で自動更新、キャンセルで自動削除します。
- **Long description (EN)**:
  > Kimaru (kimaru-co.jp) is a Japanese 1-on-1 scheduling service for consultants, coaches, and small business owners. Guests book a time from the host's availability page; Kimaru then creates the calendar event and meeting link automatically.
  >
  > With the Zoom integration, the meeting link is issued on the host's own Zoom account:
  > - **Create**: when a guest books a "Zoom" type appointment, a scheduled Zoom meeting is created and the join URL is shared with the guest (meeting:write:meeting).
  > - **Update**: when the booking is rescheduled, the meeting's start time is updated — the join URL never changes (meeting:update:meeting).
  > - **Delete**: when the booking is cancelled, the meeting is deleted (meeting:delete:meeting).
  > - **Account display**: the connected Zoom account's email is shown on the settings page so the host knows which account is linked (user:read:user).
  >
  > Kimaru only calls the Zoom API in response to the host's own booking events. It does not read meeting contents, recordings, or participate in meetings. Access tokens are stored encrypted (AES-256-GCM) and are deleted immediately when the host disconnects in Kimaru or uninstalls the app on Zoom.
- **Support URL**: `https://kimaru-co.jp/`（お問い合わせ導線のあるページ）
- **Privacy Policy URL**: `https://kimaru-co.jp/privacy.html`（第3条にZoom条項あり）
- **Terms of Use URL**: `https://kimaru-co.jp/terms.html`
- **Developer contact**: キマル運営 / apointokimaru@gmail.com

## Functional review 用テスト手順（貼り付け用・EN）

> 1. Sign up at https://kimaru-co.jp/signup.html (or use the provided test account below).
> 2. Open Settings (設定) → External integrations (外部連携) → click "Connect Zoom" (Zoomと連携する). Complete the Zoom OAuth consent. The settings page shows "connected".
> 3. In Booking settings (予約設定), set the meeting type of your booking page to "Zoom".
> 4. Open your public booking page (シェア用URL), book a slot as a guest with any email address.
> 5. Verify a scheduled meeting appears in the connected Zoom account, and the confirmation email contains the zoom.us join URL.
> 6. Open the manage link in the confirmation email → "Change date" (日程を変更): pick a new slot. Verify the Zoom meeting's start time is updated (same join URL).
> 7. From the same manage link, cancel the booking. Verify the meeting disappears from the Zoom account.
> 8. Deauthorization: remove the app from the Zoom account (Marketplace → Manage → Added Apps). Kimaru deletes the stored connection/tokens upon receiving app_deauthorized.

- ☐ 審査用テストアカウント（メール/パスワード）を発行して記載する（プランは無料でよい。Zoom連携は全プラン利用可）
- ☐ デモ動画（任意だが推奨）: 上記手順の画面録画。Google審査で作った動画と同じ要領

## Security review（質問票の回答草案）

| 質問（想定） | 回答 |
|---|---|
| What data do you store? | Zoom OAuth access/refresh tokens (encrypted with AES-256-GCM), the connected account's email and user ID, and the meeting join URL of bookings. No meeting contents, recordings, or participant data. |
| How are tokens stored? | Encrypted at rest with AES-256-GCM (key from environment secret), in Supabase (PostgreSQL). Transport is TLS only. Tokens are never logged or exposed to the client. |
| Token refresh / rotation | Access tokens are refreshed via refresh_token grant; Zoom's rotated refresh tokens replace the stored value on every refresh. |
| Data deletion | Users can disconnect in Kimaru settings (row deleted immediately). Uninstalling the app on Zoom triggers the app_deauthorized webhook (signature-verified) and the stored connection is deleted immediately. Account deletion cascades (FK on delete cascade). |
| Scope justification | meeting:write:meeting (create on booking), meeting:update:meeting (reschedule), meeting:delete:meeting (cancellation), user:read:user (show connected account email). Minimum required set; no admin scopes. |
| Webhook security | Endpoint verifies Zoom's x-zm-signature (HMAC-SHA256 with Secret Token) and rejects stale timestamps (±5 min). URL validation challenge implemented. |
| OAuth security | Authorization Code flow with state parameter (HMAC-signed, bound to the logged-in user, 10-minute expiry). Redirect URI is fixed and registered. Client secret is server-side only. |
| Infrastructure | Netlify (serverless functions, TLS enforced via HSTS), Supabase (managed PostgreSQL). Environment secrets via Netlify environment variables. |
| Who can access production data? | Only the service operator (single-person ops). Admin console is protected by a separate secret-based session. |

## 実装メモ（審査で聞かれたときの根拠）

- deauth webhook: `netlify/functions/zoom-deauthorize.js`（署名検証・URL検証・`zoom_user_id` で接続削除）
- トークン暗号化: `_lib/crypto.js` encrypt（AES-256-GCM）／保存: `zoom_connections`
- OAuth フロー: `zoom-auth-start.js`（signed state）→ `zoom-auth-callback.js`（state検証・本人一致）
- 発行/更新/削除: `_lib/zoom.js` `createMeetingFor` / `updateMeetingByUrl` / `deleteMeetingByUrl`（`book.js` / `booking-manage.js` から呼び出し）
