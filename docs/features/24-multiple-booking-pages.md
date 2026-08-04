# 24. 複数の予約ページ（日程調整URL）

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済（複数ページ保存・一覧・削除・`/b/{slug}` 公開解決。**受付時間もページ単位**＝#263 で解消）
- 対象プラン: 共通（保存数の上限がプランで異なる）
- 仕様: [`../spec.md`](../spec.md) 主要機能 2〜7（予約設定）/ 13（プラン）

## 概要

設定の異なる日程調整 URL（予約ページ）を **複数保存** できるようにする。
用途例: 「30分・Meet」「60分・対面」「初回相談用」「既存顧客用」などを使い分ける。

## 仕様詳細

- 1 つの予約ページ ＝ 時間・前後バッファ・受付期間・開催方法・受付可能時間・事前アンケートの 1 セット。
- 保存できる予約ページ数の上限:

| プラン | 保存できる予約ページ数 |
|---|---|
| 無料 | **1 つまで**（旧 2） |
| 有料（Pro） | **2 つまで**（旧 5） |
| プレミアム | **5 つまで** |
| 猫メンバー（プロキー） | Pro と同等（2 つ）／**マスターキーはプレミアム同等（5 つ）** |

> 2026-06-18 決定27 で **1・2・5** に変更（旧 無料2/Pro5）。上限は `_lib/plan-limits.js` の `PLAN_LIMITS`。

- それぞれ固有の URL（slug）を持ち、相手に応じて使い分けて共有する。
- **URL 設計（決定 2026-06-03）**: クリーンパス **`/b/{slug}`**。`slug` は**グローバルに一意**（オーナーは複数ページを持てるが slug は全体で一意）。Netlify リダイレクトで `/b/:slug` → `booking.html` に解決。詳細 [open-decisions.md](../open-decisions.md) 決定4。

## 現状の実装（前提）

- `booking_pages` は存在するが、**実質1オーナー1ページ前提**（`slug` 既定 `'demo'`、`owners.slug` も単一）。
- `booking-page-save` は単一ページを upsert する作り。
- → **複数ページの作成・一覧・切替・削除は未対応**。

## 関連ファイル

- `public/booking-settings.html` / `public/app.js` — 予約ページ作成・編集 UI（複数対応が必要）
- `netlify/functions/booking-page-save.js` — 保存（複数ページ＋プラン別上限チェックが必要）
- `netlify/functions/availability.js` / `public/booking.html` — 公開ページは slug ごとに解決する必要
- DB: `booking_pages`（オーナーあたり複数行を許可する設計変更が必要）

## 残タスク

- **DB**: `booking_pages.slug` は**グローバル一意のまま**でよい（決定4）。**1オーナー複数行を許可**する変更のみ（単一ページ前提の解消）。
- **ルーティング**: `/b/{slug}` → `booking.html` の Netlify リダイレクト追加。
- **保存数上限の実効**: 無料1 / Pro2 / プレミアム5（`_lib/plan-limits.js`）。上限超過は 403（`booking-page-save`）。プラン判定は [13](./13-plans.md) と連動。
- **UI**: 予約ページの一覧・新規作成・編集・削除・URL コピー（`booking-settings.html`）。
- **公開ページ**: slug で該当ページの設定・空き枠を解決して表示（`booking.html` / `availability`）。

## 受付時間のページ分離（#263・2026-08-04）

- 症状: A・B 2つの予約ページを作ると、A の公開ページに B の受付時間（曜日・時間帯）が出る。
- 原因: `availability_settings` が **オーナー単位**で、`booking-page-save` が保存のたび `owner_id` 単位で全削除→再投入していたため、後から保存したページの受付時間で全ページが上書きされていた。
- 対応: `availability_settings.booking_page_id` を追加し、保存・読み出しをページ単位に変更。
  - 保存（`booking-page-save`）: `booking_page_id` 一致行だけ入れ替え。
  - 読み出し（`_lib/availability-core.js` `pageAvailability`）: ページ専用行 → 無ければ `booking_page_id=null` の旧共有行 → 無ければ既定（平日10:00–18:00）。
  - 既存データは `booking_page_id=null` のまま残し、まだ編集していないページのフォールバックとして機能する（強制移行しない）。
  - 列が未適用の環境ではオーナー単位の旧挙動へデグレード（`alter table ... add column if not exists` を両DBへ手動適用すること）。
- 回帰テスト: `scripts/test/unit.mjs` の「per-page availability」節（A→B 保存後に A の公開ページを検証）。
