# Zoom RTMS 受信 PoC（#475）— webhook → メディア接続 → 音声保存 → 文字起こし

> 使い捨ての PoC。本番の受信サービスは新スタック（`docs/ai-bot/system-spec.md`・AWS 基盤 #382）で別に作る。
> ここでは **「ホストの Zoom 会議の音声が、Bot を入室させずにキマル側へ届き、保存され、文字起こしまで通る」** ことを手元で確かめる。

## 目的と結論

- Zoom の現行ドキュメントは「Meeting SDK は人の利用向けで Bot・AI 議事録は非対応。AI 議事録は **RTMS（Realtime Media Streams）** を使う」と明記している（#370・PR #473 の 7 章）。**ユーザー決定（2026-09-05）: Zoom は RTMS で進める。**
- この PoC は、RTMS の公式仕様どおりに **webhook（`meeting.rtms_started`）→ シグナリング WebSocket → メディア WebSocket** をたどって音声（16 kHz mono 16-bit PCM）を受け取り、**15 分ごとの WAV ＋ `manifest.json`（連番・時刻・SHA-256）** に保存し、閉じたチャンクを **#393 の `poc/stt/transcribe.py`（PR #474）** に順に渡す。
- **公式 SDK（`@zoom/rtms` 1.1.0）は使わず、`ws` で素の WebSocket を実装した。** 理由は「判断」節。
- Zoom の資格情報・クレジットが無くても動く **オフライン再生（`scripts/fake-zoom.ts`）** と **単体テスト 44 件** で、配管が端から端まで通ることを確かめた。**実会議での確認は、下の「ユーザーが行う設定」を済ませてから。**

## RTMS の仕組み（文字で）

```
 Zoom クライアント（ホスト）                     キマル側（この PoC）
 ┌──────────────────────────┐
 │ 会議開始 / アプリ自動起動   │  ① POST /webhook  meeting.rtms_started
 │ 「会議の内容をアプリと共有」 │ ───────────────────────────────▶ server.ts
 └──────────────────────────┘      { meeting_uuid, rtms_stream_id,      │ x-zm-signature を検証
                                     server_urls (wss://…) }            │ セッション開始
 Zoom RTMS                                                              ▼
 ┌────────────────────┐  ② wss 接続 + SIGNALING_HAND_SHAKE_REQ(1)   rtms-session.ts
 │ シグナリングサーバー  │ ◀──────────────────────────────────────────
 │                    │    署名 = HMAC-SHA256(client_secret,
 │                    │           "client_id,meeting_uuid,rtms_stream_id")
 │                    │  ③ SIGNALING_HAND_SHAKE_RESP(2) status 0
 │                    │ ──────────────────────────────────────────▶  media_server.server_urls.{audio,all}
 │                    │  ⑤ CLIENT_READY_ACK(7)  ◀────────────────────
 │                    │  ⇄ KEEP_ALIVE_REQ(12) / RESP(13)  10 秒ごと
 │                    │  ⑧ STREAM_STATE_UPDATE(8) TERMINATED
 └────────────────────┘
 ┌────────────────────┐  ④ wss 接続 + DATA_HAND_SHAKE_REQ(3)
 │ メディアサーバー     │ ◀──────────────────────────────────────────  media_type 1（音声）
 │                    │    DATA_HAND_SHAKE_RESP(4) status 0          audio: 16k / mono / L16 / mixed / 100ms
 │                    │  ⑥ MEDIA_DATA_AUDIO(14) × 10 回/秒
 │                    │ ──────────────────────────────────────────▶  base64 → PCM 3200 byte
 │                    │  ⇄ KEEP_ALIVE                                      │
 └────────────────────┘                                                    ▼
                                                                  wav-chunk-writer.ts
                                                                  out/<会議>/0001.wav, 0002.wav …（15 分ごと）
                                                                  out/<会議>/manifest.json（seq・時刻・bytes・sha256）
                                                                          │ チャンクが閉じるたび
                                                                          ▼
                                                                  transcribe-handoff.ts
                                                                  python poc/stt/transcribe.py 0001.wav --json-summary
                                                                  → 0001.txt / 0001.segments.json、manifest に結果
 ⑦ POST /webhook meeting.rtms_stopped ──▶ セッション終了（既に ⑧ で終わっていれば無視）
```

- Bot は参加者一覧に出ない。Zoom クライアントが「このアプリが会議の内容にアクセスしている」と全員に表示する（Zoom 側の開示。#370 7.2）。
- 音声はホストの Zoom クライアントではなく **Zoom のサーバーから** WebSocket で届く。キマル側は **公開 URL で webhook を受けられれば**よく、会議に「入る」必要がない。

## 調査結果（一次情報・取得日 2026-09-05）

| 項目 | 内容 | 出典 |
|---|---|---|
| アプリの種類 | **General App（User-managed）**。「RTMS apps must be user-managed apps to add the RTMS events and scopes.」新規に作るか既存に足す。**RTMS の機能トグルは無く、「イベント購読」＋「スコープ」を足すことが RTMS の有効化** | [Add RTMS to your app](https://developers.zoom.us/docs/rtms/meetings/add-features/) |
| 前提 | 「Any developer with Zoom Developer Pack credits on their account can use RTMS.」 | 同上 |
| webhook | Access → **Event Subscription** を ON → Add Events で「RTMS」を検索 → **RTMS Started / RTMS Stopped** が必須（全部購読を推奨）。イベント名 `meeting.rtms_started` / `meeting.rtms_stopped`（他に `meeting.rtms_interrupted`、`rtms.concurrency_limited` 等） | 同上・[Webhook reference](https://developers.zoom.us/docs/api/rtms/events/) |
| スコープ | Scopes → Add Scopes で「RTMS」を検索。音声だけなら **`meeting:read:meeting_audio` だけ**を選ぶ（「RTMS scopes are unable to be marked as optional」）。文字起こしも欲しければ `meeting:read:meeting_transcript`。**Granular scopes が前提**（新規アプリは既定） | 同上 |
| webhook の検証 | URL 検証: `endpoint.url_validation` の `plainToken` を Secret Token で HMAC-SHA256（hex）→ `{plainToken, encryptedToken}` を **3 秒以内に 200**。署名: `v0:<x-zm-request-timestamp>:<body>` の HMAC-SHA256（hex）に `v0=` を付けて `x-zm-signature` と比較。timestamp は秒・許容 300 秒（Zoom の公式サンプルに合わせた） | [Webhooks](https://developers.zoom.us/docs/api/webhooks/)・[rtms-samples zoomWebhookSignature.js](https://github.com/zoom/rtms-samples) |
| ハンドシェイク | シグナリング `server_urls` へ WS 接続 → `{msg_type:1, protocol_version:1, sequence:1, meeting_uuid, rtms_stream_id, signature, buffer_data}` → 応答 `msg_type:2` の `media_server.server_urls.{audio,video,transcript,all}` → メディアへ `{msg_type:3, …, media_type, media_params}` → `msg_type:4` → シグナリングへ `{msg_type:7, rtms_stream_id}` → `msg_type:14` で音声。keep-alive は両接続に 10 秒ごと、3 回無応答で切断、65 秒来なければ再ハンドシェイク推奨。**署名 = HMAC-SHA256(key=client_secret, `${client_id},${meeting_uuid},${rtms_stream_id}`) hex** | [Event reference](https://developers.zoom.us/docs/rtms/event-reference/)・[RTMS_CONNECTION_FLOW.md](https://github.com/zoom/rtms-samples/blob/main/RTMS_CONNECTION_FLOW.md)・[@zoom/rtms index.ts](https://github.com/zoom/rtms) |
| 音声の形式 | `content_type` 2=RAW_AUDIO、`sample_rate` 0=8k/**1=16k**/2=32k/3=48k、`channel` 1=mono/2=stereo、`codec` 1=**L16**/2=G711/3=G722/4=Opus、`data_opt` **1=AUDIO_MIXED_STREAM（全員ミックス）**/2=AUDIO_MULTI_STREAMS（参加者別・`user_id` 付き）、`send_rate` 20 の倍数で最大 1000 ms。SDK の既定は 48k ステレオ MULTI | [Data types](https://developers.zoom.us/docs/rtms/data-types/) |
| ホスト側の設定 | Web ポータル **Account Management → Account Settings → Zoom Apps タブ → 「Share realtime meeting content with apps」を ON**（アカウント／グループ／ユーザー単位）。同じ場所の **「Auto-start apps that access shared realtime meeting content」** にアプリを追加すると会議参加時に自動開始。会議中はホストの **Host tools** から ON/OFF | [Host and admin controls](https://developers.zoom.us/docs/rtms/meetings/ux-host-admin-tools-ctrls/) |
| 未公開アプリで自分のアカウントを試せるか | **できる。** quickstart は Local Test → **Add app now → Allow** で自分のアカウントに入れ、自分の設定の Zoom Apps タブで自動開始に登録して会議を開く手順。App Review は「自アカウント外へ配るとき」に必須 | [Quickstart（WebSockets）](https://developers.zoom.us/docs/rtms/meetings/quickstart-websockets/)・[Submit for review](https://developers.zoom.us/docs/rtms/meetings/submit-app-review/) |
| クレジット | 「To use RTMS, you'll need Zoom Developer Pack credits on your account. For volume discounts or commitments above 500 credits, contact sales.」**2026-06-30 以降はセルフサービス購入あり**（Zoom スタッフ Jen Brissman の告知: 「You can now purchase Realtime Media Streams through self-service options found here: https://zoom.us/pricing/developer」、プランは **Pay as You Go／100 クレジット／500 クレジット**）。単価は Zoom スタッフ chunsiong.zoom（2026-06-15）「RTMS without Transcriptions **$0.01/Meeting Streaming Minute**」、パートナー回答（Recall.ai・2026-08-10）「0.01 credit per minute without transcription and 0.02 per minute when transcription is enabled」→ **1 クレジット ≈ $1、音声のみ 1 分 0.01 クレジット（1 時間 ≈ $0.6）**。価格ページ自体は JS 描画で機械取得できず、**数字は掲示板の回答が根拠**（購入画面で要確認） | [Getting started](https://developers.zoom.us/docs/rtms/meetings/getting-started/)・[RTMS Self-Service Purchasing is Now Available](https://devforum.zoom.us/t/rtms-self-service-purchasing-is-now-available/144524)・[Developer Pack pricing](https://devforum.zoom.us/t/rtms-developer-pack-pricing-for-business-account/144203)・[credit consumption](https://devforum.zoom.us/t/rtms-credit-consumption-per-minute-and-whether-the-initiating-participant-needs-a-paid-plan/145391) |
| ホストの条件 | 開始する参加者（ホスト）は **無料（Basic）でよいがアカウントが verified である必要**（Zoom スタッフ回答。#370 7.2 と同じ） | 同上 |

### 判断: 公式 SDK ではなく素の WebSocket

- `@zoom/rtms` 1.1.0 は「Node.js Wrapper for the Zoom RTMS C SDK」。`npm install` は通る（prebuilt を GitHub Releases から落とす）が、**この PC（WSL2・Ubuntu 20.04・glibc 2.31・sudo なし）では読み込めない**: `rtms.node` / `librtmsdk.so.0` が `GLIBC_2.34` と `GLIBCXX_3.4.29〜3.4.32` を要求する（`ERR_DLOPEN_FAILED`）。対応は linux-x64 / darwin-arm64 のみ（Windows 不可）。
- プロトコルは Zoom が公式に文書化しており（event-reference・data-types・RTMS_CONNECTION_FLOW.md）、Zoom 自身の quickstart と `rtms-samples` の大半が **express + ws の素の実装**。手で書いても 300 行程度で、依存は `ws` だけ。
- 本番（AWS）では glibc 2.34 以上の Amazon Linux 2023 / Debian 12 で SDK も動くはずだが、SDK は再接続・イベント購読・複数メディアの便利機能が主で、**音声 1 種類を受けるだけなら素の実装のほうが見通しがよい**。SDK 化は必要になったら差し替える（`RtmsSession` の外側の面は変えない）。

## ユーザーが行う設定（実会議で試す前に）

**審査済みの本番 Zoom アプリ（キマルの OAuth 連携）にはスコープを足さない**（再審査になる）。PoC 用に **別のアプリを新規作成**する。

1. **開発用 Zoom アプリを作る** — [Zoom App Marketplace](https://marketplace.zoom.us/) → Develop → Build App → **General App** → **User-managed** を選ぶ。名前は「Kimaru RTMS PoC」など。
2. **公開 URL を用意する**（ローカルにトンネル）— 別ターミナルで
   ```bash
   cloudflared tunnel --url http://localhost:3400      # または: ngrok http 3400
   ```
   表示された `https://xxxx.trycloudflare.com` を控える（起動ごとに変わる。固定したければ ngrok の予約ドメインか cloudflared の名前付きトンネル）。
3. **webhook を設定する** — アプリの **Access**（Features）→ General Features の **Event Subscription** を ON → 名前を付け、**Event notification endpoint URL** に `https://xxxx.trycloudflare.com/webhook` → **Add Events** で「RTMS」を検索し **RTMS Started** と **RTMS Stopped**（他の RTMS イベントも可）→ Done → **Save**。保存時に Zoom が URL 検証（`endpoint.url_validation`）を送るので、**先にこの PoC を起動しておく**（下の「起動」）。同じ画面の **Secret Token** を控える。
4. **スコープを足す** — **Scopes** → **+ Add Scopes** → 「RTMS」を検索 → **`meeting:read:meeting_audio`** を選ぶ（音声だけ。文字起こしも見るなら `meeting:read:meeting_transcript` も）。
5. **資格情報を `.env` に入れる** — **Basic Information** の Client ID / Client Secret と 3 の Secret Token を
   ```bash
   cd poc/rtms && cp .env.example .env   # ZOOM_RTMS_CLIENT_ID / ZOOM_RTMS_CLIENT_SECRET / ZOOM_WEBHOOK_SECRET_TOKEN を埋める
   ```
   Basic Information の **OAuth Redirect URL** にもトンネルの URL を入れておく（Local Test の Allow 後のリダイレクト先。中身は無くてよい）。
6. **自分のアカウントに入れる** — **Local Test** → **Add app now** → **Allow**。App Review は不要（自アカウント内のみ）。
7. **クレジットを買う** — [zoom.us/pricing/developer](https://zoom.us/pricing/developer) の Developer Pack（**Pay as You Go／100／500 クレジット**。2026-06-30 からセルフサービス）。音声のみで 1 分 0.01 クレジット見込みなので、**PoC は Pay as You Go か 100 クレジットで十分**。500 クレジット超の割引は営業。購入後、アカウントで RTMS が有効になる（有効化まで少し時間がかかることがある、と掲示板に報告あり）。
8. **ホスト側の設定を ON にする** — Web ポータル → **Account Management → Account Settings → Zoom Apps タブ → 「Share realtime meeting content with apps」を ON**。続けて **「Auto-start apps that access shared realtime meeting content」→ + Choose an app to auto-start** で作ったアプリを選び **Auto-start status: On**（個人設定 [zoom.us/profile/setting](https://zoom.us/profile/setting) の Zoom Apps タブでも同じ）。アカウントが **verified** であること（メール確認済み）。
9. **会議を開く** — この PoC を起動した状態で、そのアカウントの Zoom デスクトップクライアント（6.5.5 以上）から会議を開始する。参加者には「アプリが会議の内容にアクセスしている」開示が出る。話すと `out/<会議>/0001.wav` が増えていく。

## 起動

```bash
cd poc/rtms
npm install            # ws / tsx / typescript（リポジトリ直下とは別・使い捨て）
cp .env.example .env   # 値を埋める（オフライン確認なら適当な文字列でよい）
npm start              # http://localhost:3400/webhook で待ち受け
```

- ポートは `PORT`（既定 3400。8888 / 3000 / 3123 はこのリポジトリの他のツールが使う）。
- 文字起こしまで通すなら `.env` の `STT_PYTHON=../stt/.venv/bin/python`（#393 の PoC を `poc/stt/README.md` の手順で入れてから）。空なら保存だけ。
- `RTMS_CHUNK_SECONDS`（既定 900 = 15 分）。動作確認では `5` などに縮めると分割が見える。
- 止めるのは Ctrl-C。進行中のセッションを閉じ、書き途中のチャンクを確定してから終わる。

## オフラインでの動作確認（Zoom の資格情報・クレジット不要）

```bash
cd poc/rtms
npm test                                   # 単体テスト 44 件（node:test・tsx）
npm run typecheck

# 端から端まで: ターミナル 1
RTMS_CHUNK_SECONDS=5 npm start
# ターミナル 2（12 秒ぶんの合成音声を 20 倍速で流す → 5 秒 / 5 秒 / 2 秒の 3 チャンク）
npm run fake-zoom -- --seconds 12 --speed 20
# 実音声で（16 kHz mono 16-bit の WAV。#393 の samples/meeting_short.wav 等）
npm run fake-zoom -- --wav ../stt/samples/meeting_short.wav --speed 50
```

`fake-zoom` は Zoom の代わりに (1) 偽のシグナリング／メディア WebSocket サーバーを 127.0.0.1 に立て、(2) 署名付きで `endpoint.url_validation` → `meeting.rtms_started` を POST し、(3) 受信サーバーからの両ハンドシェイクの **署名を検証**してから音声を流し、(4) `STREAM_STATE_UPDATE(TERMINATED)` と `meeting.rtms_stopped` で閉じ、(5) `manifest.json` を読んで期待どおりか判定する（終了コード 0/1）。文字起こしまで見たいなら `.env` の `STT_PYTHON` を入れる。**本物の Zoom を使わずに配管の不具合を切り分けられる**ので、実会議で動かないときはまずこれで「こちら側」を疑いから外す。

### 単体テストで固定していること

| ファイル | 内容 |
|---|---|
| `zoom-webhook.test.ts` | URL 検証の `encryptedToken`、署名の式、検証の 正／改ざん／鍵違い／長さ違い／**古い timestamp（リプレイ）**／ヘッダ欠け、payload の 2 つの形（平ら・`payload.object`） |
| `rtms-protocol.test.ts` | ハンドシェイク署名を公式の式と Zoom の mock-server サンプルの資格情報で照合、`msg_type` 1/3/7/13 の JSON、音声パラメータ（16k mono L16 mixed 100 ms）、`server_urls` の選び方、音声 packet の base64 復号と `length` 照合 |
| `rtms-session.test.ts` | メモリ上の偽 WebSocket で 署名付き 1 → 2 → メディア 3 → 4 → **ACK はシグナリング側へ** → keep-alive は来た接続へ同じ timestamp → 音声が sink へ → TERMINATED で両接続と sink を閉じる。ハンドシェイク失敗・URL 無し・`stop()`・keep-alive 途絶・終了後の遅延フレーム |
| `wav-chunk-writer.test.ts` | 合成 PCM を境界をまたいで書き、0.5 秒ごとに切れる／WAV ヘッダの各欄／PCM の一致／manifest の SHA-256 がファイルと一致／端数バイトの繰り越し／無音で閉じたら chunks 空／`updateChunk` |
| `server.test.ts` | 実際に HTTP を立てて URL 検証・401（署名不正／古い／無し）・started/stopped の配線・400/404/healthz、`SessionManager` の重複 started・stopped・自然終了・stopAll |
| `transcribe-handoff.test.ts` | 偽の transcribe（`fixtures/fake-transcribe.mjs`）を実際に spawn して done／skipped（未設定・無い）／failed（非 0 終了）／直列実行 |

## 保存される音声とマニフェスト

```
out/<meeting_uuid>__<rtms_stream_id>__<8 桁ハッシュ>/
  0001.wav            16 kHz / mono / 16-bit PCM（RIFF・44 byte ヘッダ）・15 分 = 28.8 MB
  0002.wav
  0003.wav            最後は端数
  0001.txt            文字起こし本文（transcribe.py が書く・STT 有効時）
  0001.segments.json  区間ごとの start/end/text/avg_logprob/no_speech_prob と計測値
  manifest.json
```

- 書き途中のチャンクは `000N.wav.part`。閉じるときにヘッダのサイズを書き直し、`fsync` → rename → SHA-256。プロセスが落ちると `.part` と `ended_at: null` のレコードが残り「未完のチャンク」と分かる。
- ディレクトリ名は `meeting_uuid` の `/` `+` `=` を潰したもの＋元の値のハッシュ（Zoom の UUID は base64）。

`manifest.json`（オフライン確認の実物・抜粋）:

```json
{
  "version": 1,
  "meeting_uuid": "fake-1788606188437==",
  "rtms_stream_id": "rtms_fake_1788606188437",
  "created_at": "2026-09-05T11:03:08.457Z",
  "ended_at": "2026-09-05T11:03:09.148Z",
  "status": "closed",
  "end_reason": "stream_TERMINATED:MEETING_ENDED",
  "format": { "container": "wav", "codec": "pcm_s16le", "sample_rate": 16000, "channels": 1, "bits_per_sample": 16 },
  "chunk_seconds": 5,
  "total_seconds": 12,
  "chunks": [
    {
      "seq": 1, "file": "0001.wav",
      "started_at": "2026-09-05T11:03:08.476Z", "ended_at": "2026-09-05T11:03:08.762Z",
      "pcm_bytes": 160000, "duration_seconds": 5,
      "sha256": "45538ba5095a327ed2416f72af34ea862a5ac35d2220f385d8117b68d2999bcb",
      "first_packet_ts": 1788606188475, "last_packet_ts": 1788606193375,
      "transcript": { "status": "done", "text_file": "0001.txt", "segments_file": "0001.segments.json", "rtf": 0.1, "finished_at": "…" }
    }
  ]
}
```

- `seq` は 1 からの連番（欠番＝取りこぼし）。`total_seconds` は `check_complete.py --expected-duration` に渡す値。
- **SHA-256 は送る側の申告**。本番でサーバーに上げるときは、サーバー側で必ず再計算して照合する（T-209）。受信機が壊れていても嘘の manifest で「完了」にならないようにするため。
- `started_at`/`ended_at` は受信機の時計、`first_packet_ts`/`last_packet_ts` は Zoom の音声メッセージに載っていた Unix ms。両方持つのは、後で発話時刻を会議の実時刻に戻すため。

## 文字起こしへの受け渡し

- チャンクが閉じるたびに `python <STT_SCRIPT> <chunk.wav> --json-summary --model <STT_MODEL>` を **1 本ずつ直列に** spawn する（モデルは 1 プロセス 1.3 GB 読むので並列にしない）。`transcribe.py` は音声と同じ場所に `<seq>.txt` / `<seq>.segments.json` を書き、stdout 最終行の JSON（`text` / `segments_path` / `rtf`）をこちらが拾って manifest の `chunks[].transcript` に記録する。
- 15 分のチャンクは small / int8 / CPU（RTF 0.2）で **約 3 分**。会議の終了を待たずに前のチャンクから順に文字になる。
- `STT_PYTHON` 未設定や `transcribe.py` が無いときは `transcript.status: "skipped"` で保存だけ続ける（文字起こしの失敗で受信を止めない）。
- 会議全体の判定（`completed` / `completed_with_gaps` / `incomplete`）は #393 の `check_complete.py` を、チャンクの `segments.json` にチャンク開始オフセットを足して結合したものに掛ける（`poc/stt/README.md` 残る課題 5）。この PoC ではまだ結合していない。

## 実会議での確認（資格情報とクレジットが揃ったら）

1. ターミナル 1: `cd poc/rtms && npm start`（`.env` に本物の値・`STT_PYTHON` 設定済み）
2. ターミナル 2: `cloudflared tunnel --url http://localhost:3400`。URL が変わったら Marketplace の Event notification endpoint URL を直して Save（URL 検証が通ることをログ `webhook: URL 検証に応答` で見る）
3. そのアカウントの Zoom クライアントで会議を開き、1 人で 1〜2 分話す（自動開始に登録済みならアプリは勝手に始まる。開示が画面に出る）
4. ログで `rtms_started` → `signaling: handshake OK` → `media: handshake OK → CLIENT_READY_ACK` → `chunk closed` を確認。**`RTMS_CHUNK_SECONDS=60` にしておくと 1 分で 1 つ目が閉じて文字起こしが走る**
5. 会議を終える → `stream state TERMINATED` → manifest が `closed`。`out/<会議>/0001.txt` を読む
6. 詰まったら `fake-zoom` でこちら側を切り分け、Zoom 側は Marketplace の **Event Subscription のログ**（配信履歴と応答コード）と、アカウント設定の「Share realtime meeting content with apps」・クレジット残高を見る。ハンドシェイクが `INVALID_SIGNATURE(3)` なら Client ID/Secret が別アプリのもの

## 残る課題

- **実会議での検証**が未実施（クレジット購入・開発用アプリ作成・ホスト設定はユーザーの作業）。完了条件「運営の Zoom アカウントの会議の音声が保存され文字が出る」はここで確かめる。
- **単価の一次確認**: 価格ページは機械取得できず、$0.01/分（音声のみ）は Zoom スタッフの掲示板回答が根拠。購入画面で確認する。
- **話者別音声（`data_opt: 2 = AUDIO_MULTI_STREAMS`）**: 参加者ごとに `user_id` 付きで届くので、T-305 の話者分離は Zoom 側の情報で済む可能性が高い。この PoC はミックス 1 本。切り替えは `DEFAULT_AUDIO_PARAMS` と sink を参加者別にするだけ。
- **再接続**: keep-alive が 65 秒途絶えたら再ハンドシェイクが推奨だが、PoC は終了扱い。`STREAM_STATE_UPDATE(INTERRUPTED)` もログのみ。本番では再接続と `buffer_data` の扱いを設計する。
- **文字起こしの結合と完了判定**: チャンクごとの `segments.json` を会議 1 本に結合して `check_complete.py` に掛ける工程が未実装。
- **Google Meet 側**: RTMS は Zoom 専用。Meet は別経路（#370 7.4）。
- **AWS への載せ替え**: webhook 受信（API Gateway/Lambda または常駐）→ セッション（常駐が必要。WebSocket を会議時間ぶん保つ）→ S3 へチャンク＋manifest → STT ワーカー、が本番の形（`docs/ai-bot/system-spec.md`）。この PoC の `server.ts` / `rtms-session.ts` / `wav-chunk-writer.ts` の切り方はそのまま移せる。
- **`@zoom/rtms` SDK**: glibc 2.34 以上の環境で改めて評価する（Docker の `node:22-bookworm` なら動く見込み）。

## ファイル構成

```
poc/rtms/
  README.md                   このファイル
  .env.example                設定の見本（src/config.ts が読む唯一の env）
  package.json / tsconfig.json  PoC 単体（ws だけが依存。root の tsconfig / eslint / prettier の対象外）
  src/
    config.ts                 env の読み取り（1 か所）
    zoom-webhook.ts           URL 検証・署名検証・payload の読み取り
    rtms-protocol.ts          msg_type / media_type / 音声パラメータ / 署名 / メッセージの組み立て
    rtms-session.ts           シグナリング → メディアの接続・keep-alive・音声 → sink
    wav-chunk-writer.ts       15 分ごとの WAV と manifest.json（SHA-256）
    transcribe-handoff.ts     transcribe.py を直列に spawn
    session-manager.ts        stream_id ごとの台帳（重複 started・stopped）
    server.ts                 node:http の webhook 受け口
    main.ts                   起動口（配線）
    *.test.ts                 node:test（44 件）
  scripts/fake-zoom.ts        Zoom の代わり（偽 WS サーバー＋署名付き webhook＋合成音声）
  fixtures/rtms_started.json  webhook の形（公式サンプルどおり・値はダミー）
  fixtures/fake-transcribe.mjs 偽の transcribe.py（テスト用）
```
