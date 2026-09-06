# 議事録 Bot の PoC 3 つ — `poc/`（#393・#475・#478）と Fargate での動かし方（#485）

> 使い捨ての PoC。本番の Bot・受信サービス・STT ワーカーは新スタック（`docs/ai-bot/system-spec.md`・基盤 #382）で別に作る。
> ここは「3 つの PoC を同じ器（ECS Fargate・Graviton）で動かして実値を取る」ための索引。基盤そのものは [`infra/poc/README.md`](../infra/poc/README.md)。

| ディレクトリ | 何をするか | 手元の説明 | 画像（ECR `kimaru-bot/<名前>`） |
| --- | --- | --- | --- |
| [`stt/`](stt/) | faster-whisper（CPU・int8）で日本語の文字起こし＋完了判定 | [`stt/README.md`](stt/README.md) | `stt` — `python:3.12-slim` ＋ small モデル同梱 |
| [`rtms/`](rtms/) | Zoom RTMS（webhook → WebSocket）で会議音声を受けて 15 分ごとの WAV に | [`rtms/README.md`](rtms/README.md) | `rtms` — `node:22-slim`・esbuild で束ねた ESM |
| [`meet-bot/`](meet-bot/) | ヘッドレス Chromium で Google Meet に入り、ページ内で音声を取り出して WAV に | [`meet-bot/README.md`](meet-bot/README.md) | `meet-bot` — Playwright 公式画像 `v1.62.1-noble` |

## 画像のビルド（GitHub Actions・`.github/workflows/build-images.yml`）

- **起動**: `main_bot` への push で `poc/**` か workflow 自身が変わったとき。手動は Actions → Build PoC images → Run workflow（`images` に `stt,rtms` のように絞れる。空なら 3 つ）
- **ランナー**: `ubuntu-24.04-arm`（公開リポジトリは無料の arm64 ホストランナー）。QEMU 無しでネイティブに arm64 を作る。使えなくなったら `ubuntu-latest` ＋ `docker/setup-qemu-action` に戻す
- **認証**: OIDC で `kimaru-bot-github-actions` ロール（`vars.AWS_ROLE_ARN`）。長期キーは無い。ECR push・タスク定義登録・PassRole しかできない
- **タグ**: `:latest` と `:<git sha>`。タスク定義は `:latest` を指す（PoC 運用。本番は digest 固定・#382）
- **キャッシュ**: GHA キャッシュ（`type=gha`・画像ごとに scope）。stt のモデル DL 層と meet-bot の `npm ci` 層が効く
- 3 つとも **非 root**・出力は `/data/out`（タスク定義が bind mount する。root 所有で書けないときは `/tmp/data/out` に退避）・終了時に `s3://$S3_BUCKET/$S3_PREFIX<RUN_ID>/` へ丸ごと上げる

## Fargate での動かし方（`infra/poc/scripts/run-task.sh`）

```
infra/poc/scripts/run-task.sh <stt|rtms|meet-bot|smoke> [FARGATE|FARGATE_SPOT] [--env K=V ...] [--cpu <unit> --memory <MiB>] [--no-wait] [--task <arn>]
```

`--env` はタスク定義の環境変数を上書き・追加する（`run-task` の overrides）。`--cpu/--memory` はタスク定義を登録し直さずに大きさを変える（Fargate の組み合わせ制約に従う。両方指定）。止まるまで待って、終了コード・課金秒（pull 開始 → 停止）・ログの末尾・Container Insights の CPU/メモリ（反映まで数分。`samples=0` なら `--task <arn>` で見直す）を出す。

### 共通の環境変数

| 変数 | 意味 | 既定（タスク定義） |
| --- | --- | --- |
| `AWS_REGION` | SDK のリージョン | `ap-northeast-1` |
| `S3_BUCKET` | 出力先バケット（無ければ上げない。手元の docker run 用） | `kimaru-bot-audio-<acct6>` |
| `S3_PREFIX` | 出力先の接頭辞 | `stt/` `rtms/` `meet/` |
| `RUN_ID` | 出力先の区別（`<S3_PREFIX><RUN_ID>/`）。省略時は起動時刻 | — |
| `MODE` | rtms・meet-bot の腕（下表） | `server` / `selftest` |

### stt — `python /app/entrypoint.py`

| 変数 | 意味 |
| --- | --- |
| `INPUT_S3_URI` | **必須**。`s3://bucket/key`（WAV / M4A など PyAV が読めるもの） |
| `STT_MODEL` / `STT_THREADS` | `small` / vCPU 数に合わせる（既定 2） |
| `STT_MODEL_DIR` | 同梱モデル（`/opt/models`。`HF_HUB_OFFLINE=1` なので実行時に HF へは出ない） |
| `EXPECTED_DURATION` | 任意。manifest の `total_seconds` 相当。`check_complete.py --expected-duration` に渡す |

S3 から落とす → `transcribe.py --json-summary` → `check_complete.py --json` → `timings.json`（DL 秒・モデル読込秒・文字起こし秒・RTF・ピーク RSS・判定）を書き、stdout に `STT_TIMINGS {...}` を 1 行出す → `/data/out` を S3 へ。

```bash
# 例: 60 分の音声を Spot・2 vCPU/4 GB で
infra/poc/scripts/run-task.sh stt FARGATE_SPOT --env INPUT_S3_URI=s3://kimaru-bot-audio-003994/stt-in/ja60min.wav --env RUN_ID=ja60-2vcpu
# 1 vCPU/2 GB（スレッドも合わせる）
infra/poc/scripts/run-task.sh stt FARGATE_SPOT --cpu 1024 --memory 2048 --env STT_THREADS=1 --env INPUT_S3_URI=... --env RUN_ID=ja60-1vcpu
```

### rtms — `entrypoint.sh`

| `MODE` | 何をするか | 追加の変数 |
| --- | --- | --- |
| `server`（既定） | 受信サーバー（`dist/main.mjs`）を前面で。ECS の停止（SIGTERM）で閉じてから S3 へ | Zoom の資格情報は SSM の `secrets`（未投入・`infra/poc/README.md`） |
| `fake-zoom` | 受信サーバーを裏で起動 → 同じコンテナで `fake-zoom`（偽の署名付き webhook ＋ 偽 WS サーバー ＋ 合成 PCM）→ 閉じて S3 へ。stdout に `RTMS_RESULT {...}` | `FAKE_SECONDS`（既定 300）・`FAKE_SPEED`（既定 1 ＝ 実時間・10 packets/s）・`RTMS_CHUNK_SECONDS` |

```bash
infra/poc/scripts/run-task.sh rtms --env MODE=fake-zoom --env FAKE_SECONDS=300 --env RTMS_CHUNK_SECONDS=60 --env RUN_ID=fake300
```

### meet-bot — `entrypoint.sh`

| `MODE` | 何をするか | 追加の変数 |
| --- | --- | --- |
| `selftest`（既定） | 擬似ページに 440 Hz を流して録音の自己診断（数秒） | `MEET_FAKE_SECONDS`（既定 5） |
| `fake-meet` | 擬似 Meet（同じコンテナの 127.0.0.1）に「今すぐ参加」→ 録音 → 会議終了で退出（`cli.ts fake-run`）。stdout に `MEET_RESULT {...}`（WAV ごとの RMS つき） | `MEET_FAKE_SECONDS`（既定 300）・`MEET_CHUNK_SECONDS` |
| `join` | 本物の Meet。`s3://$S3_BUCKET/$MEET_PROFILE_S3_KEY`（既定 `profiles/meet-bot.tar.gz`）のログイン済みプロファイルを `MEET_PROFILE_DIR` に展開して `MEET_URL` に入る。Bot 用 Google アカウントができるまで使えない | `MEET_URL`・`MEET_GUEST_NAME`（未ログインで名前を入れる試験用） |

プロファイルの置き方（アカウントができたら）: 手元で `npm run login` → `tar czf - -C profile . | aws s3 cp - s3://kimaru-bot-audio-<acct6>/profiles/meet-bot.tar.gz`。バケットは 7 日で消えるので、長く使うなら prefix 別のライフサイクルか別バケット（`infra/poc/README.md` 残る課題）。

```bash
infra/poc/scripts/run-task.sh meet-bot --env MODE=fake-meet --env MEET_FAKE_SECONDS=300 --env MEET_CHUNK_SECONDS=60 --env RUN_ID=fake300
```

## 実測（2026-09-06）

数値と費用の表は [`infra/poc/README.md`](../infra/poc/README.md) の「実測（2026-09-06・#485）」にまとめてある。再現は上のコマンドそのまま（音声は `poc/stt/make_samples.py` の 6 発話を声の高さ 4 種・乱数順・1〜3 秒の間で 60 分に並べた `ja60min.wav`（3609.9 秒・115 MB）。`samples/` と同じく commit しない）。
