# Zoom Marketplace 公開申請の提出物（2026-07-16 作成）

> **✅ 2026-07-16 提出完了（Submit for review 済み）。** 初回返答SLA 72時間・公開まで4週間超の場合あり（FIFO審査）。ステータスは Marketplace の「Track App Status」で確認。審査からの連絡は apointokimaru@gmail.com 宛て。
> 提出時の構成: ドメイン検証済み（検証ファイルは `public/ZOOM_verify_*.html`・**Netlify の Pretty URLs を無効化して対応**）、App activation=承認後に自動有効化、テスト環境=Windows/macOS、テストアカウント記載済み。

[← docs 索引](./README.md)／実装は [features/06-location-type.md](./features/06-location-type.md)

一般ユーザーにZoom連携を開放するための公開審査（Ready for submission → Functional review → Security review → Publish）に使う資料。**申請前チェックリスト**と**貼り付け用の文面**をここに集約する。

## 申請前チェックリスト（Zoom管理画面＝人間タスク）

1. ☑ **Event Subscription を有効化**（Production）: Features → Access → Event Subscription をON
   - Event notification endpoint URL: `https://kimaru-co.jp/api/zoom-deauthorize` → 「Validate」で検証
   - **注（General App の仕様）**: `app_deauthorized` は Event Types の一覧に**出てこない**。Marketplaceイベントとして、**公開後に検証済みエンドポイントへ自動配信**される（[Marketplace Webhooks](https://developers.zoom.us/docs/api/marketplace/events/)）。**未公開アプリには配信されない**ため公開前の実地テストは不可（[End user authorization](https://developers.zoom.us/docs/integrations/end-user-auth/)）。
   - 保存にイベント選択が必要な場合は「User」カテゴリの「User Updated」等、**既存スコープ範囲のイベント**を選ぶ（エンドポイントは未知イベントを安全に無視する）。
2. ☑ **Secret Token** を Netlify env `ZOOM_WEBHOOK_SECRET_TOKEN` に設定（Access ページの Secret Token。スクリーンショットに写ったことがあるため **Regenerate してから**設定を推奨）〔2026-08-03 本番 env に設定済みを確認〕
3. ☑ `supabase-schema.sql` の `zoom_connections.zoom_user_id` 列を dev/本番に適用〔2026-08-03 両DBで列の存在を確認〕
4. ☑ 本番デプロイ（zoom-deauthorize エンドポイント含む）〔`POST /api/zoom-deauthorize` が署名なしリクエストを 401 で拒否＝稼働中〕
5. ☑ App Listing 記入（下記の文面を使用）＋スクリーンショット添付〔2026-07-16 提出〕
6. ☑ Beta Test ページの「supporting security evidence」（セキュリティ質問票）回答（下記草案を使用）
7. ☑ Submit for review〔2026-07-16 初回提出 → 指摘対応後 2026-07-22 再提出〕

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

## 審査コメント「API コールが認可時の1回だけ」への対応（2026-08-03 調査）

Functional review で **"only one api call was made, this happened during authorization"**（2026-07-18）と指摘された。本番DBを確認した結果、**アプリの不具合ではなく手順の順序**が原因だった。

- 実運用で Zoom API を呼ぶのは **ゲストが予約を完了した瞬間**（`book.js` → `createMeetingFor`）で、ホストがアプリ内を操作しても発生しない。ホスト画面だけを触る審査では認可時の `GET /v2/users/me` しか出ない。
- 本番の予約データ: 審査アカウント `ben.user1@zoomappsec.us` の予約は **2026-07-17 18:43 UTC（Zoom未接続の状態で予約）→ `meeting_url` 空**。一方 **2026-07-22 17:20 UTC の予約は成功**し、`meeting_url` に審査者自身のZoomドメイン（`pooja-onelogin-test.zoom.us/j/…`）が入っている＝`POST /v2/users/me/meetings` が成功している。**7/22 の再提出時点では実コールが発生済み**なので、返信ではこの予約を証拠として示す。
- 恒久対策（2026-08-03 実装）:
  - **設定画面に「接続テスト」ボタン**（`zoom-test.js`）を追加。テスト用ミーティングを1件作成→即削除するので、**ホストのアプリ内操作だけで `POST /meetings` と `DELETE /meetings/{id}` の実コールを審査者に見せられる**。
  - Zoom未連携のまま開催方法「Zoom自動発行」の予約が入ると、従来は**無言でURL無しの予約**になっていた。予約設定画面に警告を出し（`#zoom-warning`）、発行失敗時はホスト通知メールに明記＋関数ログに記録するようにした。

## Functional review 用テスト手順（貼り付け用・EN）

> 1. Sign up at https://kimaru-co.jp/signup.html (or use the provided test account below).
> 2. Open Settings (設定) → External integrations (外部連携) → click "Connect Zoom" (Zoomと連携する). Complete the Zoom OAuth consent. The settings page shows "connected".
> 3. **On the same settings page, click "Test connection" (接続テスト). This immediately calls the Zoom API twice: it creates a scheduled meeting (`POST /v2/users/me/meetings`) and deletes it again (`DELETE /v2/meetings/{meetingId}`).** Please note that in normal use the meeting is created when a *guest* books — clicking around as the host does not call the API, which is why an earlier review saw only the authorization call.
> 4. In Booking settings (予約設定), set the meeting type of your booking page to "Zoom" (Zoom自動発行), and save. **Both steps matter: the meeting type belongs to the booking page, and the Zoom account must be connected before the booking is made.**
> 5. Open that booking page's public URL (シェア用URL) in a private window, and book a slot as a guest with any email address.
> 6. Verify a scheduled meeting appears in the connected Zoom account, and the confirmation email contains the zoom.us join URL.
> 7. Open the manage link in the confirmation email → "Change date" (日程を変更): pick a new slot. Verify the Zoom meeting's start time is updated (same join URL) — `PATCH /v2/meetings/{meetingId}`.
> 8. From the same manage link, cancel the booking. Verify the meeting disappears from the Zoom account — `DELETE /v2/meetings/{meetingId}`.
> 9. Deauthorization: remove the app from the Zoom account (Marketplace → Manage → Added Apps). Kimaru deletes the stored connection/tokens upon receiving app_deauthorized.

- ☑ 審査用テストアカウントを発行して記載済み（プランは無料でよい。Zoom連携は全プラン利用可）
  - ログイン: `apointokimaru+zoomreview@gmail.com`（**パスワードは運営メモ側に保持。リポジトリには書かない**）
  - Zoom開催の予約ページ: `https://kimaru-co.jp/b/zoom-review`（月〜金 9-18 JST・空き枠あり・`location_type=zoom`）
  - **審査承認まで削除しない**（過去に一度消して作り直した経緯あり）
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
