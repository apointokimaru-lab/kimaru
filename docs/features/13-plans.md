# 13. プラン（無料 / 有料）

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済（主要な制限ロジックを実装）
- 対象プラン: 共通
- 仕様: [`../spec.md`](../spec.md) 主要機能 7・8

## 概要

無料版と有料版で利用できる機能・上限を分ける。招待コード（[12](./12-invite-code.md)）利用者は有料版相当を無料で使える。

## 仕様詳細

| 機能 | 無料版 | 有料版 |
|---|---|---|
| Google カレンダー連携 | ✅ | ✅ |
| 予約形式 | 1 対 1 | 1 対 1 ＋複数名調整 |
| 予約ページ（日程調整URL）保存数 | 2つまで | 5つまで |
| 公開範囲 | 2ヶ月先まで | 6ヶ月先まで |
| 予約時間 | 30/45/60分 | 30/45/60分 |
| 前後バッファ | ✅ | ✅ |
| 事前アンケート | 最大 2 問 | 最大 5 問（編集・必須設定可） |
| リマインダー（22分前） | ✅ | ✅ |
| Google Meet 自動発行 | ✅ | ✅ |
| Zoom 自動発行 | ※将来対応 | ※将来対応 |
| 予約完了メール | ✅ | ✅ |
| 会員同士の相互質問 | ✅ | ✅ |
| 高度プロフィール / 占い的インサイト | − | ✅ |
| 顧客管理 / 予約履歴 | − | ✅ |
| 無料お試し期間 | − | なし（登録時に即時課金） |
| AI 要約 / AI検索 | − | ※将来対応 |
| 議事録(Meet録音) / 法人プラン | − | ※将来（上位プラン） |

> 料金: 有料版 ¥980/月。プランは無料/有料の2段階を基本。打ち合わせ（2026-06-03）で公開範囲 無料を 3→2ヶ月 に変更。アンケートは無料2問・有料5問で据え置き。

## 現状の実装

- `owners.plan`（`free` / `pro` / `premium`）が存在。昇格経路は2つ:
  - 招待コード（Cat Key）適用（[12](./12-invite-code.md)）＝ Pro 付与
  - Square 決済 Webhook（`square-webhook` が payment/subscription イベント＋email でオーナーを `pro`、`SQUARE_PREMIUM_PLAN_ID` 一致時は `premium` に更新）
- プラン別制限が `booking-page-save` で実効:
  - 受付期間: 無料は最大3ヶ月（6要求は 403、`updateBookingPageControls` で UI も無効化）※打ち合わせ決定の「無料2ヶ月」は未反映（[05](./05-booking-range.md)）
  - 事前アンケート設定数: 無料2問 / 有料5問（超過は 403）
- サーバ判定は `isProPlan`（pro/premium）・`requireProOwner`（pro/premium）・`requirePremiumOwner`（premium のみ）。
- **フロント（2026-06 改修）**: 全画面を「知/AIオーロラ」配色へリスキン。`public/plan.js` が `/api/me` から `body` に `plan-free`/`plan-pro`/`plan-premium` を付与し、`window.KimaruPlan`（`isPro`/`isPremium`/`planLabel`）＋ `kimaru:plan` を提供。料金ページ `plan.html`・ダッシュボード（3価値帯）・比較表（index）は3段（無料/Pro/プレミアム）で、プレミアム面のみオーロラ表現。**プレミアムは UI 上「近日公開（フェーズ2）」**＝ Square 即購入は Pro のみ・AIアシストのサーバ経路は `ai-assist.html` の `PREMIUM_AI_LIVE=false` でガード（決定20）。ヘッダーナビは「Pro版」→「料金」（`nav.pricing`）。

## 関連ファイル

- DB: `owners.plan`
- `netlify/functions/invite-apply.js` — Cat Key 昇格
- `netlify/functions/square-webhook.js` — 決済による昇格
- `netlify/functions/booking-page-save.js` / `public/app.js` — 制限の実効・UI制御

## 将来のプラン構想（打ち合わせ 2026-06-03）

- **決済は Square**（決定 2026-06-03。`square-webhook.js` 実装済み）。
- **無料お試し期間**: **なし**。登録時に即時課金（¥980/月）・以後毎月自動課金。※Square で1ヶ月無料トライアルを実装できなかったため廃止（旧決定2026-06-03を撤回）。
- **マスタープラン**: 有料の上位。Google Meet 録音 → 議事録自動生成（工数大のため後回し）。
- **法人 / エンタープライズ**: 組織向け。月1万円〜も想定。紹介・マッチング型課金（段階課金、Deeps 参考）も検討余地。

## 残タスク

- **無料の公開範囲を実装に反映**: 3→2ヶ月（[05](./05-booking-range.md)）。
- プラン判定の共通関数化（現状は各所で個別に `plan==="pro"` 判定）。
- ~~無料お試し期間の導入~~ ❌ **廃止**（Square で1ヶ月無料トライアルが実装不可のため）。`square-webhook` は `trial_ends_at` を付与せず即時課金扱い。`owners.trial_ends_at` 列は未使用で残置。
- 複数名調整など有料専用機能の追加。
- 事前アンケートのゲスト表示はプラン制限以前に未配線（[10](./10-questionnaire.md)）。
