# 18. AIアシスト

[← 機能一覧に戻る](./README.md)

- ステータス: ✅ **MCP連携に一本化（決定31・2026-07-15）** — ユーザー自身の ChatGPT/Claude を MCP で接続する方式。MCPサーバMVP実装済み。**旧サーバLLM実装（`ai-assist.js`/`_lib/llm.js`・月300回上限）は撤去（2026-07-21）**
- 対象プラン: **プレミアムプラン**（¥2,200/月・無料お試しなし・フェーズ2開放）
- 仕様: [`../spec.md`](../spec.md) 有料版機能（AI アシスト ※将来）／[決定31](../open-decisions.md#31-aiアシストは-mcp-連携に一本化決定20の方向転換2026-07-15)

## 概要

発行者のプロフィール（[17](./17-profile.md)）と相手データ（予約・生年月日インサイト）から、関係構築の最適解をAIで得る。**AIはキマルが提供せず、ユーザーが契約している ChatGPT / Claude 等を MCP（Model Context Protocol）で接続する**（決定31）。原価ほぼゼロ・回数無制限・モデルは常にユーザー側の最新。

## MCP連携（決定31・現方式）

- **`/api/mcp`**（`netlify/functions/mcp.js`）— Streamable HTTP・ステートレスのMCPサーバ。プレミアム限定。
- **ツール（読み取り専用）**: `list_bookings`（予約一覧）/ `list_contacts`（相手一覧・手動追加含む）/ `get_booking_answers`（事前アンケート回答）/ `get_my_profile`（自分のプロフィール）。
- **プロンプト**: `prepare_meeting`（面談準備の定型プロンプト）を MCP prompts で配布。
- **認証（2系統）**:
  1. **OAuth 2.1（推奨・2026-07-15 実装）** — ChatGPT / claude.ai のコネクタに素のエンドポイントURL（`/api/mcp`）を貼るだけで、発見（`/.well-known/oauth-protected-resource` → `oauth-metadata.js`）→ 動的クライアント登録（`mcp-oauth-register.js`・RFC 7591・client_id はステートレス署名）→ 認可（`mcp-auth.js`・PKCE S256・同意画面・未ログインは `login.html?next=` で復帰）→ トークン交換（`mcp-oauth-token.js`・refresh対応）が自動で走る。
  2. **パーソナルトークン**（OAuth非対応クライアント向け） — `crypto.js` の HMAC 導出（`mcp:{ownerId}:{salt}`）。`Authorization: Bearer` または `?t=` クエリ。
  - どちらも `owners.mcp_token_salt` に束縛：**「URLを再発行」で旧URL・OAuth接続済みクライアントが全て失効**（列未適用の環境では固定トークンに劣化動作・再発行のみ不可）。
- **接続URL取得**: `/api/mcp-token`（プレミアム限定）。UIは `ai-assist.html` の「自分のAIとつなぐ」（コネクタURL＝推奨／トークン付きURL＝上級者向け・再発行）。

## 旧方式：サーバLLM（決定20・**撤去済み 2026-07-21**）

以下は決定20時点のサーバLLM方式の記録。**決定31でMCPに一本化**し、2026-07-21に実装（`ai-assist.js`/`_lib/llm.js`・`OPENAI_*`・月300回上限）を**撤去**した。将来「設定不要の簡易版」として復活させる場合の設計メモとして方式のみ残す。

### プラン・モデル・上限（2026-06-09 決定）

- **提供プラン**: プレミアムプラン（¥2,200/月）。**登録＝即時課金**（Pro・プレミアムとも無料お試しなし。AI原価が初月から発生するため特に重要）。¥980会員が50〜100人を超えた段階（フェーズ2）で開放。社内コード「ニャンニャンプラン」。
- **使用モデル**: **GPT-5.4 Mini**。構造化データからの提案生成（読み取り＋テンプレ的生成＋軽い推論）はこのティアの得意領域で、低レイテンシ・低コスト。賢さが要る将来のエージェント型機能（複数商談を横断した戦略立案等）だけ上位 GPT-5.4 を出し分ける。
- **利用上限**: **1ユーザーあたり月300リクエスト**（フェアユース）。超過分は翌月持ち越し等で吸収。
- **採算試算**（前提: 1回=入力3,000＋出力1,000トークン・¥150/$・Square 3.6%）: GPT-5.4 Mini で1回約¥1.0 → 月300回で**原価約¥303/人**。手取り¥2,121−¥303＝**手残り約¥1,818/人**で、¥980プランの手残り（約¥945）の**約2倍**を確保。詳細は [open-decisions 決定20](../open-decisions.md)。
- モデル呼び出しは抽象化し（メール送信の `_lib/mail.js` 同様）、将来のモデル差し替え・プロンプトキャッシュ最適化を局所化する。

### 旧方式の実装（撤去済み 2026-07-21）

以下は撤去した旧サーバLLM方式の記録（コードは削除済み）。

- サーバ関数 **`/api/ai-assist`**（`requirePremiumOwner`）が、サーバ保存のプロフィール × 相手データから LLM で提案を生成（`_lib/llm.js`・OpenAI Chat Completions・既定 GPT-5.4 Mini）していた。
- **月300回上限**を `ai_assist_logs` の当月（JST）件数で判定（`AI_ASSIST_MONTHLY_LIMIT`）。超過は 429、成功時のみログ記録。
- `OPENAI_API_KEY` 未設定時はサーバが 503 を返して安全に無効化していた。
- `ai-assist.html` のルールベース簡易提案（生年月日インサイト等）は**現方式でも継続**（Pro以上）。

## 関連ファイル

- `netlify/functions/mcp.js` — MCPサーバ（Streamable HTTP・プレミアム限定・読み取り専用ツール＋prompts）
- `netlify/functions/mcp-token.js` — 接続URL取得・トークン再発行（プレミアム限定）
- ~~`netlify/functions/ai-assist.js` / `netlify/functions/_lib/llm.js`~~ — 旧サーバLLM。**撤去済み（2026-07-21）**
- `ai_assist_logs` テーブル — 旧方式の利用ログ（DBには非破壊で残置）／`owners.mcp_token_salt` — トークン再発行用
- `public/ai-assist.html` — UI（premium=MCP接続案内＋ルールベース / pro=ルールベース）
- `public/app.js` — `buildRelationshipProfile` 等のインサイト生成（[16](./16-birthday.md)）
- 参照 API: `/api/me`, `/api/owner-bookings`, `/api/mcp`, `/api/mcp-token`

## 残タスク

- ~~OAuth 2.1 対応~~ → 〔2026-07-15〕実装済み（上記）。
- ~~プライバシー文面整理~~ → 〔2026-07-15〕`privacy.html`（i18n 3言語）と `docs/legal/privacy-policy.md` の第3条にMCP・外部AI送信の条項を追記済み。
- スクショ付きセットアップガイド（Claude Desktop / Claude Code / ChatGPT 開発者モード）。
- プロフィールのサーバ保存（[17](./17-profile.md)）と `ai-assist.html` のプロフィールシート（localStorage）の一本化。
- `supabase-schema.sql` の手動適用（`owners.mcp_token_salt`・dev/本番両方）。
