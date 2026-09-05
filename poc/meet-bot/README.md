# Google Meet ヘッドレスブラウザ Bot の PoC（#478）

> 使い捨ての PoC。本番の Bot コンテナは新スタック（`docs/ai-bot/system-spec.md` の T-208「Meet: Bot コンテナ」）で別に作る。
> ここでは **「Bot が Meet に入って音声を保存し、#393 の文字起こしに渡す」** の前半を、Google の資格情報無しでも回る形で成立させる。
> 対になる Zoom 側は RTMS（#475・`poc/rtms`）。文字起こしは `poc/stt`（PR #474）。

## 目的

1. **仮説の検証**: キマルはホストの Google カレンダーに予定を作る側（`netlify/functions/_lib/google.js` の `createCalendarEvent` が `attendees` を付けている）なので、**Bot 用の Google アカウントを予定の参加者に加えられる**。招待済みの参加者なら「参加をリクエスト」を経ずに「今すぐ参加」で入室できるのではないか。成り立てばホストの毎回の許可操作が要らない
2. ヘッドレス Chromium の**中で**会議音声を取り出し、16 kHz モノラル WAV に **15 分ごと**に保存して manifest（seq・時刻・バイト数・SHA-256・`capture_generation`）を書く（本番設計 T-209 の形）
3. 終了検知（退出させられた／会議終了／全員退出／安全タイムアウト）で自力で退出する（T-211）
4. 閉じた WAV を `poc/stt/transcribe.py` に渡して文字起こしまで通す

## 方式の比較と選定（公開実装の調査・取得日 2026-09-05）

同じことをしているオープンソースの Meet Bot と、ベンダーの技術記事を読んで方式を選んだ。引用は原文のまま（一次情報だけ。取得できなかったものはその旨を書く）。

### 入室のしかた

| 実装 | 入室 | 待機室・拒否の扱い | 出典 |
|---|---|---|---|
| Vexa（`Vexa-ai/vexa`・Apache-2.0） | ゲスト名を入れて「Ask to join」。入室判定は `[data-participant-id]` の **DOM 存在**（“DOM PRESENCE (count>0), not visibility, is the reliable admitted signal”） | 拒否文言 “denied your request” “request to join was denied” “not allowed to join” など 7 種＋CAPTCHA 猶予 120 秒。製品ページ: “The meeting organizer invites the bot's email as a guest, or relaxes the join restriction.” | https://github.com/Vexa-ai/vexa/tree/main/core/meetings/modules/join/src/googlemeet ／ https://vexa.ai/product/google-meet-transcription-api |
| Attendee（`attendee-labs/attendee`・ELv2） | ゲスト既定。Google ログインは「ブロックされたときの再試行」用の任意機能（`--guest` 起動） | “Someone in the call denied your request to join” “No one responded to your request to join the call” → 拒否。“You can't join this video call” → “Google is blocking us for whatever reason, but we can retry.” | https://raw.githubusercontent.com/attendee-labs/attendee/main/bots/google_meet_bot_adapter/google_meet_ui_methods.py |
| Meeting BaaS（`Meeting-Baas/meet-teams-bot`・ELv2） | ゲスト名入力／Workspace の SAML ログイン。Meet の `CreateMeetingDevice` 応答から `detectedAsBot` を読む | 2026-08-17 のブログ: “In April 2026 Google Meet started sorting join requests into two queues. Invitees and org members go into a verified queue and get waved through. Everyone else lands in a second queue that hosts see labelled 'With potential threats', where the default button is Deny rather than Admit.” | https://www.meetingbaas.com/en/blog/authenticated-bots-google-meet |
| Recall.ai（docs） | **Google アカウントでログイン**し、**そのメールが予定の参加者に入っていれば待機室を飛ばせる**（“The bot must be signed in to a Google account” ／ “The email of the account the bot is signed into must be on the underlying calendar event.”）。“Service accounts will NOT work.” “If the account is a Google Workspace admin, the bot will not be able to sign in.” | 「Anyone with the meeting link can ask to join」が外れていると “all anonymous participants and participants not on the calendar invite” が自動拒否 | https://docs.recall.ai/docs/google-meet-login-getting-started ／ https://docs.recall.ai/docs/google-meet-faq ／ https://www.recall.ai/blog/how-i-built-an-in-house-google-meet-bot |

Google 自身の説明（Workspace Learning Center「Tips to control meeting access and participation」 https://support.google.com/a/users/answer/11989526?hl=en）:

> Trusted: “Anyone within the host's organization can join without knocking. Anyone outside the organization, but invited through a Google Calendar event, can join without knocking. Everybody else must knock.”
> Restricted: “Anyone invited through a Google Calendar event or from within the meeting by a host can join. Everyone else must knock.”
> “Anonymous users or third-party bots, like note takers, that attempt to use "Ask to join" are automatically denied access without actions required by the host.”

Meet ヘルプ「Join a video meeting」（https://support.google.com/meet/answer/9303069）:

> “If you're not on the calendar invite, you need to request to join and the meeting organizer or a participant must let you in.”

Workspace Updates（2026-02〜03・safeguarded guest admit flow・https://workspaceupdates.googleblog.com/2026/02/safeguarded-guest-admit-flow-in-google-meet.html）:

> “Meeting hosts will now get those requests presented in two separate queues. A new second queue now shows requests from connections where the host is more likely to need a closer look before deciding to approve them into the meeting. The default action for entries in this queue is to deny entry.”

（「Potential risk」という表示名は Google の一次情報では確認できなかった。ベンダー FAQ と Meeting BaaS のブログにだけ出てくる。）

**選定**: **ログイン済みプロファイル＋予定の参加者としての招待**を主経路にする。公開実装の既定（ゲスト名＋「Ask to join」）は、Google が「第三者 Bot は自動拒否」「既定は Deny」と明言している経路なので取らない。ゲスト入室は試験の腕として `--guest-name` で残す（比較対照）。

### 音声の取り出し

| 方式 | 使っている実装 | 長所 | 短所 |
|---|---|---|---|
| **A. ページ内: RTCPeerConnection の `track` イベント／`<audio>` 要素の `srcObject` → AudioContext → PCM** | Attendee（`RTCPeerConnection` フック → `MediaStreamTrackProcessor` → Float32 → WebSocket）、Vexa（`<audio>` 要素走査 → `AudioContext({sampleRate: 16000})` → AudioWorklet 4096 サンプル）、Meeting BaaS の配信経路（`RTCPeerConnection` フック → Web Audio → `page.exposeFunction`） | 音声デバイス不要（Fargate でも動く）。会議ごとに閉じているので Bot を複数同時に走らせても混ざらない。16 kHz へ直接落とせる | Meet の内部（トラックの扱い）に依存。ページの CSP や UI 変更で外れる可能性 |
| B. PulseAudio 仮想シンク＋ffmpeg（Xvfb で画面を出す） | Meeting BaaS の録画経路（`-f pulse -i <monitor>`）、Recall.ai の解説（“The browser's tab audio is routed to a virtual sink (e.g., PulseAudio or snd-aloop). ffmpeg taps that sink”） | ブラウザ内部に依存しない | この PC に PulseAudio も ffmpeg も無い（sudo 無し）。Bot ごとにシンクを分けないと混ざる（Recall.ai: “cross-session contamination”） |
| C. `getDisplayMedia({preferCurrentTab})`＋`MediaRecorder` | ScreenApp（`screenappai/meeting-bot`・MIT） | 実装が短い | 出力が webm/opus なので復号が要る（ffmpeg 無し）。タブ音声の許可ダイアログを `--auto-accept-this-tab-capture` で通す必要 |

出典: Vexa https://raw.githubusercontent.com/Vexa-ai/vexa/main/core/meetings/modules/gmeet-capture/src/gmeet-capture.ts （“Google Meet renders each participant's audio as a separate <audio>/<video> element whose srcObject is a live MediaStream.”）／ Attendee https://raw.githubusercontent.com/attendee-labs/attendee/main/bots/google_meet_bot_adapter/google_meet_chromedriver_payload.js ／ Recall.ai https://www.recall.ai/blog/how-to-get-transcripts-from-google-meet-developer-edition

**選定: A。** RTCPeerConnection の `track` と `<audio>/<video>.srcObject` の**両方**をフックし（片方が UI 変更で外れても残る）、`AudioContext({ sampleRate: 16000 })` で 1 本に合成 → **AudioWorklet**（音声スレッド。CSP で blob: が拒まれたら ScriptProcessor に落ちる）で Int16 PCM → base64 → `page.exposeBinding` で Node へ。トラックが無い間も 0 を書いて時間軸を進める（入室〜最初の声までを無音として残し、manifest の時刻連続性を保つ）。

### 終了の検知

| 実装 | 使っている手がかり |
|---|---|
| Attendee | `.roSPhc` 要素に “You've been removed” ／ “Your host ended”。単独参加・無音・稼働上限のタイムアウト |
| Vexa | “Meeting ended” “Call ended” “You left the meeting” “Connection lost” `[role="alert"]`。旧版は参加者リストの要素数 ≤1 が 10 秒 |
| Meeting BaaS | “You've been removed” “The call ended” “Return to home” “No one else” |
| ScreenApp | “You've been removed from the meeting”、`[data-avatar-count]` の人数、`AnalyserNode` の平均 <10 が続く無音 |

**選定**: 文言（日英を 1 つの正規表現で）＋ `[data-participant-id]` の一意数（本番設計 FR-2.7「参加者 0 人が 5〜10 分で退出」）＋参加者数が読めないときだけ無音を保険にする＋安全タイムアウト（上限 4 時間・env で延ばせない）。すべて `src/selectors.ts` に集め、`src/end-detect.ts` を DOM 非依存の状態機械にして `node:test` で固定した。

### この PoC が「しないこと」（規約上の線引き）

`docs/ai-bot/platform-research.md` 7.3〜7.4 の判定に従う。

- **Google アカウントの自動ログインはしない。** `login` は人が入力するための Chromium を開くだけで、ID・パスワードを扱うコードは存在しない。ログイン画面に飛ばされたら `not_logged_in` で止まる
- **Bot 検知の回避はしない。** 調べた公開実装の多くは `--disable-blink-features=AutomationControlled`（Vexa・Attendee・Meeting BaaS）や playwright-extra の Stealth（旧 Vexa）、CloakBrowser（Meeting BaaS）を使っているが、この PoC は入れない。`navigator.webdriver` は `true` のまま。Meet が拒否したら `denied` として**記録する**のが試験の目的
- 表示名は Google アカウントの名前がそのまま参加者一覧に出る。**「キマル 議事録（録音中）」のように録音中と分かる名前にする**（FR-2.4・同意設計 #371/#372）
- ホストが「参加をリクエスト」を手で許可する運用も想定する（招待でも直接入室できなかった場合の代替）。ホストが「参加をリクエストできるユーザー」を無効にしていると自動拒否されることを、ユーザー向けの案内に書く

## 構成

```
poc/meet-bot/
  src/cli.ts                 入口（login / status / join / selftest / fake-meet）
  src/config.ts              env の読み取り（.env 対応・安全タイムアウト上限 4 時間）
  src/join.ts                Bot 本体: 起動 → 入室前 → (待機室) → 会議中 → 退出。events.jsonl / result.json / shots/
  src/selectors.ts           Meet の UI 文言・aria-label をここに集約（壊れやすい理由をコメントに）
  src/audio-capture.ts       Node 側の受け口（exposeBinding・リサンプラ・音の有無）
  src/audio-capture.page.js  ブラウザに注入する側（RTCPeerConnection / srcObject フック → AudioContext → AudioWorklet）
  src/wav-writer.ts          16 kHz mono s16le WAV を 15 分で分割・manifest.json
  src/end-detect.ts          終了検知の状態機械（純ロジック）
  src/transcribe-handoff.ts  閉じたチャンクを poc/stt/transcribe.py に直列で渡す
  src/resample.ts            AudioContext が 16 kHz で作れなかったときの保険
  src/pcm-analysis.ts        RMS・Goertzel（試験用）
  src/selftest.ts            擬似ページで録音の自己診断
  test/fake-meet/            Google 無しで全経路を通す擬似 Meet ページと HTTP サーバ、ブラウザ試験
  src/*.test.ts              分割・終了検知・リサンプラの単体試験
```

依存はリポジトリ直下の `node_modules`（playwright・tsx・typescript）をそのまま使う。**このディレクトリで `npm install` は不要。**

## ユーザーが行う準備（実機での確認のため）

### 1. Bot 用の Google アカウントを作る

- **通常の個人 Google アカウント**を新規に作る。キマルの運営用でも顧客用でもないもの
- **名前（表示名）は「キマル 議事録（録音中）」**にする。参加者一覧にこの名前が出る。姓・名の欄がある場合は 姓「キマル」名「議事録（録音中）」など、並べたときにこの通りに見える組み合わせにする
- Workspace の管理者アカウントにしない（Recall.ai の注記: “If the account is a Google Workspace admin, the bot will not be able to sign in.”）。サービスアカウントは使えない（同 “Service accounts will NOT work.”）
- 2 段階認証を有効にするかは運用判断。有効でもプロファイルの Cookie で続くが、Google が再確認を求めたときは人が `login` をやり直す

### 2. 初回だけ人がログインしてプロファイルを作る

```bash
cd poc/meet-bot
cp .env.example .env          # 必要なら MEET_PROFILE_DIR などを変える
npx tsx src/cli.ts login      # 画面付きの Chromium が開く
```

- 開いた Chromium で **Bot 用アカウントで手動ログイン**し、Meet のトップ（「新しい会議」が見える画面）が出たら**ウィンドウを閉じる**。これで `MEET_PROFILE_DIR`（既定 `./profile`）に Cookie が残る
- **このプロファイルには Bot 用アカウントだけ**を入れる（複数アカウントが入っていると Meet が別のアカウントで開くことがある）
- WSL2 では WSLg が `DISPLAY=:0` を用意するので、そのまま画面が出る。出ない場合は `echo $DISPLAY` と `ls /mnt/wslg` を確認する。Windows 側の X サーバは不要
- 確認: `npx tsx src/cli.ts status` → `signed_in: true`（Meet トップの「新しい会議」またはアカウントボタンが見えるか、という目安）
- `profile/` は `.gitignore` 済み。**Google の Cookie が入るので絶対に commit・共有しない**

### 3. テスト用の予定を作る（運営のアカウント同士。顧客の会議では試さない）

ホスト役は運営の Google アカウント A。ゲスト役（相手）は運営のもう 1 つのアカウント B（無ければ A だけでもよい）。

1. A の Google カレンダーで予定を作り「Google Meet のビデオ会議を追加」。**参加者に Bot 用アカウントのメールを追加**して保存（招待メールが Bot アカウントに届く。承諾しなくてよい）— これが **腕①（招待あり）**
2. 同じ手順で、**Bot を招待しない**予定をもう 1 つ作る — **腕②（招待なし）**
3. A で Meet を開き（会議を始めておく）、Bot を起動する:

```bash
# 腕①（招待あり）
npx tsx src/cli.ts join --invited   --url https://meet.google.com/xxx-yyyy-zzz
# 腕②（招待なし・同じ Bot アカウントでログイン済み）
npx tsx src/cli.ts join --uninvited --url https://meet.google.com/aaa-bbbb-ccc
# 参考: 腕③（未ログインのプロファイルで名前を入れて入る＝公開実装の既定）
MEET_PROFILE_DIR=./profile-guest npx tsx src/cli.ts join --guest-name "キマル 議事録（録音中）" --url https://meet.google.com/aaa-bbbb-ccc
```

4. ホスト（A）の画面で、参加リクエストのダイアログが出るか・どの列（通常／注意が必要）に出るか・参加者一覧の Bot の表示名を見て記録する
5. B が数十秒しゃべってから退出し、Bot が自分で退出するか（`everyone_left`）を見る。別の回では A が Bot を「削除」して `removed` になるか、A が「全員の通話を終了」して `meeting_ended` になるかを見る

**入室前の条件も記録する**: ホスト A が個人アカウントか Workspace か、Meet の「ホスト管理」の ON/OFF、「参加をリクエストできるユーザー」の設定（Workspace のアクセス種別 Open/Trusted/Restricted）。Google の説明では Trusted/Restricted のどちらでも「予定に招待された人はノックなしで入れる」。

### 4. 試験プロトコル（招待あり／なしの比較）と記録表の雛形

各腕を最低 2 回。1 回目は Bot だけ、2 回目は B も入れる。結果は `out/<日時>-<会議コード>/result.json`（`join_button_seen`・`waiting_room_seconds`・`transitions`・`end_reason`）と `events.jsonl`（`page_text` に Meet の文言が残る）、`shots/*.png`（各状態遷移時の画面）から転記する。

| # | 日時 | ホスト種別 | ホスト管理 | アクセス設定 | Bot 招待 | ログイン | 出たボタン（join_now / ask_to_join） | 待機秒 | ホスト側に出た表示（許可ダイアログ・列・警告） | 結果（in_meeting / denied / timeout） | 参加者一覧の Bot 表示名 | 音声 bytes / 秒 | 文字起こし | 退出理由 | メモ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | 個人 | — | 既定 | あり | あり | | | | | | | | | |
| 2 | | 個人 | — | 既定 | なし | あり | | | | | | | | | |
| 3 | | 個人 | — | 既定 | なし | なし（guest） | | | | | | | | | |
| 4 | | Workspace | OFF | Trusted | あり | あり | | | | | | | | | |
| 5 | | Workspace | ON | Restricted | あり | あり | | | | | | | | | |
| 6 | | Workspace | ON | Restricted | なし | あり | | | | | | | | | |

**仮説が成り立つ条件**: 行 1・4・5 で `join_button_seen = join_now` かつホスト側に許可ダイアログが出ない。行 2・6 は `ask_to_join` → ホストが許可すれば入れる（許可しないと `denied` か待機室タイムアウト）。行 3 は Google の説明どおりなら自動拒否（`denied`）。

## 起動方法とオプション

```bash
cd poc/meet-bot
npx tsx src/cli.ts join --url <meet-url> [--invited|--uninvited] [--guest-name 名] [--out dir] [--headed] [--max-seconds n] [--chunk-seconds n] [--no-stt]
```

- `--invited` / `--uninvited` は**記録用のラベル**（結果に `mode` として残る）。Bot の動きは変えない
- `--guest-name` を付けたときだけ名前欄に入力する（未ログインのプロファイル向け）。付けずに名前欄が出たら `not_logged_in` で止まる
- `--headed` で画面を出す（挙動を目で見たいとき）。`--max-seconds` は 14400（4 時間）を超えて指定しても 14400 に丸める
- 設定は `.env`（`.env.example` を参照）。`MEET_FAKE_DEVICES=1` で Chromium に「無音のマイク」を持たせる（Meet が「マイクが見つかりません」で参加ボタンを出さないときの予備。Chromium 既定のフェイク音源はビープ音なので、必ず無音 WAV を渡す実装になっている）
- Chromium は Playwright 同梱の `chromium`（新ヘッドレス。`login` で使う画面付きと同じ実体なので、プロファイルをそのまま使える）。渡すフラグは `--autoplay-policy=no-user-gesture-required` だけ（AudioContext をユーザー操作なしで走らせる）。検知回避系のフラグは渡さない

状態遷移: `launching → joining → (waiting_room →) in_meeting → leaving → left`。途中終了は `denied` / `removed` / `meeting_ended` / `timeout` / `not_logged_in` / `error`。終了理由（`end_reason`）: `everyone_left`（参加者が Bot だけになって `MEET_ALONE_SECONDS`）、`removed`、`meeting_ended`、`max_seconds`、`inactivity`（参加者数が読めず無音が続いた）、`signal_lost`（退出ボタンが 30 秒以上見つからない）、`interrupted`（Ctrl+C）。

## 保存形式

```
out/20260905-113000-abc-defg-hij/
  manifest.json      台帳（下記）
  0000.wav 0001.wav  16 kHz / mono / s16le。15 分（MEET_CHUNK_SECONDS）ごと。書きかけは .part
  0000.txt 0000.segments.json   文字起こし（STT_PYTHON があるとき）
  events.jsonl       1 行 1 イベント（状態遷移・クリック・音声トラックの増減・heartbeat・Meet の文言）
  result.json        要約（mode / join_button_seen / waiting_room_seconds / transitions / end_reason / audio / manifest）
  shots/NN-<state>.png  各状態遷移時の画面
```

`manifest.json`（本番設計 T-209・spec 2.3.4 に合わせた形）:

```json
{
  "version": 1,
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "meeting_code": "abc-defg-hij",
  "capture_generation": 0,
  "created_at": "…", "ended_at": "…", "status": "closed", "end_reason": "everyone_left",
  "format": { "container": "wav", "codec": "pcm_s16le", "sample_rate": 16000, "channels": 1, "bits_per_sample": 16 },
  "chunk_seconds": 900,
  "expected_chunks": 3,
  "total_seconds": 2103.4,
  "chunks": [
    { "seq": 0, "file": "0000.wav", "started_at": "…", "ended_at": "…", "pcm_bytes": 28800000, "file_bytes": 28800044,
      "duration_seconds": 900, "sha256": "…", "transcript": { "status": "done", "text_file": "0000.txt", "segments_file": "0000.segments.json", "seconds": 190.2, "finished_at": "…" } }
  ]
}
```

- `seq` は **0 始まり**（spec 2.3.4 ①「seq が 0..expected-1」。`poc/rtms` は 1 始まりなので、統合時にどちらかに揃える）
- `sha256`・`file_bytes` は Bot の**申告**。本番ではサーバが S3 のオブジェクトで再計算して照合する（欠番・サイズ不一致・ハッシュ不一致・時刻の不連続なら `incomplete` にして音声を消さない）。ここで正しく計算できることは試験で固定してある
- `capture_generation` は再入室のたびに +1 する録音世代（FR-2.8）。この PoC は再入室を実装していないので常に 0
- `.part` が残っていたら、そのチャンクは途中で落ちたもの。manifest の `sha256: null` と対応する

## 文字起こしへの受け渡し

`.env` に `STT_PYTHON`（`poc/stt` の venv の python）を書くと、閉じたチャンクごとに

```
<STT_PYTHON> <STT_SCRIPT> <chunk.wav> --out-dir <会議ディレクトリ> <STT_ARGS>
```

を**直列**に起動し（faster-whisper small はピーク 1.3 GB なので並列にしない）、結果を manifest の `chunks[].transcript` に書く。`STT_PYTHON` が無いか `transcribe.py` が見つからなければ `status: "skipped"` にして録音だけ続ける。

**いつ回すか（`STT_WHEN`）**: 既定 `after` ＝ 退出してブラウザを閉じてから、閉じた順に回す。`during` ＝ チャンクが閉じるたび会議中に回す（本番の「15 分ごとに文字起こしを始める」に近い）。手元で `during` にしたところ faster-whisper が CPU を取って録音側の音声が途切れた（下の確認結果 3）ので、同じ機械で回すなら `after` にする。

`poc/stt` は別ブランチ（PR #474）なので、同じ木に無いときは `STT_SCRIPT` にそのブランチの worktree のパスを書く。文字起こしの中身の見方・完了判定（`check_complete.py`）は `poc/stt/README.md`。会議全体の完了判定は、チャンクの `segments.json` の時刻に各チャンクの開始オフセットを足して結合した 1 本に対して掛ける（`poc/stt/README.md`「残る課題と次の一手」5）。

## オフラインでの確認（Google 無し）

```bash
cd poc/meet-bot
npm test                      # 単体（分割・終了検知・リサンプラ）＋ 擬似 Meet でのブラウザ試験（Chromium は同時に 1 つ）
npm run typecheck
npx tsx src/cli.ts selftest --seconds 5 --late 2000   # 440 Hz を流して WAV の RMS と 440/660 Hz 成分を数える
```

`test/fake-meet/index.html` は Meet の「ふり」をする静的ページ。Bot が頼る手がかり（「今すぐ参加」「参加をリクエスト」「マイクをオフにする」の aria-label と `data-is-muted`、`[data-participant-id]` のタイル、「通話から退出」ボタン、「通話から削除されました」等の文言）だけを Meet と同じ形で出し、音声は **RTCPeerConnection のループバック**（pc1 → pc2）で「遠隔の参加者の声」として届ける。クエリで正弦波／WAV 再生・途中参加（トラック追加＋再交渉）・削除／終了／全員退出／拒否を切り替える。

## オフラインでの確認結果（2026-09-05・この PC）

環境: WSL2・8 コア・7.7 GB（他の作業と同居）・GPU 無し・Node 24・Playwright 1.62.1 同梱の Chromium（channel `chromium`・新ヘッドレス）。

### 1. `npm test`: 25 件すべて合格（単体 20・ブラウザ 5・約 40 秒）

| 対象 | 固定していること |
|---|---|
| `wav-writer` | 5.1 秒の PCM を 0.3 秒刻みで書くと 2 秒チャンク × 2 ＋ 1.1 秒に割れる。各ファイルのヘッダ（16000 Hz / mono / 16 bit）・`pcm_bytes`・`file_bytes`（= 44 + pcm）・`sha256`（再計算と一致）・`.part` が残らない・chunk n の `ended_at` = chunk n+1 の `started_at`。奇数バイトは捨てる。0 本で閉じられる。`setTranscript` が manifest に載る |
| `end-detect` | 削除・終了・拒否の文言（日英 8 例）で即退出。1 人以下が 300 秒で `everyone_left`、途中で戻ればリセット。参加者数が読めない＋無音 1200 秒で `inactivity`、読めていれば無音でも退出しない。安全タイムアウト。`classifyText` の待機・無効 URL・未ログイン |
| `resample` | 48 kHz → 16 kHz で長さ 1/3・440 Hz 保持・分割境界でクリック無し |
| `transcribe-handoff` | 未設定なら `skipped`。直列に回って `done` と `text_file`。`deferUntilDrain` は `drain()` まで走らない。失敗は `failed` と終了コード |
| 擬似 Meet（ブラウザ） | ① 440 Hz ループバックが 16 kHz WAV に 2 秒ごとに割れ、2.5 秒後に足した 660 Hz トラックも混ざる（`tracks_seen` 2・`mode` worklet）② 「今すぐ参加」→ マイク／カメラ off → 録音 → 相手退出 → `everyone_left` → manifest / result.json / events.jsonl ③ 「通話から削除されました」で `removed` ④ 「参加をリクエスト」→ 待機室 → 承認 → `waiting_room` を経て入室 ⑤ 「参加をリクエスト」→ 拒否で `denied`・録音 0 byte |

### 2. `selftest`（440 Hz・振幅 0.5・5 秒）

- `mode: worklet`（AudioWorklet が blob: で読めた）・`ctx_sample_rate: 16000`（Node 側のリサンプラは不要）
- 5 秒の待機で **4.86 秒**ぶんの PCM が届いた（起動〜最初のフレームまで 0.1 秒程度の遅れ）。2 秒チャンク 2 本＋0.86 秒
- RMS **11297〜11608**（理論値 0.5 × 32767 / √2 = 11585）、440 Hz 成分 **0.496**（理論値 0.5。先頭チャンクは無音を含むので 0.351）
- `--late 2000` で 2 本目のトラック（660 Hz）を再交渉で足すと `tracks_seen: 2`、2 本目のチャンクで 440 Hz 0.382 ／ 660 Hz 0.494 → **途中参加のトラックが合成される**

### 3. 会議音声を流して文字起こしまで通す（擬似 Meet に `poc/stt` の TTS サンプル 55.8 秒をループ再生）

設定: `MEET_CHUNK_SECONDS=30`・`MEET_ALONE_SECONDS=3`・`end=alone&after=62000`・`STT_ARGS=--model small --threads 4`・`STT_WHEN=after`。

- 遷移: `launching` 11:48:34 → `joining` :35 → `in_meeting` :36（`join_button_seen: join_now`・直接入室）→ `leaving` 11:49:46（`everyone_left`）→ `meeting_ended` 11:50:18（文字起こし完了後）
- 在室 **70.3 秒**、PCM **2,244,608 bytes（= 70.14 秒）**、受け渡し 274 回（256 ms ごと）
- チャンク: `0000.wav` 960,044 B / 30.000 s（RMS 3149）、`0001.wav` 960,044 B / 30.000 s（RMS 3147）、`0002.wav` 324,652 B / 10.144 s（RMS 2820）。1 秒ごとの RMS はサンプル自身の無音（発話間・ループ点）以外に途切れなし
- 文字起こし（退出後に直列・small/int8）: 9.1 秒 ／ 14.9 秒 ／ 7.1 秒（モデル読込込み）。本文は期待テキストとほぼ一致——「本日はお時間をいただき、ありがとうございます。キマルの砂糖です。…予約ページの公開な10月15日にずれ込んでいましたね。」「…渋谷のイベント会場はもう抑えてあります。…来週の火曜日、午後3時からでいかがでしょうか。火曜日で大丈夫です。議事録は後ほどメールでお送りします。」誤りは 佐藤→砂糖・今日は→きょうんは・押さえて→抑えて・公開が→公開な（PR #474 の計測と同じ傾向）。固有名詞 キマル・高橋・渋谷・10月15日・火曜日・午後3時 は正しい
- **見つかったこと**: 同じ設定で `STT_WHEN=during`（会議中に文字起こし）にした 1 回目は、**47 秒目から音声が無音になった**（`0001.wav` の 17 秒目以降 RMS 0、`0002.wav` は全部 0。トラックの `ended` も `ctx_state` の変化も無し）。faster-whisper（4 スレッド）が回っていた区間と一致し、`after` にした 2 回目と、STT 無しで 75 秒流した `selftest --wav` は途切れなかった。擬似ページ側（送信側）の WebRTC が CPU を取られて止まり復帰しなかったと見ている。本番では STT は別タスクなので直接は起きないが、**Bot コンテナの CPU を絞りすぎると受信側でも同じことが起きうる**ので、Bot タスクの CPU 割り当ては負荷をかけた状態で決める（T-208 の「入室成功率」に「録音の連続性」を足す）

### 4. この結果からの判断

- 取り込みは **方式 A（ページ内フック → AudioContext 16 kHz → AudioWorklet）で進める**。音声デバイスも ffmpeg も要らず、16 kHz mono を直接吐き、Bot ごとに閉じている。本番の Fargate（GPU 無し・デバイス無し）にそのまま持ち上げられる。Meet の CSP が blob: の worklet を拒んだ場合は ScriptProcessor に自動で落ちる（`result.json` の `audio.mode` で分かる）
- 15 分分割・manifest・終了検知は入力元に依らないので、`poc/rtms` と同じ形（`SegmentSink` 相当）に寄せて本番の共通部にする
- 実機で最初に見るのは **`join_button_seen`**（招待済みで `join_now` か）と **参加者一覧の表示名**、そして **`audio.tracks_seen` と `audio.mode`**（Meet の受信トラックが両フックのどちらで捕まるか）。ここが通れば残りはオフラインで固定済みの部分

## 残る課題

1. **実機（本物の Meet）での確認**が残っている。上の記録表を埋める。特に「招待済みで `join_now` が出るか」「参加者一覧の表示名」「ホスト側に警告が出るか」。文言・選択子が外れていたら `events.jsonl` の `page_text` と `shots/` を見て `src/selectors.ts` に足す
2. **Google の UI 変更への追従**。手がかりは role / aria-label / 文言だけなので、Meet の更新で黙って壊れうる。本番では入室成功率と `signal_lost` の比率を監視項目にし、選択子を 1 ファイルに閉じ込めておく（今の形）。Meet Media API（Developer Preview）が GA になれば、そちらへ乗り換える選択肢を残す（`platform-research.md` 7.7）
3. **話者分離**。1 本に合成しているので誰の声かは残らない。Vexa はトラックごとに分けて「発話中」の光る名前（`data-participant-id` の class）で話者を当てている。Attendee はトラック単位で送っている。同じ方式で**トラック別 WAV** を追加で書けば T-305 の材料になるが、Meet はトラックを参加者に固定しないことがある（要確認）
4. **再入室**（FR-2.8・`capture_generation` +1）と、ネットワーク断・ページクラッシュ時の復帰は未実装。今は `page_closed` / `page_crashed` で退出処理に入るだけ
5. **Bot の同時実行**。ページ内方式なので音声は混ざらないが、1 プロファイル＝1 アカウントを同時に複数の Meet に入れられるか（Google 側の制限）は未確認。本番は会議ごとにコンテナ＋プロファイルのコピー、または Bot アカウントを複数持つ
6. **ログインの維持**。プロファイルの Cookie がいつ切れるか（Google の再認証要求）は運用で観測する。切れたら人が `login` をやり直す前提。無人化はしない（自動ログインは規約上やらない）
7. **AWS 化**（Fargate タスク化・S3 へのチャンクアップロード・状態更新 API・リース）は `system-spec.md` の 2.3。この PoC の `WavChunkWriter.onChunkClosed` がアップロードの差し込み口
8. **Zoom 側（RTMS・#475）**は Bot が入室しないので、この Bot の入室部分は Meet 専用。共通部分は「音声セグメントの流れ」（15 分分割・manifest・終了処理）で、`poc/rtms/src/wav-chunk-writer.ts` と `src/wav-writer.ts` は同じ形を目指している（seq の起点だけ違う）
9. マイク・カメラが無い端末での Meet の挙動（「マイクが見つかりません」の扱い）は実機で確認。ダメなら `MEET_FAKE_DEVICES=1`

## 参照した一次情報（取得日 2026-09-05）

- Google: https://support.google.com/a/users/answer/11989526?hl=en ／ https://support.google.com/meet/answer/9303069 ／ https://support.google.com/meet/answer/9303164 ／ https://support.google.com/meet/answer/16229038 ／ https://workspaceupdates.googleblog.com/2026/02/safeguarded-guest-admit-flow-in-google-meet.html ／ https://policies.google.com/terms?hl=en
- Vexa: https://github.com/Vexa-ai/vexa （core/meetings/modules/join・gmeet-capture）／ 旧 https://github.com/Vexa-ai/vexa-bot ／ https://vexa.ai/product/google-meet-transcription-api
- Attendee: https://github.com/attendee-labs/attendee （bots/google_meet_bot_adapter・bots/web_bot_adapter）
- Meeting BaaS: https://github.com/Meeting-Baas/meet-teams-bot ／ https://www.meetingbaas.com/en/blog/authenticated-bots-google-meet
- ScreenApp: https://github.com/screenappai/meeting-bot
- Recall.ai: https://docs.recall.ai/docs/google-meet-login-getting-started ／ https://docs.recall.ai/docs/google-meet-faq ／ https://www.recall.ai/blog/how-i-built-an-in-house-google-meet-bot ／ https://www.recall.ai/blog/how-to-get-transcripts-from-google-meet-developer-edition ／ https://github.com/recallai/google-meet-meeting-bot
- 社内: `docs/ai-bot/platform-research.md` 7.3〜7.4（規約）、`docs/ai-bot/system-spec.md` FR-2・2.3.4・T-208〜T-211、`poc/stt/README.md`（PR #474）、`poc/rtms/README.md`（#475）
