# 会議プラットフォーム 実装方式・規約調査（T-001）

調査日：2026年8月6日

[← AI会議Bot ドキュメント索引](./README.md)　|　[← docs 全体索引](../README.md)

## 0. 本書の目的と読み方

[`system-spec.md`](./system-spec.md) の **T-001（Meet / Zoom の規約調査・Bot 参加可否）** の成果物。あわせて **T-002（同意設計の法務確認）で弁護士へ持ち込む資料**の土台にする。

**表記の区別**（重要）

| 記号 | 意味 |
|---|---|
| 📗 | **一次情報で確認済み**（公式ドキュメント・公式マーケットプレイスを直接参照） |
| 📙 | **二次情報**（検索結果の要約・技術ブログ・開発者フォーラム）。原文未確認 |
| 📕 | **本書の推測・解釈**。裏取りが必要 |

> ⚠️ **「競合がやっている ＝ 適法」ではない。** ただし①**マーケットプレイス審査を通っている**＝プラットフォームが許容する範囲の実証、②**日本で事業を継続している**＝実務上の落としどころの実例、という2点で強い材料になる。**弁護士相談の代替にはならないが、相談の質と効率を大きく上げる。**

---

## 1. 結論（先に）

| # | 結論 | 根拠 |
|---:|---|---|
| 1 | **Bot が会議に参加して音声を取る方式は、Zoom・Google ともに実例があり、公式マーケットプレイスの審査を通っている** | 📗 Notta・Fireflies・Otter が Zoom Marketplace に、tl;dv・Read AI が Google Workspace Marketplace に掲載 |
| 2 | **Zoom は公式ルートが確立している。Meeting SDK for Linux で headless bot を作るのが正道** | 📙 Zoom 公式ブログが headless bot サンプルの使い方を案内、📙 raw audio 取得の公式ドキュメントあり |
| 3 | **Google Meet の「bot-free」方式（Meet SDK）は、キマルの顧客層には使えない** | 📗 Google Workspace アカウント必須・**Workspace 管理者権限**でのスコープ承認が必要 |
| 4 | **Meet Media API は現状使えない** | 📗 Developer Preview。**会議の全参加者**が Developer Preview に登録している必要がある |
| 5 | → **Meet はヘッドレスブラウザ Bot しか選択肢がない**（規約グレーの方を踏む） | 📕 上記3・4からの帰結 |
| 6 | **仕様書の「Meet 先行」は見直しが妥当。Zoom 先行の方が技術・規約とも固い** | 📕 上記2・5からの帰結 |
| 7 | 同意の業界実務は**三層**（Bot名で常時明示／プラットフォーム側通知／事前告知はホスト責任）。**キマルの FR-7 設計はこれと整合している** | 📗📙 各社の実装 |

---

## 2. 実装方式の比較

### 2.1 方式の一覧

| 方式 | 仕組み | 採用例 | キマルでの可否 |
|---|---|---|---|
| **A. 公式SDKによる headless bot** | プラットフォームの SDK でヘッドレスクライアントを作り、参加者として入室して raw audio を取得 | Zoom: 多数 | **Zoom で採用可（推奨）** |
| **B. 公式APIによる bot-free** | 会議に参加せず、API 経由でメディアを取得 | Meet: Fireflies | **不可**（後述の制約） |
| **C. ヘッドレスブラウザ Bot** | Playwright/Chromium で人間と同じようにブラウザで入室 | Meet: tl;dv・Notta・Circleback 等 | **Meet で採用せざるを得ない** |
| **D. Chrome 拡張** | ユーザーのブラウザ上で録音。サーバー側 Bot 不要 | Fireflies | **不採用**（ホストが会議中PCを開き続ける前提になる） |

### 2.2 Zoom

📙 Zoom は **Meeting SDK for Linux** で headless bot を作る方法を公式に案内している（[Headless Meeting Bot サンプルの使い方](https://developers.zoom.us/blog/meeting-sdk-headless-bot-usage/)、[raw data 取得ドキュメント](https://developers.zoom.us/docs/meeting-sdk/linux/add-features/raw-data/)）。サンプルリポジトリ `meetingsdk-headless-linux-sample` が提供されている。

📙 開発者フォーラムで報告されている実装上の注意

- Bot 参加時に**録画許可プロンプト**が出る（＝同意取得の仕組みとしてはむしろ好都合）
- 物理サウンドデバイスがない環境では **ALSA / PulseAudio** が必要
- エンタープライズアカウントで raw recording が始まらない事例、`status 32` で raw audio の購読に失敗する事例の報告あり

📙 App Review の要件（検索結果の要約・**原文の再確認が必要**）

- 「**SDK アプリが bot participant として参加する場合はテストプランに明記すること**」
- 「録画・ライブ配信機能を起動するアプリは、全参加者へ適切な通知を行うこと」
- 「この通知要件は**録画するBotだけでなく、音声・映像などの会議データにアクセスするアプリ全般**に適用される」
- 「**自動化された会議クライアントは Zoom Meeting SDK を使い**、Zoom SDK App Requirements に準拠し、審査を経て Marketplace に公開すること」← **📕 これが事実なら、Zoom でヘッドレスブラウザ方式は規約違反**になる。**T-001 の残作業として原文を確認する**

📗 **Legal UI Notices（Meeting SDK アプリに実装が義務付けられる通知）** — [公式ドキュメント](https://developers.zoom.us/docs/meeting-sdk/ui-notices/)

実装必須の通知が9種類定義されており、**非準拠は SDK アクセス停止のリスク**がある。キマルに関係するのは主に次。

| 通知 | 内容 |
|---|---|
| Recorded Meeting Chat Notice | 「Who can see your messages? _Recording On_」 |
| Live Transcription Notice | 「Live transcription has been enabled. Who can see this transcript?」 |
| **Active Apps Notifier (AAN)** | **第三者アプリが会議コンテンツにアクセスしていることを示すアイコンとパネル。必須** |

→ **AAN があるため、Zoom では「どのアプリが会議データにアクセスしているか」が参加者に常時可視化される。**同意設計上、これは強い後ろ盾になる。

### 2.3 Google Meet

📗 **Meet Media API**（[公式ドキュメント](https://developers.google.com/workspace/meet/media-api/guides/overview)）

> To use the Meet Media API to access real-time media from a conference, the Google Cloud project, OAuth principal, **and all participants in the conference** must be enrolled in the Developer Preview Program.

- **Developer Preview**（一般提供ではない）
- **会議の全参加者**が Developer Preview に登録している必要がある → **一般ゲストが参加する1on1では構造的に使えない**
- 「consenter」（ホスト・共同ホスト・組織メンバー）による承認が必要
- **会議の暗号化やウォーターマークが有効だと接続できない**
- 個人 Gmail アカウントの会議では、発起人が同席し続ける必要がある

📗 **Meet SDK による bot-free 録音**（Fireflies の実装・[Fireflies ヘルプ](https://guide.fireflies.ai/articles/3309351579-integrate-google-meet-sdk-with-fireflies-for-bot-free-meeting-recording)）

| 項目 | 内容 |
|---|---|
| 必要条件 | **Google Workspace アカウント（個人 Gmail 不可）** |
| 権限 | **Workspace 管理者権限**で Meet SDK スコープを承認する必要がある |
| 制約 | 同時に**3名分**の音声・映像まで（Google API の制限）／チャット・字幕は取得不可／**1会議につき1ツールのみ** |
| 参加者への表示 | 「Make sure everyone is ready」プロンプトが出て、**全参加者が承認/キャンセルを選べる**。録音中は「You're sharing call audio and video with Fireflies.ai Notetaker」バナーを常時表示 |

📕 **キマルにとっての判断**: ホスト層は個人事業主・小規模事業者が中心で、**個人 Gmail の利用者も多い**と想定される。さらに Workspace 管理者権限の承認を求めるのは導入障壁が高い。**この方式は主要顧客層に届かない。**

📙 **ヘッドレスブラウザ Bot** — tl;dv・Notta・Circleback などが Meet で採用。Google Workspace Marketplace にも掲載されている（後述）ため、Google がこの形態のアプリを一律に排除してはいない。ただし**「ヘッドレスブラウザによる自動入室」そのものを Google が明示的に許可しているわけではない**点に注意（📕 Google 利用規約の自動化アクセス条項との関係は**T-001 の残作業**）。

---

## 3. マーケットプレイス掲載状況（＝審査を通った実証）

### 3.1 Zoom App Marketplace 📗

| サービス | 掲載 |
|---|---|
| **Notta** | [Notta Meeting Assistant](https://marketplace.zoom.us/apps/cK-Wot7RTNSVR_fI8g_b8g) |
| **Fireflies.ai** | [Zoom AI Notetaker by Fireflies.ai](https://marketplace.zoom.us/apps/QkiS57vZTmGCOmW5EJh3ig) ／ [Fireflies.ai for Zoom Phone](https://marketplace.zoom.us/apps/Nx1VqIwpQfOp-t3OtEY52Q) |
| **Otter.ai** | [Otter.ai - Meeting Summary, AI Chat](https://marketplace.zoom.us/apps/MmQJIMXUTYiCdPX5anvKVw) ／ [Otter - AI Meeting Agent](https://marketplace.zoom.us/apps/SRHAlFVMTDCFa8WYuzROZw) |
| その他の Bot 系 | [Perceivable Meeting Bot](https://marketplace.zoom.us/apps/KDPEK2ZXSi2lL0GCfzpXuA)、[CoLoop Recorder](https://marketplace.zoom.us/apps/nytyeHIPRCmNGX3r6qJbmA) |

→ **「会議に参加して音声を取り、文字起こし・要約する」アプリは Zoom の審査を通る。**キマルも同じカテゴリに入れる。

### 3.2 Google Workspace Marketplace 📗

| サービス | 掲載 |
|---|---|
| **tl;dv** | [Record, Transcribe & Summarize Meetings – tl;dv](https://workspace.google.com/marketplace/app/record_transcribe_summarize_meetings_%E2%80%93_t/403457444693) |
| **Read AI** | [Read Meeting Notetaker](https://workspace.google.com/marketplace/app/read_meeting_notetaker/766098389391) |
| その他 | [Notetaker, Recordings & Transcriptions for Meet](https://workspace.google.com/marketplace/app/notetaker_recordings_transcriptions_for/612510475273)（「Trusted by 50,000+ organizations」と表示） |

---

## 4. 同意の取り方 — 業界の実務

### 4.1 三層構造 📗📙

| 層 | 内容 | 実例 |
|---|---|---|
| **① 会議中の常時明示** | Bot 名・バナー・アイコンで「録音中」「どのアプリが会議データにアクセスしているか」を示す | Fireflies: 「You're sharing call audio and video with Fireflies.ai Notetaker」バナー／tl;dv: Bot が「Recording bot」として参加者一覧に表示／Zoom: **Active Apps Notifier が必須** |
| **② 参加時の承認プロンプト** | 参加者が承認/キャンセルを選べる | Fireflies（Meet SDK）: 「Make sure everyone is ready」プロンプト／Zoom Bot: 録画許可プロンプト |
| **③ 事前告知** | **ホストの責任**として整理されている | 📙 日本語の解説記事でも「社外との商談では事前に録音の了承を取ることが重要」と案内 |

### 4.2 事業者側の実務 📙

日本語の解説記事では、AI議事録ツール導入時に次が案内されている。

- プライバシーポリシーに「**会議録音データを第三者ツールで処理する**」旨を記載し、利用目的を明確化する
- データ保存先を把握する

### 4.3 データ保存先の比較 📙

| サービス | 保存先 |
|---|---|
| **Notta** | **AWS 東京リージョン** |
| tl;dv | EU（GDPR 準拠） |
| Otter.ai | 米国 |
| **キマル（計画）** | **AWS 東京 + Supabase** |

→ 📕 **日本市場では「国内保存」が訴求材料になる。**Notta と同じ位置づけを取れる。

### 4.4 キマルの FR-7 との照合

| キマルの設計 | 業界実務との整合 |
|---|---|
| FR-2.4 Bot 表示名に録音中を明示 | ✅ ①と一致 |
| FR-7.3 ゲスト同意は**予約フォームの明示チェック**（既定は未チェック） | ✅ ③を仕組み化したもの。**業界より厳しい**（多くは事前告知をホスト任せにしている） |
| FR-7.5 同意が揃わなければ**技術的に起動できない** | ✅ 業界より厳しい |
| FR-7.6 会議中の撤回で即時退出・データ削除 | ✅ ②の思想と一致 |
| FR-7.7 参加者が3人以上になったら退出 | 📕 業界に同等の実装は見当たらない。**キマル独自の保守的な措置** |
| FR-7.10 **同意者と入室者の同一性は保証しない**（ホストの責任範囲） | ✅ 業界標準と同じ扱い |

→ **キマルの同意設計は、業界実務と同等かそれ以上に保守的。**T-002 ではこの点を示したうえで「過剰でないか／不足がないか」を確認する形にできる。

---

## 5. キマルへの含意と仕様変更の提案

### 5.1 提案①：**Zoom 先行へ切り替える**（仕様書 9章の変更）

現行の仕様書は「Zoom は審査中だから **Meet 先行**」としている。しかし調査の結果、**技術・規約の観点では Zoom の方が明らかに固い**。

| 観点 | Zoom | Meet |
|---|---|---|
| 公式ルート | ✅ Meeting SDK for Linux（公式サンプルあり） | ❌ 使える公式ルートがない（Media API は Preview、SDK は Workspace 管理者権限が必要） |
| 規約上の位置 | ✅ Marketplace 審査を通せば明確に許容 | 📕 グレー（ヘッドレスブラウザ） |
| 実装の安定性 | ✅ SDK なので UI 変更に強い | ❌ ブラウザ UI 変更で壊れる |
| 同意の仕組み | ✅ 録画許可プロンプト＋AAN が標準装備 | 自前で用意する必要がある |
| 着手の障壁 | ❌ 審査完了を待つ必要がある | ✅ 待たずに始められる |

**提案**: **Zoom を先行**とし、審査完了までの期間は **M0（基盤準備）**に充てる。実質的な遅延は小さい。

### 5.2 提案②：Meet はヘッドレスブラウザ前提で計画する

Meet の bot-free 方式は主要顧客層に届かない。**Meet 対応 = ヘッドレスブラウザ**と確定させ、それに伴うリスク（規約グレー・UI 変更で壊れる）を仕様のリスク表に明記する。日次の入室 E2E は**必須**。

### 5.3 提案③：Zoom の Legal UI Notices を要件に追加

📗 Meeting SDK アプリには9種類の Legal UI Notices の実装が義務付けられ、**非準拠は SDK アクセス停止のリスク**がある。特に **Active Apps Notifier (AAN)** は必須。仕様書の FR-7 または SEC に要件として追加する。

### 5.4 提案④：`MeetingPlatformAdapter` の抽象度を見直す

Zoom は **SDK（C++/Linux）**、Meet は **ヘッドレスブラウザ（Playwright/TypeScript）** と、実装技術がまったく異なる。現行仕様の `MeetingPlatformAdapter`（TypeScript の単一インターフェース）では吸収しきれない可能性がある。

📕 **プロセス境界で分ける**設計（Bot コンテナ自体をプラットフォーム別に用意し、Orchestrator からは同じ起動パラメータで扱う）の方が素直。M1 の設計時に判断する。

---

## 6. T-001 の残作業

| # | 調べること | 方法 | 重要度 |
|---:|---|---|---|
| 1 | **「自動化された会議クライアントは Meeting SDK を使うこと」の原文確認** | Zoom SDK App Requirements / App Review Guidelines の原文を精読 | **最高**（事実なら Zoom でのブラウザ方式は不可） |
| 2 | Google 利用規約・Workspace 規約の**自動化アクセス条項** | 一次情報を精読し、ヘッドレスブラウザ入室との関係を整理 | 高 |
| 3 | Zoom Meeting SDK の**ライセンス条項**（Bot 用途・録音・再配布） | Zoom Developer Terms / SDK License | 高 |
| 4 | Meet Media API の**一般提供時期** | Workspace リリースノートを定期確認 | 中（GA すれば設計が変わる） |
| 5 | 各社の**プライバシーポリシー原文**（録音・保持・委託の記載） | Notta・tl;dv・Fireflies の日本語版を取得 | 中（T-003 の下敷き） |
| 6 | Zoom Bot 参加時の**録画許可プロンプト**の実際の挙動 | PoC で実機確認 | 中 |

---

## 7. T-002（法務相談）への引き継ぎ

### 7.1 相談の進め方

- **相談相手**: IT・個人情報保護分野の弁護士。**スポット相談で足りる**（顧問契約は不要）
- **持ち込む資料**: 本書 ＋ サービス概要 ＋ データフロー図 ＋ 下記の論点リスト
- **狙い**: ゼロから論点整理してもらうのではなく、「**業界標準はこう。当社はそれ以上に保守的（4.4）。過不足があるか**」を確認する形にして、時間と費用を圧縮する

### 7.2 論点リスト

| # | 論点 | 本書での材料 |
|---:|---|---|
| 1 | Bot による録音は**当事者録音**（ホストの代理）とみなせるか | 4.1 の実務 |
| 2 | ゲストの同意は**予約フォームのチェック**で成立するか | 4.4（キマルは業界より厳しい） |
| 3 | **黙示の同意**（録音中と表示されたうえで参加継続）は有効か | 4.1 ①②の実例 |
| 4 | 飛び入り参加者が出たとき、**録音停止＋退出**で足りるか | 4.4（業界に同等の実装は見当たらない＝過剰の可能性も） |
| 5 | **同意者と入室者の同一性**を保証しないことは許容されるか | 4.4（業界標準と同じ） |
| 6 | 会議中の**撤回**に応じる義務の範囲。既取得データの削除で足りるか | FR-7.6・削除SLO 15分 |
| 7 | **海外からの参加者**（EU＝GDPR、米カリフォルニア等の全当事者同意州）への対応要否 | 3.3（tl;dv は EU 保存で対応） |
| 8 | 保持期間（音声＝文字起こし後即時／`incomplete` 14日／文字起こし1か月）の妥当性 | FR-10 |
| 9 | **LLM 提供者への委託**の位置づけとプライバシーポリシーへの記載方法 | 4.2 の実務 |
| 10 | **通信の秘密**（電気通信事業法）の適用有無 | — |
| 11 | **1対1限定**（3人以上で退出）という割り切りの妥当性 | FR-7.1・7.7 |

---

## 8. 出典

**一次情報 📗**

- [Meet Media API overview](https://developers.google.com/workspace/meet/media-api/guides/overview)（Developer Preview・全参加者の登録要件）
- [Zoom Meeting SDK — UI Legal Notices](https://developers.zoom.us/docs/meeting-sdk/ui-notices/)（必須通知9種・AAN）
- [Zoom App Marketplace 各アプリ掲載ページ](https://marketplace.zoom.us/)（3.1 のリンク）
- [Google Workspace Marketplace 各アプリ掲載ページ](https://workspace.google.com/marketplace)（3.2 のリンク）
- [Fireflies: Google Meet SDK による bot-free 録音](https://guide.fireflies.ai/articles/3309351579-integrate-google-meet-sdk-with-fireflies-for-bot-free-meeting-recording)

**二次情報 📙**

- [Zoom: Headless Meeting Bot サンプルの使い方](https://developers.zoom.us/blog/meeting-sdk-headless-bot-usage/)
- [Zoom: Meeting SDK for Linux — raw data](https://developers.zoom.us/docs/meeting-sdk/linux/add-features/raw-data/)
- [Zoom Developer Docs: SDK feature review & requirements](https://developers.zoom.us/docs/distribute/sdk-feature-review-requirements/)
- [Zoom Developer Docs: App Review Guidelines](https://developers.zoom.us/docs/distribute/app-review-guidelines/)
- [Notta: Zoom Bot](https://www.notta.ai/en/zoom-bot)
- 日本語の比較記事（データ保存先・同意実務）
