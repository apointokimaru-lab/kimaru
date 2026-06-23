# 12. 招待コード（Cat Key）

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済
- 対象プラン: 共通
- 仕様: [`../spec.md`](../spec.md) 主要機能 9

## 概要

猫の集会メンバー用の招待コード（Cat Key）入力欄を設け、コードを入力したユーザーは有料版機能を無料で使えるようにする。

## 仕様詳細

- 招待コード: `Neko20240222`
- 適用したユーザーは有料版機能を無料で利用可能。

## 現状の実装

- `dashboard.html` の Cat Key パネルにコード入力 UI。`invite-apply` が大文字化して照合。
- 有効コード: `NEKO20240222`（= Cat Key `Neko20240222`、大文字化して比較）。
- 適用で `owners.plan='pro'` ＋ `invite_code` 更新。`cat_key_events` に監査ログ（成功/無効/形式不正/ブロック）。
- `cat_key_disabled` のアカウントは適用不可（403）。
- 運営向けに Cat Key 管理モードあり（[19](./19-cat-key-admin.md)）。

## 関連ファイル

- `netlify/functions/invite-apply.js` — コード適用・監査・管理モード
- `public/dashboard.html` — 入力 UI（`#cat-key-panel`）
- DB: `owners.invite_code` / `owners.plan` / `owners.cat_key_disabled`、`cat_key_events`

## 残タスク

- 仕様の `invite_codes` テーブル運用は未採用（コードは関数内 `proCodes` セットで管理）。テーブル化するかは要判断。
- プラン解放の保証は [13. プラン](./13-plans.md) と連動。
