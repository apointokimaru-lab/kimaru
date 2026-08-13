# 29. 予約ページの受付一時停止

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済
- 対象プラン: 共通（無料版でも利用可）
- 関連: [08](./08-booking.md) / [24](./24-multiple-booking-pages.md)

## 概要

予約ページを **削除せずに一時停止** できる。停止中の公開ページは **404（ページが見つかりません）** になり、予約も受け付けない。再開はいつでも可能。

## 仕様詳細

- アポイント設定エディタの「受付状態」で **受付中 / 受付停止中** を切り替え（`booking_pages.is_active`）。
- 停止中:
  - 公開ページ（`/b/<slug>`）は `/404.html` に置き換わる（`availability` が `paused:true` を返し、`booking-week.js` が `location.replace`）。
    2026-08-14（#321）に「現在受付を停止しています」の案内から変更。案内文だとURLは生きていて時間を置けば予約できるように読め、相手が待ってしまうため。
    ピンポイントリンク（`/p/<token>`）も、元の予約ページが停止中なら同じく404にする。
  - 予約API（`/api/book`）は停止中ページへの予約を 400 で拒否。
  - 予約設定の一覧に「受付停止中」バッジ。

## 関連ファイル

- `public/booking-settings.html`（受付状態セレクト）/ `public/app.js`（保存・復元・一覧バッジ）
- `netlify/functions/booking-page-save.js`（`is_active` 保存・既存）
- `netlify/functions/availability.js`（停止中は `paused`）
- `netlify/functions/book.js`（停止中は予約拒否）
- `public/booking-week.js`（停止中の表示）

## 残タスク・将来

- 期間指定の自動停止/再開（特定期間だけ止める）。
