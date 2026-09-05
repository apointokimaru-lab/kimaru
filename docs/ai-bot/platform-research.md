# 会議プラットフォーム 実装方式・規約調査（T-001）

調査日：2026年8月6日　／　**更新：2026年9月5日（#370・7章で規約原文を確認。結論 2・5 を修正、6章の残作業を消化）**

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
| 2 | **Zoom の公式ルートは Bot ではなく RTMS（Realtime Media Streams・bot-free）**。Meeting SDK は「人間の利用向け・Bot／AI ノートテイカー非対応」と公式ドキュメントに明記され、ヘッドレスブラウザは 2023 年から「automated meeting client」として排除対象 | 📗 7.1・7.2（**2026-09-05 修正**。旧記述「Meeting SDK for Linux で headless bot を作るのが正道」は覆った。参照していた公式ブログと raw-data ページは 404） |
| 3 | **Google Meet の「bot-free」方式（Meet SDK）は、キマルの顧客層には使えない** | 📗 Google Workspace アカウント必須・**Workspace 管理者権限**でのスコープ承認が必要 |
| 4 | **Meet Media API は現状使えない** | 📗 Developer Preview。**会議の全参加者**が Developer Preview に登録している必要がある |
| 5 | → **Meet はヘッドレスブラウザ Bot しか選択肢がない**。Google の規約に Bot 入室を禁じる明文はないが、**Google は製品側で「third-party bots, like note takers」を自動拒否・削除できるようにしている**（規約違反ではないが、排除されている経路を踏む） | 📗 7.3・7.4（**2026-09-05 修正**） |
| 6 | **仕様書の「Meet 先行」は見直しが妥当。Zoom（RTMS）先行の方が技術・規約とも固い** | 📕 上記2・5からの帰結（2 と 5 が 📗 になったため根拠は固まった） |
| 7 | 同意の業界実務は**三層**（Bot名で常時明示／プラットフォーム側通知／事前告知はホスト責任）。**キマルの FR-7 設計はこれと整合している** | 📗 各社の実装＋4社のプライバシーポリシー原文（7.6・「参加者の同意はホスト責任」を 4 社とも明記） |

---

## 2. 実装方式の比較

### 2.1 方式の一覧

| 方式 | 仕組み | 採用例 | キマルでの可否 |
|---|---|---|---|
| **A. 公式SDKによる headless bot** | プラットフォームの SDK でヘッドレスクライアントを作り、参加者として入室して raw audio を取得 | Zoom: 多数（既存） | ~~Zoom で採用可（推奨）~~ → **Zoom では規約上の正道ではない**（Meeting SDK は Bot 非対応・7.1） |
| **B. 公式APIによる bot-free** | 会議に参加せず、API 経由でメディアを取得 | Meet: Fireflies／Zoom: RTMS 対応アプリ | **Meet: 不可**（後述の制約）／**Zoom: RTMS で採用（推奨・7.2）** |
| **C. ヘッドレスブラウザ Bot** | Playwright/Chromium で人間と同じようにブラウザで入室 | Meet: tl;dv・Notta・Circleback 等 | **Meet で採用せざるを得ない**／Zoom: 不可（automated meeting client・7.1） |
| **D. Chrome 拡張** | ユーザーのブラウザ上で録音。サーバー側 Bot 不要 | Fireflies | **不採用**（ホストが会議中PCを開き続ける前提になる） |

### 2.2 Zoom

> ⚠️ **2026-09-05 更新（#370）**: 以下の「Meeting SDK for Linux で headless bot」前提は **7.1 で覆った**。Zoom 公式は Meeting SDK を「人間の利用向け・Bot／AI ノートテイカー非対応」とし、**RTMS**（7.2）を案内している。下の参照リンクのうち headless bot ブログと raw-data ページは 404（削除済み）。以下は調査時点（8月）の記録として残す。

📙 Zoom は **Meeting SDK for Linux** で headless bot を作る方法を公式に案内している（[Headless Meeting Bot サンプルの使い方](https://developers.zoom.us/blog/meeting-sdk-headless-bot-usage/)、[raw data 取得ドキュメント](https://developers.zoom.us/docs/meeting-sdk/linux/add-features/raw-data/)）。サンプルリポジトリ `meetingsdk-headless-linux-sample` が提供されている。

📙 開発者フォーラムで報告されている実装上の注意

- Bot 参加時に**録画許可プロンプト**が出る（＝同意取得の仕組みとしてはむしろ好都合）
- 物理サウンドデバイスがない環境では **ALSA / PulseAudio** が必要
- エンタープライズアカウントで raw recording が始まらない事例、`status 32` で raw audio の購読に失敗する事例の報告あり

📙 App Review の要件（検索結果の要約・**原文の再確認が必要**）

- 「**SDK アプリが bot participant として参加する場合はテストプランに明記すること**」
- 「録画・ライブ配信機能を起動するアプリは、全参加者へ適切な通知を行うこと」
- 「この通知要件は**録画するBotだけでなく、音声・映像などの会議データにアクセスするアプリ全般**に適用される」
- 「**自動化された会議クライアントは Zoom Meeting SDK を使い**、Zoom SDK App Requirements に準拠し、審査を経て Marketplace に公開すること」← **📕 これが事実なら、Zoom でヘッドレスブラウザ方式は規約違反**になる。**T-001 の残作業として原文を確認する** → **確認済（7.1）**: 出どころは 2023年8月の Zoom からのメール（📙）。上 3 点は公式ドキュメントで確認（📗）。現行ドキュメントはさらに進んで Meeting SDK 自体を Bot 非対応としている

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

📙 **ヘッドレスブラウザ Bot** — tl;dv・Notta・Circleback などが Meet で採用。Google Workspace Marketplace にも掲載されている（後述）ため、Google がこの形態のアプリを一律に排除してはいない。ただし**「ヘッドレスブラウザによる自動入室」そのものを Google が明示的に許可しているわけではない**点に注意（📕 Google 利用規約の自動化アクセス条項との関係は**T-001 の残作業** → **確認済（7.3・7.4）**: ToS に Bot 入室の明文禁止はないが、Google は「third-party bots, like note takers」を名指しして自動拒否の設定を案内している）。

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
| **③ 事前告知** | **ホストの責任**として整理されている | 📗 4社のプライバシーポリシー原文がいずれも「参加者の同意はユーザー（ホスト）の責任」と書く（7.6）／📙 日本語の解説記事でも「社外との商談では事前に録音の了承を取ることが重要」と案内 |

### 4.2 事業者側の実務 📙

日本語の解説記事では、AI議事録ツール導入時に次が案内されている。

- プライバシーポリシーに「**会議録音データを第三者ツールで処理する**」旨を記載し、利用目的を明確化する
- データ保存先を把握する

### 4.3 データ保存先の比較 📙→一部 📗（7.6）

| サービス | 保存先 |
|---|---|
| **Notta** | **AWS 東京リージョン**（📙 セキュリティページは「AWS」のみでリージョンの記載なし・7.6） |
| tl;dv | EU（EEA 内保存・Google Cloud／Hetzner／Wasabi・📗 7.6） |
| Otter.ai | 米国（AWS・📗 7.6） |
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
| 公式ルート | ✅ **RTMS**（Bot の代替として Zoom が公式に案内・7.2。~~Meeting SDK for Linux~~ は Bot 非対応・7.1） | ❌ 使える公式ルートがない（Media API は Preview、SDK は Workspace 管理者権限が必要） |
| 規約上の位置 | ✅ App Review を通せば明確に許容（Unlisted でも審査必須・7.2） | 📗 明文の禁止はないが Google が製品側で排除している経路（7.4） |
| 実装の安定性 | ✅ API／WebSocket なので UI 変更に強い | ❌ ブラウザ UI 変更で壊れる |
| 同意の仕組み | ✅ ホスト承認＋Zoom クライアントの全員向け開示（AAN）が標準装備（7.2） | 自前で用意する必要がある |
| 着手の障壁 | ❌ Developer Pack（クレジット・Contact Sales）の購入と App Review が必要 | ✅ 待たずに始められる |

**提案**: **Zoom を先行**とし、審査完了までの期間は **M0（基盤準備）**に充てる。実質的な遅延は小さい。**（2026-09-05 追記）Zoom の実装は Meeting SDK for Linux ではなく RTMS で行う。#388 のスコープ申請は RTMS のスコープで出し直す（7.8）。**

### 5.2 提案②：Meet はヘッドレスブラウザ前提で計画する

Meet の bot-free 方式は主要顧客層に届かない。**Meet 対応 = ヘッドレスブラウザ**と確定させ、それに伴うリスク（規約グレー・UI 変更で壊れる）を仕様のリスク表に明記する。日次の入室 E2E は**必須**。

### 5.3 提案③：Zoom の Legal UI Notices を要件に追加

📗 Meeting SDK アプリには9種類の Legal UI Notices の実装が義務付けられ、**非準拠は SDK アクセス停止のリスク**がある。特に **Active Apps Notifier (AAN)** は必須。仕様書の FR-7 または SEC に要件として追加する。

**（2026-09-05 追記）** RTMS を採る場合、この義務は Meeting SDK で自前 UI を描くアプリのものなので直接は掛からない。開示（ホスト承認ダイアログ・全員向けの開示・AAN）は **Zoom クライアント側が行う**（7.2・7.5）。要件は「AAN を自前実装する」から「Zoom の開示に乗る＝アプリ名を参加者に見える形で登録する」に読み替える。

### 5.4 提案④：`MeetingPlatformAdapter` の抽象度を見直す

Zoom は **SDK（C++/Linux）**、Meet は **ヘッドレスブラウザ（Playwright/TypeScript）** と、実装技術がまったく異なる。現行仕様の `MeetingPlatformAdapter`（TypeScript の単一インターフェース）では吸収しきれない可能性がある。

📕 **プロセス境界で分ける**設計（Bot コンテナ自体をプラットフォーム別に用意し、Orchestrator からは同じ起動パラメータで扱う）の方が素直。M1 の設計時に判断する。

**（2026-09-05 追記）** Zoom が RTMS（WebSocket で音声・文字起こしを受ける）になったため C++ の SDK 実装は消え、Zoom も Meet も TypeScript で書ける。「入室して録る（Meet）」と「ストリームを受ける（Zoom）」の違いは残るので、抽象の置き方は M1 で改めて判断する。

---

## 6. T-001 の残作業

**2026-09-05（#370）に #1〜#5 を消化した。結果は 7章。**

| # | 調べること | 方法 | 重要度 | 状況 |
|---:|---|---|---|---|
| 1 | **「自動化された会議クライアントは Meeting SDK を使うこと」の原文確認** | Zoom SDK App Requirements / App Review Guidelines の原文を精読 | **最高**（事実なら Zoom でのブラウザ方式は不可） | ✅ **確認済（7.1）**。文言は 2023 年のメール（📙）。現行ドキュメントは **Meeting SDK 自体を Bot 非対応**とし RTMS を案内（📗）→ Zoom はブラウザ方式・SDK Bot ともに不可、RTMS へ |
| 2 | Google 利用規約・Workspace 規約の**自動化アクセス条項** | 一次情報を精読し、ヘッドレスブラウザ入室との関係を整理 | 高 | ✅ **確認済（7.3・7.4）**。明文の禁止なし。ただし保護措置の回避・身元偽装は禁止で、Google は製品側で Bot を拒否・削除できる |
| 3 | Zoom Meeting SDK の**ライセンス条項**（Bot 用途・録音・再配布） | Zoom Developer Terms / SDK License | 高 | ✅ **確認済（7.5）**。「Developer Terms」は独立文書として存在せず、API License and Terms of Use＋Marketplace Developer Agreement が該当。Privacy Laws 遵守・最小権限・第三者利用は Marketplace 公開が条件 |
| 4 | Meet Media API の**一般提供時期** | Workspace リリースノートを定期確認 | 中（GA すれば設計が変わる） | ✅ **確認済（7.7）**。Developer Preview のまま（2025-02-24 開始）。GA の告知・時期の公表なし。定期確認は継続 |
| 5 | 各社の**プライバシーポリシー原文**（録音・保持・委託の記載） | Notta・tl;dv・Fireflies の日本語版を取得 | 中（T-003 の下敷き） | ✅ **確認済（7.6・英語版）**。4 社とも参加者の同意はホスト責任。Notta の保存リージョン（東京）だけ原文で未確認（📙） |
| 6 | Zoom Bot 参加時の**録画許可プロンプト**の実際の挙動 | PoC で実機確認 | 中 | ⬜ **置き換え**: RTMS の「ホスト承認 → 全員向け開示」フローと、ホスト側の「Share realtime meeting content with apps」ON・verified 要件を PoC で実機確認 |
| 7 | RTMS の**単価**（Developer Pack） | Zoom sales に問い合わせ（公式ページは Contact Sales のみ） | 高（原価 7.2 章に直結） | ⬜ 未着手（📙 パートナー回答は 0.01〜0.02 credit/分） |
| 8 | Zoom の**審査運用とドキュメントの齟齬**（Meeting SDK + OBF の Bot が「still valid」と回答） | Developer Forum で確認、または RTMS で submit して審査基準を確かめる | 低（RTMS を選べば回避できる） | ⬜ 未着手 |
| 9 | Google Meet の **"Potential risk" 表示**の一次情報 | Google Meet ヘルプ／Workspace Updates を定期確認 | 中（Meet の入室成功率に直結） | ⬜ 未着手（📙 コミュニティ・ブログのみ） |

---

## 7. 規約原文の確認（#370・2026-09-05）

6章の残作業 #1〜#5 について、**一次情報の原文を取得して照合した**（取得日はすべて 2026-09-05。各ページを `curl` で取得してテキスト化し、該当文を原文どおりに抜き出した。要約モデル経由でしか取れなかった箇所はその旨を書く）。引用は原文（英語）のまま、直後に一行の日本語で意味を添える。**結論を変える発見が2つある**——Zoom は Meeting SDK を Bot 用途に認めておらず RTMS を案内している（7.1・7.2）、Google は規約では Bot を禁じていないが製品側で排除している（7.4）。

### 7.1 Zoom：「自動化された会議クライアントは Meeting SDK を使え」の原文（残作業 #1・最高）

**結論：6章 #1 の文言は 2023年8月に Zoom が開発者へ送ったメールのもので、現行の公式ドキュメントにはない。現行ドキュメントはさらに踏み込み、「Meeting SDK は人間の利用向けで、Bot・AI ノートテイカーは非対応。RTMS を使え」と明記している。** したがって Zoom では、ヘッドレスブラウザ方式が不可なだけでなく、**本書 2.2 が「正道」とした Meeting SDK for Linux の Bot も規約上の正道ではなくなった**。

📗 **Meeting SDK usage policy**（Meeting SDK for Linux／for web の冒頭に同文）
- https://developers.zoom.us/docs/meeting-sdk/linux/ ／ https://developers.zoom.us/docs/meeting-sdk/web/
> "The Meeting SDK is reserved for human use cases and does not support bots or AI notetakers. To build an AI notetaker application or access realtime media, use Zoom RTMS (Real-time media streams)."

Meeting SDK は人間の利用向けであり Bot・AI ノートテイカーには対応しない。AI ノートテイカーやリアルタイムメディアの取得には RTMS を使え——という利用方針。Windows 版のページには同じ注記は無い（Linux・Web という「Bot が作られやすい」2面に置かれている）。

📗 **FAQ - Updates to Meeting SDK authorization**（OBF FAQ）
- https://developers.zoom.us/docs/meeting-sdk/obf-faq/
> "Beginning March 2, 2026, Zoom requires the use of an On Behalf Of (OBF) token for Meeting SDK (MSDK) apps joining meetings hosted by external accounts. For use cases requiring continuous data access or persistent recording, use Real Time Media Streams (RTMS) for best results."

2026年3月2日以降、外部アカウントの会議に入る Meeting SDK アプリは OBF トークンが必須。継続的なデータ取得・録音の用途は RTMS を使え。

> "OBF tokens represent an app. Use them when the MSDK app joins a meeting as an automated participant like a recording or note-taking app."

OBF トークンは「アプリ」を表す。録音・ノートテイカーのような自動参加者として入るときに使う（＝Zoom は Bot 参加を OBF で「帰属」させる整理）。

> "No. OBF tokens can only be obtained for participants who have authorized the app via OAuth, and who are actively present in the meeting. The SDK app cannot join the meeting or webinar until that authorized user joins."

OBF は OAuth でアプリを認可した参加者が**会議に在席しているとき**だけ取れる。認可ユーザーが入るまで SDK アプリは入室できない。

> "Can the Meeting SDK app continue recording when the authorized user leaves the meeting? No. The SDK session is tied to the presence of the authorizing user, so the session ends when that user leaves the meeting. For continuous or automated recording, use RTMS."

認可ユーザーが退出すると SDK セッションも終わる。継続的・自動的な録音は RTMS で。

📗 **Changelog: Requiring authorization for meetings joined outside of an app's account**
- https://developers.zoom.us/changelog/meeting-sdk/requiring-authorization-for-meetings-joined-outside-of-an-apps-account/
> "Starting February 23, 2026, apps that access meeting content, including Meeting SDK apps that join as participants, will need to attribute to a user when joining meetings outside their own Zoom account. After this date, the Meeting SDK will no longer be able to join meetings outside its own account anonymously."

会議コンテンツにアクセスするアプリ（参加者として入る Meeting SDK アプリを含む）は、自アカウント外の会議では必ずユーザーに帰属させる。匿名の入室はできなくなる。

> "Realtime Media Streams (RTMS): A purpose-built pipeline and user experience framework for apps to access meeting content with simple host controls for trust and adoption. In addition to the dedicated host controls, the apps name is displayed on the user's meeting tile instead of as a separate entry in the participant list."

RTMS は会議コンテンツにアクセスするための専用パイプライン。参加者一覧に別枠で並ぶのではなく、利用ユーザーのタイルにアプリ名が表示される。

📗 **Changelog: Meeting SDK apps now require review to join meetings outside their own account**
- https://developers.zoom.us/changelog/platform/meeting-sdk-policy-announcement/
> "Under a new policy all Meeting SDK apps are required to go through app review to access meetings outside of the developer account used to create it."

自アカウント外の会議に入る Meeting SDK アプリはすべて App Review が必要（2.2 の 📙「審査を経て Marketplace に公開すること」はこれ。📗 に昇格）。

📗 **Meeting SDK feature review & requirements**
- https://developers.zoom.us/docs/distribute/sdk-feature-review-requirements/
> "Call out if the SDK app joins meetings as a bot participant."

テストプランに「Bot 参加者として入るか」を明記せよ（2.2 の 📙 1点目。📗 に昇格）。

> "The app triggers Zoom's recording or live streaming feature which will trigger the native recording/streaming indicator, and provide proper notifications to all participants when accessing Zoom meeting and webinar content."

録画・配信は Zoom 標準の機能を起動して標準インジケータを出し、会議コンテンツにアクセスするときは全参加者へ適切な通知を行う（2.2 の 📙 2・3点目。📗 に昇格）。

> "User-facing SDK apps must implement all Legal UI Notices associated with the features used by the Zoom Meeting SDK."

ユーザー向け SDK アプリは Legal UI Notices を全部実装する。**このページに "automated" の語は無い。** また **App Review Guidelines and Principles**（https://developers.zoom.us/docs/distribute/app-review-guidelines/・Published March 12, 2023）にも bot／automated／recording の語は無い（原文で確認）。

📙 **「All automated meeting clients must use the Zoom Meeting SDK」の出どころ**
- Zoom Developer Forum「Submit app for bot automation and recording」（2023-08-14）https://devforum.zoom.us/t/submit-app-for-bot-automation-and-recording/93366 に、開発者が Zoom から受け取ったメールとして引用されている:
> "You are receiving this email because Zoom has identified that you are running an automated meeting client. All automated meeting clients must use the Zoom Meeting SDK and comply with the Zoom SDK App Requirements. Zoom requires SDK applications to be submitted for review and published to the Zoom Marketplace. We require all apps to trigger the appropriate notification via our Meeting SDK when meeting content is being accessed."

Zoom は「自動化された会議クライアント」を検知して通告し、Meeting SDK への移行と Marketplace 審査を求めた（2023年10月19日期限）。このメールが指す `docs/distribute/sdk-app-requirements/` と `docs/zoom-apps/guides/meeting-bots-sdk-media-streams/` は **2026-09-05 時点で 404**。当時の Web SDK（ブラウザ）Bot は「automated meeting client」として排除対象だった＝**ヘッドレスブラウザ方式が Zoom で不可なのは 2023 年から**。

📙 **審査運用との齟齬（要注意）**
- Zoom Developer Forum「Marketplace review eligibility for commercial AI facilitator bot using Linux Meeting SDK + OBF」（2026-07-22）https://devforum.zoom.us/t/marketplace-review-eligibility-for-commercial-ai-facilitator-bot-using-linux-meeting-sdk-obf/144959 で、Linux Meeting SDK + OBF で名前付き Bot を入れる商用アプリについて Zoom スタッフ（chunsiong.zoom・2026-07-23）が
> "this use case is still valid, you will need to go thru marketplace submission for this scenario."

と回答している。**ドキュメント（Bot 非対応）と審査運用（審査を通せば可）が食い違う。** 📕 いずれ運用も文書に揃うと見るのが安全で、新規に作るなら RTMS を選ぶ。

### 7.2 Zoom：RTMS（Realtime Media Streams）— Bot の代替として公式が案内する経路（新規）

📗 **Realtime Media Streams**（概要）
- https://developers.zoom.us/docs/rtms/
> "Realtime Media Streams (RTMS) is a data pipeline that gives your app access to live audio, video, and transcript data from Zoom meetings. Instead of having participant bots or automated clients in meetings, use RTMS apps to collect the media data from the meeting."

会議の音声・映像・文字起こしをライブで受け取るデータパイプライン。**参加者 Bot や自動クライアントを会議に入れる代わりに**これを使え。

> "To use RTMS, you'll need credits on your account. For plan options, see Developer pricing. For volume discounts or commitments above 500 credits, contact sales."

利用にはアカウントのクレジット（Developer Pack）が必要。

📗 **Overview of RTMS for meetings and webinars**
- https://developers.zoom.us/docs/rtms/meetings/
> "Apps can auto-start when users join meetings and webinars." ／ "Apps eliminate the need for bots or device software." ／ "Separated audio for individual and merged tracks" ／ "Diarized transcripts that include not only what was said but who said it and when"

ユーザーの入室で自動開始できる。Bot 不要。個別トラックと合成トラックの音声、話者分離済みの文字起こしが取れる。

📗 **Getting started with Realtime Media Streams**
- https://developers.zoom.us/docs/rtms/meetings/getting-started/
> "RTMS is available to all developers — to get started, create an app, add RTMS scopes to the app, and then start developing your app to use RTMS."
> "Streams can launch in a few ways: Automatically - when a user joins or hosts a meeting or webinar. On-demand - using REST API calls that include the meeting or webinar ID. From a Zoom App - using the startRTMS() method in the Zoom Apps SDK."

全開発者が使える。開始方法は「ユーザーの入室で自動」「REST API でオンデマンド」「Zoom App から」の3つ。

📗 **Meeting and webinar experience overview**（参加者に何が見えるか）
- https://developers.zoom.us/docs/rtms/meetings/ux-overview/
> "A participant brings an RTMS-enabled app into a meeting or webinar and sends a request to the host to access content. The host reviews requests and can choose to Approve or Deny the app access to content. Once an app is approved and running, the Zoom client displays the disclosure to everyone in the meeting or webinar. Everyone can click View apps to view a list of the apps accessing content and each app's Active App Notifier."

アプリを持ち込んだ参加者からホストへ承認要求 → ホストが承認/拒否 → 承認後は **Zoom クライアントが全員に開示を表示**し、誰でも「View apps」からアクセス中のアプリと AAN を見られる。**4.1 の①②が Zoom 側で標準装備される。**

📗 **Host and admin tools and controls**
- https://developers.zoom.us/docs/rtms/meetings/ux-host-admin-tools-ctrls/
> "Account admins can enable RTMS at the account, group, and user levels." ／ "Turn on Share realtime meeting content with apps or Share realtime webinar content with apps." ／ "Meeting and webinar hosts control whether participants must request host approval before the RTMS-enabled app can access content."

ホスト側アカウントの設定「Share realtime meeting content with apps」が ON である必要がある。ホストは承認要求の要否を決められる。

📗 **Submit an RTMS app for review**
- https://developers.zoom.us/docs/rtms/meetings/submit-app-review/
> "Whether you choose to list your app or not, App Review is required for any app that is distributed to users outside your Zoom account." ／ "You'll need to have developer pack credits to get your app approved."

自アカウント外へ配る RTMS アプリは（非公開＝Unlisted でも）App Review 必須。承認には Developer Pack のクレジットが要る。

📙 **費用・ホストのアカウント条件**（Developer Forum。Zoom スタッフの回答は明記）
- Zoom スタッフ chunsiong.zoom（2026-06-26）https://devforum.zoom.us/t/does-rtms-deliver-audio-transcript-when-the-meeting-host-is-on-a-basic-free-plan-and-does-it-work-for-hosts-on-the-zoom-web-client/144455 : "Yes you can use a free account, you will need to make sure Developer Pack is on your account, as this activates RTMS on your account" ／ "Auto start will work on Web Client" — **ホストが無料（Basic）でも動く**。Developer Pack は開発者（キマル）側のアカウントに要る。
- Zoom スタッフ michael.zoom（2026-03-05）https://devforum.zoom.us/t/does-startrtms-require-the-meeting-host-to-have-a-paid-pro-licensed-zoom-plan/142303 : "The user does not need to be paid, but startRTMS() requires an account to be verified for the end user to start media access in a meeting." — 有料は不要だが**アカウントの verified が必要**。
- 単価は Zoom 公式ページに数値が無く（Developer pricing は "Contact Sales" のみ・JS 描画で取得できず）、パートナー企業（Recall.ai・2026-08-10）の回答 "0.01 credit per minute without transcription and 0.02 per minute when transcription is enabled" があるだけ → **未確認（取得できず）**。

📕 **キマルへの含意**：キマルは既にホストの Zoom OAuth 連携を持ち、面談の Zoom ミーティングはホストのアカウントで作られる。**RTMS はこの構造にそのまま乗る**——Bot を入室させず、ホストの承認と Zoom 標準の開示のもとで、話者分離済みの音声・文字起こしを WebSocket で受け取れる。Meeting SDK for Linux（C++）の実装は不要になる。障壁は (1) Developer Pack の購入（Contact Sales・単価不明）、(2) ホスト側アカウントで「Share realtime meeting content with apps」が ON かつ verified であること、(3) App Review。**#388（Zoom スコープ申請）は Meeting SDK ではなく RTMS のスコープ（`meeting:read:meeting_audio`・`meeting:read:meeting_transcript`・`rtms:read:rtms_started`・`rtms:read:rtms_stopped` 等）で出し直す。**

### 7.3 Google：利用規約・Workspace AUP の自動化アクセス条項（残作業 #2）

📗 **Google Terms of Service**（Effective July 30, 2026）
- https://policies.google.com/terms?hl=en — "Don't abuse our services"
> "You must not abuse, harm, interfere with, or disrupt our services or systems — for example, by: introducing malware / spamming, hacking, or bypassing our systems or protective measures / ... / accessing or using our services or content in fraudulent or deceptive ways ... / using automated means to access content from any of our services in violation of the machine-readable instructions on our web pages (for example, robots.txt files that disallow crawling, training, or other activities) / ... / hiding or misrepresenting who you are in order to violate these terms"

「自動化手段」の禁止は **robots.txt 等の機械可読指示に違反する場合**に限定されており、ヘッドレスブラウザで Meet に入る行為そのものを名指ししていない。ただし「**bypassing our systems or protective measures**（保護措置の回避）」と「**hiding or misrepresenting who you are**（身元の偽装）」があるため、**Google が Bot を自動拒否する仕組み（7.4）をすり抜ける実装や、人間を装う実装は明確に抵触する。**

📗 **Google Workspace Acceptable Use Policy**（Last modified: October 13, 2025）
- https://workspace.google.com/intl/en/terms/use_policy/
> "to record audio or video communications without consent if such consent is required by applicable laws and regulations (you are solely responsible for ensuring compliance with all applicable laws and regulations in the relevant jurisdiction(s))."
> "Your failure to comply with the AUP may result in suspension or termination, or both, of the applicable Services pursuant to the Agreement."

「法律が同意を要求する場合に、同意なく音声・映像通信を録音すること」を禁止。同文は Google Cloud AUP（Last modified June 23, 2026・https://cloud.google.com/terms/aup?hl=en）の "For Google Workspace" 節にもある。**AUP は Workspace 顧客（＝ホスト）を縛る規定**で、Bot 事業者を直接縛るのは ToS と Marketplace Program Policies。キマルの FR-7（ホスト・ゲスト双方の明示同意）はこの条項を満たす。

📗 **Google Workspace Marketplace Program Policies**（Last updated: August 28, 2025）
- https://developers.google.com/workspace/marketplace/terms/policies
- "bot"／"bots" の語は **0件**。Meet への自動入室を禁じる条項は無い。適用されるのは一般条項——
> "Do not impersonate a person or organization or misrepresent yourself."

### 7.4 Google Meet：Bot の入室に対する Google の姿勢（新規・重要）

規約に明文の禁止はない（7.3）が、**Google は製品の側で第三者 Bot を「セキュリティリスク」と位置づけ、拒否・削除の手段をホストと管理者に与えている。**

📗 **Tips to control meeting access and participation**（Google Workspace Learning Center）
- https://support.google.com/a/users/answer/11989526?hl=en
> "Tip: This turns off "knocking" for the entire meeting. Anonymous users or third-party bots, like note takers, that attempt to use "Ask to join" are automatically denied access without actions required by the host."

ホストが「Anyone can ask to join」を外すと、匿名ユーザーと**ノートテイカーのような第三者 Bot**の「参加をリクエスト」は**ホストが何もしなくても自動的に拒否**される。Google 自身が「third-party bots, like note takers」を名指しして、これを締め出す設定を案内している。

📗 **External apps are recording Meet meetings**（Google Workspace Admin Help・Last updated 2026-08-26）※本文は JS 描画のため要約モデル（WebFetch）経由の抜き出し。原文照合はブラウザで再確認すること
- https://knowledge.workspace.google.com/admin/support/troubleshooting/external-apps-are-recording-meet-meetings
> "Recording Meet meetings with third-party apps can be a security risk. Use the tips below to restrict those external apps and keep meetings safe for your users."
> "If you see a third-party app in a meeting, you can remove it like any other participant."

第三者アプリによる Meet の録音は「セキュリティリスク」であり、管理者向けに制限方法（Chrome での拒否ドメイン、API アクセス遮断、参加制限の既定化）を案内。会議中に見つけたら参加者と同様に退出させられる。

📙 **「Potential risk」表示**：2026年3月以降、Meet が第三者ノートテイカー Bot を "Potential risk" と表示し既定で入室を拒むという報告（Google Meet Community スレッド https://support.google.com/meet/thread/438497815 ・各社ブログ）。**Google 公式文書上の該当語は未確認（取得できず）。**

📗 **Require explicit consent for Take Notes with Gemini, recordings, and transcripts in Google Meet**（Google Workspace Updates・2026年4月）
- https://workspaceupdates.googleblog.com/2026/04/require-explicit-consent-for-take-notes-with-Gemini-recordings-and-transcripts-in-Google-Meet.html
> "We're introducing a new feature that allows administrators to require explicit consent from meeting participants before automatic note-taking, recording, and/or transcription begins. With this update, admins can ensure that participants on supported devices must actively agree to be recorded, be transcribed, or have notes enabled."

Google 自身のメモ・録画・文字起こしでも、**参加者の明示同意を必須化できる**機能を 2026-05-05 から展開。「参加者が能動的に同意する」方向が Google の標準になりつつある——キマルの FR-7.3（予約時の明示チェック）はこれと同じ向き。

📕 **判定**：Meet でのヘッドレスブラウザ Bot は「規約違反」ではないが、「**Google が製品で積極的に排除している経路**」である。キマルで採るなら次を前提にする。(a) ホスト（＝面談の主催者＝キマルのユーザー）が Bot を自分で admit する運用（ホストは自社ユーザーなので運用で担保できる）。(b) ホストが「Anyone can ask to join」を OFF にしていると入室できないことを、初期設定の案内に書く。(c) **Bot 検知を回避する実装（人間を装う UA・挙動）はしない**——ToS の "bypassing our systems or protective measures" に抵触する。(d) Media API の GA を待つ選択肢を残す（7.7）。

### 7.5 Zoom：API ライセンス・Marketplace 契約・Legal UI Notices（残作業 #3）

「Zoom Developer Terms」という独立文書は見つからなかった（`/trust/terms/developer-terms/`・`/trust/legal/developer-terms/`・`explore.zoom.us/en/legal/developer-terms/` はいずれも 404）。開発者を縛るのは次の 2 文書（＋Marketplace Terms of Use）。

📗 **Zoom API License and Terms of Use**（Last Updated: July 16, 2025・ページタイトルは "App Marketplace Terms of Service"）
- https://www.zoom.com/en/trust/legal/zoom-api-license-and-tou/
- 禁止事項（"Prohibited Uses. You may not use the Zoom APIs, or any information, data or content accessed or obtained using the Zoom APIs, or your Application:" に続く列挙から）:
> "Violating applicable laws and/or regulations pertaining to privacy, information security, or data protection, including laws governing recording or interception of audio, video or other communications (collectively, "Privacy Laws")."

録音・通信の傍受に関する法令を含む Privacy Laws への違反を禁止（**録音の適法性は開発者の責任**）。

> "To scrape, build databases, or otherwise create copies of any data accessed or obtained using the Zoom APIs by your Application."

API で得たデータのスクレイプ・DB 化・複製の禁止（📕 面談の文字起こしを**ユーザーのために**保存するのは「Application の意図された機能」であり、ここで言う複製には当たらないと読むが、T-002 で確認する）。

> "To request from the Zoom APIs more than the minimum amount of data, or more than the minimum permissions to the types of data, that your Application needs for End Users to use the intended functionality of your Application."

最小権限・最小データ（RTMS のスコープは音声＋文字起こしに絞り、映像は取らない）。

> "...the implementation, publication, and/or distribution of your Application(s) to, or use by, any Third Parties (collectively, "Third Party Use") is permitted only where: (1) your Application has been published to the Zoom App Marketplace; or (2) that Third Party Use has been approved, in writing, in advance, by Zoom."

第三者（＝キマルのユーザー）に使わせるには **Marketplace 公開か Zoom の書面承認が必須**。

> "Publication on Marketplace. Any publication or distribution of your Application on Zoom's Marketplace or as part of the Zoom Apps program is subject to the Marketplace Developer Agreement."

- 商標（"Trademark Licenses for SDK Apps"）:
> "SDK App developers grant Zoom a non-exclusive, non-transferable, royalty-free, fully paid-up, revocable, worldwide right and license, during the term of use of the Zoom SDK, to use your name, trademarks, service marks, logos, and symbols (collectively, "Your Marks") subject to your brand use guidelines provided to Zoom, solely to: (i) promote your SDK App on Zoom's website and in marketing materials; (ii) for other marketing activities mutually agreed to in writing; ..."
> "Zoom grants SDK App developers a non-exclusive, non-transferable, royalty-free, fully paid-up, revocable, worldwide right and license, during the term of use of the Zoom SDK, to use the Zoom Marks solely for display within your SDK App and on your SDK App's website to promote your SDK App's compatibility with Zoom's services and software."

SDK アプリの開発者は自社ロゴを Zoom の宣伝に使わせる。Zoom ロゴは「互換性の表示」にだけ使える。

📗 **Marketplace Developer Agreement**（Last Updated: November 28th, 2022）
- https://www.zoom.com/en/trust/marketplace-developer-agreement/
> "Zoom may suspend or disable your use of or access to the Marketplace, or remove your Application from the Marketplace or from within Zoom Products, at any time, for any reason, without prior notice, liability, or other obligation to you."
> "Termination by Zoom. Zoom may terminate this Agreement at any time, for any reason, without prior notice, liability, or other obligation to you."

Zoom はいつでも理由なく停止・削除・解約できる（**プラットフォーム依存リスクとして仕様のリスク表に載せる**）。

📗 **UI notices in the Meeting SDK**（Legal UI Notices）
- https://developers.zoom.us/docs/meeting-sdk/ui-notices/
> "These notices are mandatory; if you don't include them, we reserve the right to suspend your access to the Zoom Meeting SDKs."
> "The Active Apps Notifier (AAN) provides a notice to meeting and webinar participants when a host or other participant is using an app that accesses meeting or webinar content, such as video, audio, chat, or meeting files during a meeting."
> "The AAN must be visible and easy for an end user to find." ／ "You must display the Active Apps Notifier icon in your meeting UI."

2.2 の記述どおり（📗 据え置き）。**ただし RTMS を採るなら、これは Meeting SDK で自前 UI を描くアプリの義務であり、キマルには直接は掛からない**——開示は Zoom クライアント側が行う（7.2 UX overview）。5.3 の提案は「AAN を自前実装する」から「Zoom の開示に乗る（アプリ名が参加者に見える）」に性質が変わる。

### 7.6 競合4社のプライバシーポリシー原文（残作業 #5）

| 社 | URL | 版 |
|---|---|---|
| Notta | https://www.notta.ai/en/privacy | Effective as of September 2, 2025 |
| tl;dv（Tldx Solutions GmbH） | https://tldv.io/privacy/ | Current version published: July 1st, 2026 |
| Fireflies.ai | https://fireflies.ai/privacy-policy | Last Updated: March 6, 2026 |
| Otter.ai | https://otter.ai/privacy-policy | Effective June 16, 2026 |

📗 **Notta**
> "If you provide an audio or video recording, this may contain the personal information of third parties. Before you do so, please make sure you have the necessary permissions from your colleagues, friends or other third parties before sharing Personal Information or referring them to us."

録音に含まれる第三者の同意は**ユーザーの責任**。
> "Trusted third parties. We may disclose your information to service providers we rely on for the provision of the Services, including cloud storage, payment processing, voice transcriptions, video creation and animation (Notta Showcase), data analytics, and customer service."

委託先はカテゴリのみ（個社名の一覧は無い）。保持期間の具体的な日数の記載は無し（削除請求権のみ）。Bot 入室に固有の条項は無い。
- Security ページ https://www.notta.ai/en/security : "Notta hosts all its software on Amazon Web Services (AWS)" — **リージョン（東京）の記載は無い** → 4.3 の「AWS 東京リージョン」は **📙 のまま（原文で未確認）**。

📗 **tl;dv**
> "Video and audio recording, written transcriptions ... Free user: 3 months / Paying user: until account deletion"

録音・文字起こしの保持は無料 3 か月／有料はアカウント削除まで。
> "Email address of people not subscribed but are participants in a meeting where the solution would be used ... Collect consent from non-client meeting participants before the meeting. But also associate meetings participated in to user once they create an account. ... For 5 years or upon deletion request ... Legitimate Interest"

**非ユーザーの参加者の同意は「会議前に取る」**と明記（法的根拠は正当な利益、保持 5 年）。
> "All personal data collected through our platform is primarily processed and stored in facilities located in the European Economic Area (EEA), in accordance with the standards established by the European Union's General Data Protection Regulation (GDPR)."
> "Hosting/infrastructure/storage providers: Google Cloud, Hetzner, Wasabi"

EEA 内保存、委託先の個社名を列挙。**4.3「tl;dv: EU」は 📗 に昇格。**
> "Tldx Solutions GmbH does not access your recordings and transcriptions at any time, unless you personally share access with individual employees for technical assistance."

📗 **Fireflies.ai**
> "Meeting and Call Information: If enabled, certain features and integrations of our Services will collect meeting and call details, such as the names and email addresses of participants and invitees, the title of the meeting, meeting audio and visual files, and other meeting details, like meeting URLs and meeting IDs."
> "If you close your account, we will delete personal information related to your account within 30 days."
> "We also impose a Zero Data Retention policy for meeting content, which includes audio, video, transcripts, and summaries of the meeting. This means that your meeting content is not: (1) stored by any third-party vendor after processing; (2) accessed by any third-party vendor once the service is completed; or (3) used for training internal or external AI models."

委託先（STT・LLM）に会議コンテンツを残さない **Zero Data Retention** を明記——キマルの「音声は文字起こし後即時削除」「LLM 提供者への委託」（T-002 論点 9）の書き方の手本。
> "If you do not have an account but participated in a meeting where our Services were enabled, please reach out to the meeting host to request deletion of the meeting recording."

非ユーザーの参加者の削除請求は**ホスト経由**。
> "Fireflies.ai is based in the United States, and we and our service providers process and store personal information on servers located in the United States and other countries."
> "More information about our subprocessors is available at https://trust.fireflies.ai/subprocessors"

📗 **Otter.ai**
> "If you provide an Audio Recording, this may contain the Personal Information of third parties. Before you do so, please make sure you have the necessary permissions from your co-workers, friends or other third parties before sharing Personal Information or referring them to us."
> "Otter.ai stores all Personal Information for as long as necessary to fulfill the purposes set out in this Policy, or for as long as we are required to do so by law or in order to comply with a regulatory obligation."
> "Cloud service providers who we rely on for compute and data storage, including Amazon Web Services, based in the United States."
> "Improve and monitor the Services, including training our proprietary AI technology on de-identified audio recordings and on transcriptions (which may contain Personal Information)"

米国 AWS 保存（**4.3「Otter: 米国」は 📗 に昇格**）。**匿名化した録音・文字起こしを自社 AI の学習に使う**と明記（キマルは「学習に使わない」を明記すれば差別化になる）。

📕 **4社共通の観察**：①録音に含まれる第三者（参加者）の同意は**ユーザー＝ホストの責任**と書く（Notta・Otter："make sure you have the necessary permissions"／tl;dv："Collect consent from non-client meeting participants before the meeting"／Fireflies：非ユーザーはホスト経由で削除請求）→ **4.1 ③「事前告知はホスト責任」は 📗 に昇格**。②**Bot の入室そのものを規定した条項は 4 社とも無い**（Bot 名・バナー等は製品挙動であってポリシーの記載ではない）。③ 委託先の個社名を本文に載せるのは tl;dv のみ（Fireflies は別ページへリンク）。

### 7.7 Meet Media API の状況（残作業 #4）

📗 **Meet Media API overview**（Last updated 2026-07-22 UTC）
- https://developers.google.com/workspace/meet/media-api/guides/overview
> "Developer Preview: Available as part of the Google Workspace Developer Preview Program, which grants early access to certain features. To use the Meet Media API to access real-time media from a conference, the Google Cloud project, OAuth principal, and all participants in the conference must be enrolled in the Developer Preview Program."
> "Meet Media API apps are only permitted into a meeting if there's someone in the call that's allowed to provide consent on behalf of the meeting." ／ "For meetings organized by Gmail accounts, the initiator must be in the meeting to provide consent." ／ "Anyone can stop the Meet Media API during the call."

📗 **Google Meet REST API release notes**（2026-09-05 取得）
- https://developers.google.com/workspace/meet/release-notes
> "February 24, 2025 — Meet Media API — Developer Preview: The Google Meet Media API is now available as part of the Developer Preview Program. The Meet Media API lets you access real-time media from Google Meet conferences."

これ以降、Media API の一般提供（Generally Available）を告げる項目は無い（GA の項目は REST API・Add-ons SDK・Events API のみ）。**結論 4 は据え置き**。GA 時期の公表も無い。

### 7.8 Bot 実装方式への影響

**決まったこと**

- **Zoom ＝ RTMS（bot-free）。Meeting SDK Bot ではない。** Zoom は Meeting SDK を「人間の利用向け・Bot 非対応」と明記し（📗 7.1）、Bot の代替として RTMS を案内している（📗 7.2）。ヘッドレスブラウザ方式は 2023 年から「automated meeting client」として排除対象（📙 7.1）。RTMS は「既にホストの Zoom OAuth を持ち、ホストのアカウントで面談を作る」キマルの構造にそのまま乗り、ホスト承認＋Zoom クライアントの開示（AAN）が標準装備される。ホストが無料アカウントでも動く（📙 Zoom スタッフ回答）。**#388 のスコープ申請は RTMS のスコープで出し直す。**
- **Meet ＝ ヘッドレスブラウザのみ。規約違反ではないが、Google が製品側で排除している経路。** ToS は Bot 入室を名指し禁止していない（📗 7.3）が、Google は「third-party bots, like note takers」を名指しして自動拒否の設定を案内し、第三者アプリの録音を「セキュリティリスク」と位置づける（📗 7.4）。採るなら「ホスト（自社ユーザー）が admit する運用」「Bot 検知の回避はしない」「日次 E2E」を前提にする。Media API は Developer Preview のまま（📗 7.7）。
- **順序は Zoom 先行のまま（5.1 の提案は維持）。** ただし 5.1 の「Meeting SDK for Linux」は RTMS に読み替える。C++ の SDK 実装が消えるため、5.4 の「実装技術がまったく異なる」問題は軽くなる（Zoom は WebSocket、Meet は Playwright——どちらも TypeScript で書ける）。5.3 の Legal UI Notices は、RTMS では Zoom クライアントが開示を担うため「自前で AAN を描く」義務ではなく「Zoom の開示に乗る」性質になる。
- **同意設計（FR-7）は業界より厳しい、という 4.4 の評価は原文でも裏づけられた**（4 社とも参加者の同意はホスト責任・📗 7.6）。Google 自身も参加者の明示同意を必須化する方向（📗 7.4）。

**まだ開いていること**

- RTMS の単価（Developer Pack は "Contact Sales" のみ。パートナー回答の 0.01〜0.02 credit/分は未確認）→ Zoom sales に問い合わせる。
- Zoom の審査運用とドキュメントの齟齬（Meeting SDK + OBF の Bot が「still valid」と回答されている・📙 7.1）。新規なら RTMS でよいが、審査でどちらの基準が適用されるかは submit してみないと分からない。
- RTMS でホスト側に必要な「Share realtime meeting content with apps」ON と verified の条件が、キマルのホスト層（個人・Basic）でどの程度満たされるか → PoC で実機確認（旧 6章 #6 を置き換え）。
- Google の "Potential risk" 表示の一次情報（📙）。
- Notta の保存リージョン（東京）は原文で未確認（📙）。

---

## 8. T-002（法務相談）への引き継ぎ

### 8.1 相談の進め方

- **相談相手**: IT・個人情報保護分野の弁護士。**スポット相談で足りる**（顧問契約は不要）
- **持ち込む資料**: 本書 ＋ サービス概要 ＋ データフロー図 ＋ 下記の論点リスト
- **狙い**: ゼロから論点整理してもらうのではなく、「**業界標準はこう。当社はそれ以上に保守的（4.4）。過不足があるか**」を確認する形にして、時間と費用を圧縮する

### 8.2 論点リスト

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
| 9 | **LLM 提供者への委託**の位置づけとプライバシーポリシーへの記載方法 | 4.2 の実務・7.6（Fireflies の Zero Data Retention の書き方） |
| 10 | **通信の秘密**（電気通信事業法）の適用有無 | — |
| 11 | **1対1限定**（3人以上で退出）という割り切りの妥当性 | FR-7.1・7.7 |

---

## 9. 出典

**一次情報 📗**（7章で追加・2026-09-05 取得）

- Zoom: [Meeting SDK for Linux](https://developers.zoom.us/docs/meeting-sdk/linux/)／[Meeting SDK for web](https://developers.zoom.us/docs/meeting-sdk/web/)（Meeting SDK usage policy：Bot・AI ノートテイカー非対応）
- Zoom: [FAQ - Updates to Meeting SDK authorization](https://developers.zoom.us/docs/meeting-sdk/obf-faq/)（OBF・2026-03-02 施行・RTMS 推奨）
- Zoom Changelog: [Requiring authorization for meetings joined outside of an app's account](https://developers.zoom.us/changelog/meeting-sdk/requiring-authorization-for-meetings-joined-outside-of-an-apps-account/)／[Meeting SDK apps now require review to join meetings outside their own account](https://developers.zoom.us/changelog/platform/meeting-sdk-policy-announcement/)
- Zoom: [Meeting SDK feature review & requirements](https://developers.zoom.us/docs/distribute/sdk-feature-review-requirements/)／[App Review Guidelines and Principles](https://developers.zoom.us/docs/distribute/app-review-guidelines/)（原文確認により 📙→📗）
- Zoom RTMS: [Realtime Media Streams](https://developers.zoom.us/docs/rtms/)／[Overview for meetings and webinars](https://developers.zoom.us/docs/rtms/meetings/)／[Getting started](https://developers.zoom.us/docs/rtms/meetings/getting-started/)／[Meeting and webinar experience overview](https://developers.zoom.us/docs/rtms/meetings/ux-overview/)／[Host and admin tools and controls](https://developers.zoom.us/docs/rtms/meetings/ux-host-admin-tools-ctrls/)／[Submit an RTMS app for review](https://developers.zoom.us/docs/rtms/meetings/submit-app-review/)
- Zoom: [API License and Terms of Use](https://www.zoom.com/en/trust/legal/zoom-api-license-and-tou/)（Last Updated: July 16, 2025）／[Marketplace Developer Agreement](https://www.zoom.com/en/trust/marketplace-developer-agreement/)（Last Updated: November 28th, 2022）
- Google: [Terms of Service](https://policies.google.com/terms?hl=en)（Effective July 30, 2026）／[Google Workspace Acceptable Use Policy](https://workspace.google.com/intl/en/terms/use_policy/)（Last modified: October 13, 2025）／[Google Cloud Acceptable Use Policy](https://cloud.google.com/terms/aup?hl=en)／[Google Workspace Marketplace Program Policies](https://developers.google.com/workspace/marketplace/terms/policies)（Last updated: August 28, 2025）
- Google Meet: [Tips to control meeting access and participation](https://support.google.com/a/users/answer/11989526?hl=en)（third-party bots, like note takers の自動拒否）／[External apps are recording Meet meetings](https://knowledge.workspace.google.com/admin/support/troubleshooting/external-apps-are-recording-meet-meetings)（Last updated 2026-08-26）／[Require explicit consent for Take Notes with Gemini, recordings, and transcripts in Google Meet](https://workspaceupdates.googleblog.com/2026/04/require-explicit-consent-for-take-notes-with-Gemini-recordings-and-transcripts-in-Google-Meet.html)
- Google: [Google Meet REST API release notes](https://developers.google.com/workspace/meet/release-notes)（Media API は 2025-02-24 に Developer Preview・GA 告知なし）
- 競合のプライバシーポリシー: [Notta](https://www.notta.ai/en/privacy)（Effective September 2, 2025）／[Notta Security](https://www.notta.ai/en/security)／[tl;dv](https://tldv.io/privacy/)（July 1st, 2026）／[Fireflies.ai](https://fireflies.ai/privacy-policy)（March 6, 2026）／[Otter.ai](https://otter.ai/privacy-policy)（June 16, 2026）

**一次情報 📗**（8月調査時）

- [Meet Media API overview](https://developers.google.com/workspace/meet/media-api/guides/overview)（Developer Preview・全参加者の登録要件）
- [Zoom Meeting SDK — UI Legal Notices](https://developers.zoom.us/docs/meeting-sdk/ui-notices/)（必須通知9種・AAN）
- [Zoom App Marketplace 各アプリ掲載ページ](https://marketplace.zoom.us/)（3.1 のリンク）
- [Google Workspace Marketplace 各アプリ掲載ページ](https://workspace.google.com/marketplace)（3.2 のリンク）
- [Fireflies: Google Meet SDK による bot-free 録音](https://guide.fireflies.ai/articles/3309351579-integrate-google-meet-sdk-with-fireflies-for-bot-free-meeting-recording)

**二次情報 📙**

- [Zoom: Headless Meeting Bot サンプルの使い方](https://developers.zoom.us/blog/meeting-sdk-headless-bot-usage/)（**2026-09-05 時点で 404**）
- [Zoom: Meeting SDK for Linux — raw data](https://developers.zoom.us/docs/meeting-sdk/linux/add-features/raw-data/)（**2026-09-05 時点で 404**）
- Zoom Developer Forum: [Submit app for bot automation and recording](https://devforum.zoom.us/t/submit-app-for-bot-automation-and-recording/93366)（2023-08・Zoom からのメール引用）／[Marketplace review eligibility for commercial AI facilitator bot using Linux Meeting SDK + OBF](https://devforum.zoom.us/t/marketplace-review-eligibility-for-commercial-ai-facilitator-bot-using-linux-meeting-sdk-obf/144959)（2026-07・Zoom スタッフ回答）／[RTMS と Basic ホスト](https://devforum.zoom.us/t/does-rtms-deliver-audio-transcript-when-the-meeting-host-is-on-a-basic-free-plan-and-does-it-work-for-hosts-on-the-zoom-web-client/144455)（2026-06・Zoom スタッフ回答）／[startRTMS と verified 要件](https://devforum.zoom.us/t/does-startrtms-require-the-meeting-host-to-have-a-paid-pro-licensed-zoom-plan/142303)（2026-03・Zoom スタッフ回答）／[RTMS credit consumption per minute](https://devforum.zoom.us/t/rtms-credit-consumption-per-minute-and-whether-the-initiating-participant-needs-a-paid-plan/145391)（2026-08・パートナー回答）
- Google Meet Community: [How to prevent custom Google Meet bot from being flagged as "Potential Risk"?](https://support.google.com/meet/thread/438497815)
- [Notta: Zoom Bot](https://www.notta.ai/en/zoom-bot)
- 日本語の比較記事（データ保存先・同意実務）
