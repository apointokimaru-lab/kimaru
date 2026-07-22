# 18. AIアシスト

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ **MCP連携に方向転換（決定31・2026-07-15）** — ユーザー自身の ChatGPT/Claude を MCP で接続する方式。MCPサーバMVP実装済み。旧サーバLLM実装は温存・未開放
- 対象プラン: **プレミアムプラン**（¥2,200/月・無料お試しなし・フェーズ2開放）
- 仕様: [`../spec.md`](../spec.md) 有料版機能（AI アシスト ※将来）／[決定31](../open-decisions.md#31-aiアシストは-mcp-連携に一本化決定20の方向転換2026-07-15)

## 概要

発行者のプロフィール（[17](./17-profile.md)）と相手データ（予約・生年月日インサイト）から、関係構築の最適解をAIで得る。**AIはキマルが提供せず、ユーザーが契約している ChatGPT / Claude 等を MCP（Model Context Protocol）で接続する**（決定31）。原価ほぼゼロ・回数無制限・モデルは常にユーザー側の最新。

## MCP連携（決定31・現方式）

- **`/api/mcp`**（`netlify/functions/mcp.js`）— Streamable HTTP・ステートレスのMCPサーバ。プレミアム限定。
- **ツール（読み取り専用）**: `list_bookings`（予約一覧）/ `list_contacts`（相手一覧・手動追加含む）/ `get_booking_answers`（事前アンケート回答）/ `get_my_profile`（自分のプロフィール）。
- **プロンプト**: `prepare_meeting`（面談準備の定型プロンプト）を MCP prompts で配布。
- **認証（OAuth 2.1 のみ）**:
  - **OAuth 2.1（2026-07-15 実装）** — ChatGPT / claude.ai のコネクタに素のエンドポイントURL（`/api/mcp`）を貼るだけで、発見（`/.well-known/oauth-protected-resource` → `oauth-metadata.js`）→ 動的クライアント登録（`mcp-oauth-register.js`・RFC 7591・client_id はステートレス署名）→ 認可（`mcp-auth.js`・PKCE S256・同意画面・未ログインは `login.html?next=` で復帰）→ トークン交換（`mcp-oauth-token.js`・refresh対応）が自動で走る。
  - アクセス/リフレッシュトークンは `owners.mcp_token_salt` に束縛：**「すべての接続を解除」で全 OAuth 接続が失効**（列未適用の環境では salt="" で動作・解除のみ不可）。
  - 〔2026-07-22 削除〕**パーソナルトークン（`?t=` / URL埋め込み）方式は廃止**。URLに資格情報が載って漏洩すると読み取られるため（セキュリティ対応）。`mcp.js` は `Authorization: Bearer` の OAuth アクセストークンのみ受理する。
- **接続情報取得**: `/api/mcp-token`（プレミアム限定・**GET=コネクタURL取得／POST=すべての接続を解除**）。UIは `ai-assist.html` の「自分のAIとつなぐ」（コネクタURL＝OAuth）。

## 旧方式：サーバLLM（決定20・温存・未開放）

以下は決定20時点のサーバLLM方式。**決定31で開放しない方針に変更**したが、実装は温存し（`OPENAI_API_KEY` 未設定なら自動無効）、将来「設定不要の簡易版」として復活させる選択肢を残す。

### プラン・モデル・上限（2026-06-09 決定）

- **提供プラン**: プレミアムプラン（¥2,200/月）。**登録＝即時課金**（Pro・プレミアムとも無料お試しなし。AI原価が初月から発生するため特に重要）。¥980会員が50〜100人を超えた段階（フェーズ2）で開放。社内コード「ニャンニャンプラン」。
- **使用モデル**: **GPT-5.4 Mini**。構造化データからの提案生成（読み取り＋テンプレ的生成＋軽い推論）はこのティアの得意領域で、低レイテンシ・低コスト。賢さが要る将来のエージェント型機能（複数商談を横断した戦略立案等）だけ上位 GPT-5.4 を出し分ける。
- **利用上限**: **1ユーザーあたり月300リクエスト**（フェアユース）。超過分は翌月持ち越し等で吸収。
- **採算試算**（前提: 1回=入力3,000＋出力1,000トークン・¥150/$・Square 3.6%）: GPT-5.4 Mini で1回約¥1.0 → 月300回で**原価約¥303/人**。手取り¥2,121−¥303＝**手残り約¥1,818/人**で、¥980プランの手残り（約¥945）の**約2倍**を確保。詳細は [open-decisions 決定20](../open-decisions.md)。
- モデル呼び出しは抽象化し（メール送信の `_lib/mail.js` 同様）、将来のモデル差し替え・プロンプトキャッシュ最適化を局所化する。

### 旧方式の実装（温存中）

- サーバ関数 **`/api/ai-assist`**（`requirePremiumOwner`）が、サーバ保存のプロフィール × 相手データ（予約・メモ・占いベース傾向）から LLM で提案を生成（`_lib/llm.js`・OpenAI Chat Completions・既定 GPT-5.4 Mini）。
- **月300回上限**を `ai_assist_logs` の当月（JST）件数で判定（`AI_ASSIST_MONTHLY_LIMIT`）。超過は 429、成功時のみログ記録、残回数をフロントへ返す。
- `ai-assist.html`：プレミアム会員はサーバLLMを呼び、**未設定(503)/失敗時は従来のルールベース簡易ロジックにフォールバック**（生年月日インサイト等）。pro 会員はルールベースのまま。
- `OPENAI_API_KEY` 未設定時はサーバが 503 を返して安全に無効化（＝開発中はキー無しで自動フォールバック）。

## 関連ファイル

- `netlify/functions/mcp.js` — MCPサーバ（Streamable HTTP・プレミアム限定・読み取り専用ツール＋prompts）
- `netlify/functions/mcp-token.js` — コネクタURL取得（GET）・すべての接続を解除（POST・salt更新）（プレミアム限定）
- `netlify/functions/ai-assist.js` — 旧サーバLLM関数（温存・未開放。月300回上限）
- `netlify/functions/_lib/llm.js` — OpenAI 呼び出し共通ヘルパ（温存）
- `ai_assist_logs` テーブル — 旧方式の利用ログ／`owners.mcp_token_salt` — トークン再発行用
- `public/ai-assist.html` — UI（premium=MCP接続案内＋ルールベース / pro=ルールベース）
- `public/app.js` — `buildRelationshipProfile` 等のインサイト生成（[16](./16-birthday.md)）
- 参照 API: `/api/me`, `/api/owner-bookings`, `/api/mcp`, `/api/mcp-token`

## 残タスク

- ~~OAuth 2.1 対応~~ → 〔2026-07-15〕実装済み（上記）。
- ~~プライバシー文面整理~~ → 〔2026-07-15〕`privacy.html`（i18n 3言語）と `docs/legal/privacy-policy.md` の第3条にMCP・外部AI送信の条項を追記済み。
- スクショ付きセットアップガイド（Claude Desktop / Claude Code / ChatGPT 開発者モード）。
- プロフィールのサーバ保存（[17](./17-profile.md)）と `ai-assist.html` のプロフィールシート（localStorage）の一本化。
- `supabase-schema.sql` の手動適用（`owners.mcp_token_salt`・dev/本番両方）。
