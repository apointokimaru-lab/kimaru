# キマル（Kimaru）ドキュメント

最終更新: 2026-08-06

---

## 0. はじめに読む — [`vision.md`](./vision.md)

> **記憶ではなく、記録でご縁を育てる。**

キマルが何のために存在するかは [`vision.md`](./vision.md) に書かれている。**仕様書や技術判断を読む前に、まずここを通ってほしい。**

ここにある決定は、突き詰めればすべてこの想いから導かれている。

| 想い | 設計への現れ |
|---|---|
| 「日程が合わず、お会いできなかった」 | 日程調整・受付時間・リマインダー |
| 「会ったのに、何をされている方だったか思い出せない」 | **AI議事録**（決定事項・相手のニーズ・次のアクションを顧客に紐づけて残す） |
| 「一つひとつの出会いを大切に育てる」 | 顧客一覧の並び替え → 顧客単位への集約（Step 4） |
| 記録は資産である | **要約は無期限保存。消えるのは音声と生の文字起こしだけ**（[`ai-bot/system-spec.md`](./ai-bot/system-spec.md) FR-10） |

---

キマルのドキュメント集約インデックス。各ドキュメントの入口はここ。
最新の打ち合わせ要約は [`mtg/2026-06-18.md`](./mtg/2026-06-18.md)（ドメイン取得・法務修正・リリース計画）。

---

## 1. ドキュメント地図

| ドキュメント | 内容 |
|---|---|
| **[`vision.md`](./vision.md)** | **キマル開発者の想い。すべての起点** |
| [`spec.md`](./spec.md) | 仕様書（やりたいこと全体）。主要機能・DB理想設計・UI/デザイン方針・プラン |
| [`features/README.md`](./features/README.md) | 機能一覧（ユーザー機能／運営者機能で分割・優先度付き）。各機能1ファイル |
| [`current-features.md`](./current-features.md) | 現状の実装棚卸し（実装済み／未実装／決定未反映） |
| [`plan-comparison.md`](./plan-comparison.md) | 無料版 / 有料版の説明資料（比較表） |
| [`positioning-brief.md`](./positioning-brief.md) | **ポジショニング**（新LP用・#362）。ターゲット定義・痛み・差別化軸・狙わない領域・メインコピー案・想定反論・**合否の指標（LP閲覧→会員登録の転換率）**。競合（TimeRex/Spir/Jicoo/eeasy/Calendly）の料金と口コミ引用は**裏取り用でLPには出さない** |
| [`running-costs.md`](./running-costs.md) | ランニングコスト（インフラ固定費・決済/AI変動費・損益の目安） |
| [`zoom-marketplace-submission.md`](./zoom-marketplace-submission.md) | Zoom Marketplace 公開申請の提出物（チェックリスト・Listing文面・審査手順・セキュリティ回答草案） |
| [`perf/2026-09-baseline.md`](./perf/2026-09-baseline.md) | **速度のベースライン**（フロント刷新の着手前・本番の Lighthouse。段階5 で同じ条件で測り直して並べる・#417） |
| [`frontend-conventions.md`](./frontend-conventions.md) | **新フロント（Next.js）のコード規約とフォルダ構造（正本・#416）**。TypeScript/React の書き方・i18n・CSP・テスト・旧サイトとの同居ルール |
| [`kimaru_ai_bot_development_roadmap.md`](./kimaru_ai_bot_development_roadmap.md) | **開発ロードマップ**（開発順序・フルリプレイス方針・自作AI会議Bot・CRM/タスク拡張） |
| [`kimaru_infrastructure_architecture_v2 (1).md`](./kimaru_infrastructure_architecture_v2%20(1).md) | **インフラ基盤構成（正本）**（AWS構成・Bot/STT/AI要約基盤・データモデル・技術スタック） |
| [`infrastructure-review.md`](./infrastructure-review.md) | 上記へのレビューと判断（DBはSupabase継続・PoCで削る構成・既存本番からの引き継ぎ・原価の含意） |
| [`ai-bot/`](./ai-bot/README.md) | **AI会議Bot・基盤刷新の設計文書一式**（仕様書・開発スケジュール・規約調査・ロードマップ・インフラ構成・基盤レビュー）。実装は [`ai-bot/system-spec.md`](./ai-bot/system-spec.md) が正本 |
| [`pro-open-items.md`](./pro-open-items.md) | **Pro版で仕様が未確定・曖昧な点の洗い出し**（リリース前に埋める） |
| [`screens.md`](./screens.md) | 画面・URL 一覧、API 概要 |
| [`screen-flow.md`](./screen-flow.md) | 5アクター × 画面のアクセス権マトリクス・主要フロー |
| [`api.md`](./api.md) | API エンドポイント詳細（req/res・認証・環境変数） |
| [`db-schema.md`](./db-schema.md) | DB 構成（実テーブル・ER図・レガシー重複・今後の変更） |
| [`open-decisions.md`](./open-decisions.md) | 決定事項・保留事項・**注意事項/未確定**のログ |
| [`tasks.md`](./tasks.md) | **👤人間タスク / 💻実装タスク**の一覧（優先度・依存付き） |
| [`legal/`](./legal/) | 利用規約・プライバシーポリシー・特商法表記（ドラフト） |
| `mtg/` | 打ち合わせ議事録（元データ） |

外部の正本: ルートの [`../supabase-schema.sql`](../supabase-schema.sql)（DB定義）。

---

## 2. 確定仕様サマリ（打ち合わせ反映後）

| 項目 | 無料版 | 有料版（Pro） | 備考 |
|---|---|---|---|
| 料金 | ¥0 | ¥980 / 月 | 決済は **Square**。**1ヶ月無料お試し**（カード登録・後に自動課金、予定）。**＋プレミアム ¥4,800/月**（Pro＋AI・無料お試しなし） |
| 予約ページ（日程調整URL）保存数 | 2つ | 5つ | 猫メンバーも5つ |
| 受付期間 | 2ヶ月先 | 6ヶ月先 | 「2と6（ニャンニャン）」 |
| 事前アンケート | 2問 | 5問（編集・必須設定可） | 据え置き |
| リマインダー | 22分前・プロフィール付き（メール送信） | 同左 | 「ニャンニャン前」。独自メールで送信 |
| Google Meet 自動発行 | ✅ | ✅ | |
| Zoom 自動発行 | 🔜（設定で有効） | 🔜（設定で有効） | 実装済み。env `ZOOM_*` 設定時に自動発行 |
| 会員同士の相互質問 | ✅ | ✅ | ゲスト→ホストへ質問・メッセージ |
| 高度プロフィール / 占い的インサイト / 公開プロフィールページ | − | ✅ | 占いは算命学＋数秘術。公開ページ `/u/<slug>`（画像は今後） |
| 顧客管理・予約履歴 | ✅（閲覧のみ） | ✅（メモ・印象スコア構造化＋相手集約） | 無料は予約履歴の閲覧のみ |
| AIアシスト（次回アポの戦略提案） | − | − | **プレミアムのみ**（GPT-5.4 Mini・月300回・フェーズ2） |

> **プレミアムプラン ¥4,800/月**（フェーズ2開放）: Pro全機能＋**AIアシスト**（自分の ChatGPT / Claude をMCP接続・回数無制限・決定31）。**無料お試しなし**。詳細 [`plan-comparison.md`](./plan-comparison.md)、運用コストは [`running-costs.md`](./running-costs.md)。

### アクター（5属性）

無登録 / 無課金（登録・無料）/ 課金者（Pro）/ 猫メンバー（Cat Key＝有料機能を無料）/ 運営。
画面ごとのアクセス可否は [`screen-flow.md`](./screen-flow.md)。

### 招待コード（Cat Key）

`Neko20240222`。猫の集会メンバーが有料機能を無料で使える。不正対策として**承認制**＋運営による**強制降格**（当面 Cat Key 利用者対象）。詳細 [`features/19`](./features/19-cat-key-admin.md) / [`features/22`](./features/22-admin-console.md)。

### 外部連携ロードマップ

Google（実装済）→ Zoom（将来）→ 議事録アプリ類（後々・マスタープラン）。
ログイン方式に依存せず後付け可能な設計。詳細 [`features/25`](./features/25-auth-architecture.md) / [`features/23`](./features/23-meeting-minutes.md)。

---

## 3. 実装状況サマリ（2026-06-09 時点）

- **実装済み**: Googleログイン＋**メール/パスワード認証（登録・ログイン・パスワード再設定・メール確認）**、カレンダー連携・Meet発行、予約作成・予約設定、**複数予約ページ（無料1/Pro2/プレミアム5・決定27・降格時は凍結/復元）**、事前アンケート（設定・ゲスト表示・回答保存）、**受付期間 無料2ヶ月**、プラン制限（無料/Pro/**プレミアム**）、Cat Key適用と運営管理、相手管理（**無料は閲覧のみ開放**・面談メモ・**印象スコア構造化＋相手集約**）、**22分前リマインダー**、予約キャンセル/変更・ホスト通知・受付一時停止、多言語、**生年月日インサイト（算命学＋数秘術）**、**高度プロフィール＋公開ページ（/u/<slug>）**、**会員相互質問（ゲスト→ホスト）**、**メール経路分離＋配信停止/サプレッション**、**会員獲得サンキュー導線**、**AIアシスト（LLM連携・月300回上限）**。GitHubの `実装` ラベル issue は全クローズ。
- **設定待ち（コードは完了・env/外部設定が必要）**: プレミアム課金（Square商品＋`SQUARE_PREMIUM_PLAN_ID`）、AIアシスト本番稼働（`OPENAI_API_KEY`）、メール送信（Resend Pro＋送信元env＋DNS）、Zoom自動発行（`ZOOM_*`）。→ 人間タスクは [`tasks.md`](./tasks.md)。
- **将来**: 高度プロフィールの画像アップロード、算命学の日柱精密化、AI要約/AI検索（プレミアム上位）、議事録ツール提携、法人プラン。

残作業の優先順位は [`features/README.md`](./features/README.md) を参照。

---

## 4. 技術構成

静的 HTML / CSS / バニラ JS（`public/`）＋ サーバレス関数（`netlify/functions/`）＋ Supabase（PostgreSQL）。ビルド工程なし。ホストは **Netlify 一本化**。
認証は **Google OAuth ＋ メール/パスワード**（HMAC署名 Cookie セッション・パスワードは scrypt）。Googleトークンは暗号化保存。
メール送信は `_lib/mail.js`（Gmail→Resend・取引/営業の経路分離）。AIアシストは OpenAI（GPT-5.4 Mini）を fetch 連携（プレミアム・SDKなし）。運用コストは [`running-costs.md`](./running-costs.md)。
