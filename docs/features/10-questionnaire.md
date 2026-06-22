# 10. 事前アンケート

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ 実装済（設定・保存＋ゲスト動的表示・回答保存。無料2問/有料5問）／✅ **選択式回答 実装済**（決定27・2026-06-19・Pro+。要DB列 `answer_type`/`options` 適用）
- 対象プラン: 共通（質問数・回答形式がプランで異なる）
- 仕様: [`../spec.md`](../spec.md) 主要機能 6

## 概要

予約時にゲストへ事前質問を提示し、回答を保存する。質問数・編集可否・回答形式はプランで変わる。

### 回答形式のプラン差（決定27・2026-06-19・✅実装済）

- **無料＝回答者は自由入力のみ**。
- **Pro・プレミアム＝発行者が選択式回答（プルダウン／チェックボックス等）も設定できる**（自由入力との併用可）。
- 実装: `questionnaire_questions.answer_type`(text/select/checkbox)＋`options`(jsonb)。設定UI＝`app.js`（`questionRowHtml`/型selectの`change`で選択肢欄を出し分け・Pro+のみ表示）、保存＝`booking-page-save.js`（`normalizeQuestion` でプラン検証＝無料は text 固定・選択肢空なら text に降格）、配信＝`availability.js`/`booking-pages.js`（answer_type/options を返す）、ゲスト＝`booking-week.js`（`renderQuestions` が select/checkbox/textarea を出し分け、`readQuestionField` がチェックボックスを「, 」連結）。**未マイグレーション環境では型情報を落として自由入力にフォールバック**（booking-page-save / booking-pages に try/catch）。

## 仕様詳細

- 無料版: 最大 **2 問**（初期: 「今回お話したい内容」「今、実現したい夢や目標は何ですか？」）。
- 有料版: 最大 5 問、編集可能、必須/任意の設定可。
- 推奨質問例: 挑戦していること / 応援してほしいこと / 趣味・好きなこと など。

> 打ち合わせ（2026-06-03）: 質問数は **無料2問・有料5問** で確定（据え置き）。当初20問案もあったが「面接のようで重い・離脱する」ため有料でも5問が上限。「有料にすると質問を選べる」という体験差を見せる狙い。

**回答形式**

- まず **自由入力** だけで実装（リリース優先・最短）。
- 将来 **選択式** にも対応。Google フォームのように「発行者が選択肢を作る」「自由入力／選択式のどちらも選べる」状態を目指す。
- ゆくゆく「よく使われる質問トップ5」等のデータ収集（初期実装はしない）。

**生年月日**

- アンケートとは別枠で取得。**「非公開」を選べる**ようにする（入力したくない相手向け）。非公開時はマスク表示（[16](./16-birthday.md)）。

## 現状の実装（できていること）

- 予約設定画面（`booking-settings.html`）に質問1〜5の入力 UI。質問3〜5は `pro-question` クラスで有料時のみ表示。
- `booking-page-save` がプラン別の質問数上限（無料2/Pro・プレミアム5・`_lib/plan-limits.js`）を検証し、`questionnaire_questions`（`question_text` / `is_required` / `sort_order`）を全削除→再投入。先頭2問を必須として保存。

## 未実装（できていないこと）

- ゲストの予約画面（`booking.html` / `booking-week.js`）は **固定フィールド**（お話したい内容・夢/目標・生年月日）で、`questionnaire_questions` を**動的にレンダリングしていない**。
- 回答を `questionnaire_answers` に保存する処理が無い（現状は `topic` 等の固定カラムのみ）。

## 関連ファイル

- `public/booking-settings.html` / `netlify/functions/booking-page-save.js` — 質問の設定・保存
- `public/booking.html` / `public/booking-week.js` — ゲスト表示（動的化が必要）
- DB: `questionnaire_questions`（実装）/ `questionnaire_answers`（未使用）

## 残タスク

- 予約画面で `questionnaire_questions` を取得して動的にフォーム生成。
- 回答を `questionnaire_answers` に保存（`book.js` 拡張）。
- 必須/任意のバリデーションをゲスト側に反映。
- 生年月日に「非公開」選択肢を追加。
- （将来）選択式の回答形式・選択肢エディタ、質問傾向のデータ収集。
