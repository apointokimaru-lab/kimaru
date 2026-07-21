# 23. 議事録連携（マスタープラン）— 調査メモ

[← 機能一覧に戻る](./README.md)

- ステータス: 📝 調査メモ（将来構想・未着手）
- 対象プラン: 有料の上位「マスタープラン」想定
- 仕様: [`../spec.md`](../spec.md) 主要機能 14（将来構想 / マスタープラン）
- 調査日: 2026-06-03

> **実装メモ（2026-07-21）**: 検証用に置いていた暫定の汎用 inbound webhook（`meeting-notes-webhook` / `MEETING_NOTES_WEBHOOK_SECRET`）は、外部連携が未確定で誤動作の恐れがあるため**削除**した。本機能に着手する際に、下記の方針であらためて設計・実装する。

## 方針

打ち合わせ（2026-06-03）で「Google Meet 録音 → 議事録自動生成」は工数が大きいため後回し、と整理。
**自前で録音・文字起こしを作らず、既存の議事録AIと連携する**のが現実的という結論。

連携手段は2タイプ:

- **Webhook（プッシュ型）**: 会議終了後、議事録AI側がキマルの受信URLへ「文字起こし・要約・アクションアイテム」を送る。実装が軽い。**第一候補の方式**。
- **API（プル型）**: キマルから取得しに行く。柔軟だが実装は重い。

多くのツールは「**ボットが会議に自動参加して録音**」する方式で、Google Meet / Zoom / Teams をまたいで使える。

## 連携先候補の比較

| ツール | API | Webhook | 録音方式 | 連携しやすさ | 備考 |
|---|---|---|---|---|---|
| **Fireflies.ai** | ✅ GraphQL API | ✅ | ボット参加 | ◎ 最も開発者向き | 69言語、Slack/Notion/CRM連携豊富。音声投入で文字起こしも可 |
| **tl;dv** | ✅ 公開API（v1alpha1） | ✅（`MeetingReady` / `TranscriptReady`、user/team/org単位） | ボット参加 | ◎ | 無料枠あり、Meet/Zoom/Teams対応、APIキー発行 |
| **Circleback**（サークルバック） | △（Automations/CLI中心） | ✅（Automations から notes・action items・transcript・recording・insights を任意URLへ） | ボット参加 | ○ | 条件フィルタで対象会議を絞れる |
| **Notta** | △ APIはあるが情報が限定的 | △ | アプリ録音/アップロード | ○（Zapier等アプリ連携が主） | 多言語に強いが開発者向けAPIは弱め |
| **Google Meet REST API（純正）** | ✅ | △（Workspace Events） | Meet 純正の録音/文字起こし | ○（Meet限定） | キマルは既に Meet 発行済みで相性良。ただし制約あり（下記） |

## キマル視点の選択肢（2方向）

1. **純正の Google Meet REST API**（Meet に閉じるなら最有力）
   - 会議終了後に文字起こし・録画（artifacts）を取得可能。外部サービス不要。
   - ⚠️ 制約: **Google Workspace（有料）が必要**（個人 Gmail 不可）、管理者が録画/文字起こしを許可し、**ホストが会議中に手動開始**する必要、文字起こしデータは**30日で削除**、保存先は主催者の Drive。
2. **第三者の議事録AI（Webhook連携）= tl;dv / Fireflies / Circleback**
   - ボットが参加するので **Zoom や個人アカウントでも動く**＝キマルのユーザー層に合う。
   - 流れ: 会議終了 → Webhook でキマルに議事録が届く → **相手管理（[14](./14-customer-management.md)）に自動保存**。

## 推奨（第一候補）

- **第一歩: Webhook 受信口を1つ作り、tl;dv または Fireflies を繋ぐ**（低コスト）。
  - 第一候補は **tl;dv**（無料枠・公開API・Webhookの `TranscriptReady` が分かりやすい）または **Fireflies**（API/連携が最も豊富）。
- 将来、Workspace 前提の法人顧客には **Meet 純正 API** も併用する二段構え。

## 残タスク（着手時）

- 議事録 Webhook 受信エンドポイント（`/api/meeting-minutes-webhook` 想定）の新設。
- 受信した議事録を予約/相手（[14](./14-customer-management.md)）に紐付けて保存する DB 設計。
- 連携ツールの最終選定（tl;dv / Fireflies）とアカウント・APIキー運用。
- マスタープランの価格・提供範囲の決定（[13](./13-plans.md)）。

## 参考リンク（調査 2026-06-03）

- Circleback — Webhooks: https://support.circleback.ai/en/articles/11014015-export-meeting-data-with-webhooks
- Circleback — Webhook in Automations: https://circleback.ai/releases/webhook-integration-in-automations
- tl;dv API: https://doc.tldv.io/index.html
- tl;dv — API and Webhooks: https://intercom.help/tldv/en/articles/11583137-api-and-webhooks
- Fireflies.ai API: https://fireflies.ai/api
- Notta Help Center: https://support.notta.ai/hc/en-us
- Google Meet REST API overview: https://developers.google.com/workspace/meet/api/guides/overview
- Google Meet — Work with artifacts: https://developers.google.com/workspace/meet/api/guides/artifacts
- Google Meet — conferenceRecords.transcripts: https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts
