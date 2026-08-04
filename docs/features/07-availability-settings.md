# 07. 受付可能時間（曜日・時間帯）

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済
- 対象プラン: 共通
- 仕様: [`../spec.md`](../spec.md) DB 設計 `availability_settings`

## 概要

発行者が「予約を受け付ける曜日と時間帯」を設定でき、空き枠生成はこの設定の範囲内かつ Google カレンダーの予定を避けて行う。

## 仕様詳細

- 曜日ごとに開始・終了時刻を設定（`day_of_week` / `start_time` / `end_time`）。
- **設定は予約ページ単位**（`booking_page_id`・#263）。ページAの受付時間を変えてもページBには影響しない（[24](./24-multiple-booking-pages.md)）。

## 現状の実装

- 予約設定画面に 月〜日の有効チェック＋開始/終了時刻の入力 UI あり（既定: 平日 10:00–18:00 有効、土日無効）。新規ページは「共有設定→先頭ページの設定」を初期値として引き継ぐ（保存しても他ページには影響しない）。
- `booking-page-save` が時刻形式・開始<終了を検証し、`availability_settings` の**そのページぶんだけ**（`booking_page_id` 一致）を削除→再投入で保存。
- `availability.js` / `availability-days.js` が `_lib/availability-core.js` の `pageAvailability()` で読む（ページ専用行 → `booking_page_id=null` の旧共有行 → 平日 10:00–18:00 の既定）。Asia/Tokyo 計算。
- 日程変更（`booking-manage.js`）の受付時間チェックも同じページ単位の解決を使う。

## 関連ファイル

- `public/booking-settings.html` / `public/app.js` — 曜日別 UI（`updateAvailabilityRows` / `applyAvailability`）
- `netlify/functions/booking-page-save.js` — `normalizeAvailability` で検証・ページ単位で保存
- `netlify/functions/booking-pages.js` — 一覧APIが各ページに `availability` を付けて返す
- `netlify/functions/_lib/availability-core.js` — `pageAvailability()`（ページ→共有→既定の解決）
- `netlify/functions/availability.js` / `availability-days.js` — 枠生成へ反映
- DB: `availability_settings`（`booking_page_id`）

## 残タスク

- なし（基本実装は完了）。`availability_settings.booking_page_id` の `alter table` は dev/本番の両DBへ手動適用が必要。
