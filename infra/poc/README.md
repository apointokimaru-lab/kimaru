# 検証用の最小 AWS 基盤（Terraform）— `infra/poc/`（#483）

> 議事録 Bot の PoC（Meet Bot #478 / Zoom RTMS #475 / 文字起こし #393）を、手元の PC ではなく **本番と同じ器（ECS Fargate・Graviton）** で動かして、コンテナの大きさ・同時実行数・会議 1 時間あたりの実費を**実測**するための基盤。
> 本番の基盤（#382・T-102）の**前半**にあたる。固定費はほぼゼロ（NAT・ALB・常駐サーバーを置かない。タスクは会議ごとに起動し、終われば消える）。

## 目的

- 3 つの PoC を **1 会議 = 1 タスク** の形で Fargate に載せ、CloudWatch（Container Insights）で CPU・メモリの実値を取る
- 「Graviton（arm64）で動くか」「Fargate Spot で動くか」「公開サブネット＋パブリック IP（NAT なし）で外に出られるか」を先に潰す
- 画像のビルドと push は GitHub Actions（OIDC・長期キー無し）で行う（ロールと ECR はここ、workflow は #485 の `.github/workflows/build-images.yml`）

## 構成（文字の図）

```
GitHub Actions ──(OIDC: AssumeRoleWithWebIdentity)──▶ IAM role kimaru-bot-github-actions
   │  docker build --platform linux/arm64                 └─ 許可: ECR push（3 repo）・RegisterTaskDefinition・PassRole
   └──▶ ECR  kimaru-bot/meet-bot  kimaru-bot/rtms  kimaru-bot/stt   （scan on push・未タグ 1 日／タグ付き 5 枚で自動削除）

人（scripts/run-task.sh）──▶ ECS cluster kimaru-bot-poc（FARGATE / FARGATE_SPOT・Container Insights）
                               │
   既定 VPC（172.31.0.0/16）    │ RunTask（awsvpc・assignPublicIp=ENABLED・SG は外向きのみ）
   ┌────────────────────────────┼─────────────────────────────────────────────┐
   │ 公開サブネット ×3（1a/1c/1d）│                                              │
   │   task meet-bot 1 vCPU/2 GB ─┤ arm64  ── Google Meet へ（外向き）           │
   │   task rtms  0.25 vCPU/0.5 GB┤ arm64  ── Zoom RTMS（wss 外向き。webhook の内向きは opt-in）
   │   task stt   2 vCPU/4 GB ────┤ arm64  ── FARGATE_SPOT 前提                  │
   │   task smoke 0.25/0.5 ───────┘ 公開画像 aws-cli で疎通確認                   │
   └──────────┬──────────────────────────────┬────────────────────────────────┘
              │ 実行ロール: ECR pull・logs・SSM(/kimaru-bot/poc/*)   │ タスクロール: S3 の音声バケットだけ
              ▼                                                    ▼
   CloudWatch Logs /kimaru-bot/poc（14 日）               S3 kimaru-bot-audio-<acct6>（7 日で自動削除・SSE-S3・公開遮断）
   CloudWatch Logs /aws/ecs/containerinsights/kimaru-bot-poc/performance（14 日）

Terraform state: S3 kimaru-bot-tfstate-<acct6>（use_lockfile・DynamoDB なし。scripts/bootstrap-state.sh で 1 回だけ作る）
```

`<acct6>` はアカウント ID の下 6 桁。

### 作られる資源（`terraform apply` で 28 個）

| 資源 | 名前 | 役割 |
| --- | --- | --- |
| ECR ×3 | `kimaru-bot/meet-bot` `kimaru-bot/rtms` `kimaru-bot/stt` | PoC の画像置き場。scan on push。未タグは 1 日、タグ付きは新しい 5 枚だけ残す |
| ECS cluster | `kimaru-bot-poc` | FARGATE と FARGATE_SPOT の両方。Container Insights（標準）ON |
| タスク定義 ×4 | `kimaru-bot-poc-{meet-bot,rtms,stt,smoke}` | すべて arm64・awsvpc。大きさは `task_sizes` 変数 |
| CloudWatch Logs ×2 | `/kimaru-bot/poc`・`/aws/ecs/containerinsights/kimaru-bot-poc/performance` | アプリのログ／Container Insights の性能ログ。どちらも保持 14 日 |
| S3 | `kimaru-bot-audio-<acct6>` | 音声・manifest の一時置き場。7 日で全削除、未完了マルチパートは 1 日で破棄 |
| IAM role | `kimaru-bot-poc-task-execution` | ECS が画像を引きログを書く。SSM は `/kimaru-bot/poc/*` だけ読める |
| IAM role | `kimaru-bot-poc-task` | コンテナの中のコードが S3（上のバケットだけ）に Put/Get/List |
| IAM OIDC provider | `token.actions.githubusercontent.com` | GitHub Actions の身分証明（1 アカウントに 1 つ） |
| IAM role | `kimaru-bot-github-actions` | `repo:apointokimaru-lab/kimaru:*` から引き受け可。ECR push・タスク定義登録・PassRole だけ |
| IAM service-linked role | `AWSServiceRoleForECS` | ECS が要る。自動作成との競合を避けるため Terraform で先に作る |
| Security group | `kimaru-bot-poc-tasks` | 外向きすべて許可。内向きは既定で無し（`rtms_ingress_cidrs` で opt-in） |
| （Terraform 管理外）S3 | `kimaru-bot-tfstate-<acct6>` | state。`scripts/bootstrap-state.sh` が作る。`destroy` でも残す |

VPC・サブネット・IGW は東京リージョンの**既定 VPC** を data で引いて使う（新設しない）。

## 費用

単価は 2026-09-06 に AWS Price List API から取った東京リージョンのオンデマンド値（USD・税抜）。円換算は 1 ドル 150 円の目安。

### 何も動いていない月の固定費

| 項目 | 単価 | 何も動いていないとき |
| --- | --- | --- |
| ECR 画像の保存 | $0.10/GB・月 | **唯一の固定費**。画像 3 種 × 最大 5 枚。meet-bot（Chromium 入り）と stt（モデル同梱）が 1〜2 GB 級なので、揃うと 3〜8 GB ≒ **¥50〜120/月** |
| S3（音声） | $0.025/GB・月 | 7 日で消えるので ≒ ¥0 |
| S3（state） | 同上 | 数十 KB ≒ ¥0 |
| CloudWatch Logs 保存 | $0.033/GB・月 | 14 日で消えるので ≒ ¥0 |
| Container Insights（カスタム指標） | $0.30/指標・月（時間按分） | 指標はタスクが走った時間だけ出るので、止まっていれば ¥0 |
| ECS クラスター・タスク定義・IAM・OIDC・SG・既定 VPC | 無料 | ¥0 |
| NAT Gateway・ALB・EIP | — | **置いていない**（NAT だけで月 ¥6,000 前後かかる） |

→ **何も動かさない月は ECR の保存料だけ（数十円〜百数十円）**。apply 直後は画像が無いので ¥0。

### タスク 1 時間あたり（1 タスク・起動から停止まで）

Fargate は vCPU 時間 ＋ メモリ GB 時間の合算。Graviton（arm64）は x86 より約 20% 安い。Spot は「最大 70% 引き」が公表値で、単価は Price List に無い（下の Spot 列は ×0.3 の目安。実値は請求の usage type `APN1-Fargate-Spot-*` で確認する）。これに **パブリック IPv4 $0.005/h（¥0.75/h）** が 1 タスクごとに乗る。一時ストレージは 20 GB まで無料。

| タスク定義 | 大きさ | x86（参考） | **Graviton（この構成）** | Graviton Spot（目安） |
| --- | --- | --- | --- | --- |
| meet-bot | 1 vCPU / 2 GB | $0.0616（¥9.2） | **$0.0493（¥7.4）** | ≒ $0.015（¥2.2） |
| rtms | 0.25 vCPU / 0.5 GB | $0.0154（¥2.3） | **$0.0123（¥1.9）** | ≒ $0.004（¥0.6） |
| stt | 2 vCPU / 4 GB | $0.1232（¥18.5） | **$0.0986（¥14.8）** | ≒ $0.030（¥4.4） |
| smoke | 0.25 vCPU / 0.5 GB | $0.0154 | $0.0123 | ≒ $0.004 |

単価（東京・1 時間あたり）: x86 vCPU $0.05056・GB $0.00553／ARM vCPU $0.04045・GB $0.00442／一時ストレージ 20 GB 超 $0.000133/GB。

### 会議 1 時間あたりの目安（Graviton・IP 込み）— 概算と実測

| | 概算（2026-09-06・#483） | **実測から（2026-09-06・#485・下の表）** |
| --- | --- | --- |
| **Google Meet** | meet-bot 1 h（¥7.4 ＋ IP ¥0.75）＋ stt small（手元の RTF ≈ 0.2 → 約 15 分。Spot ¥1.3／オンデマンド ¥3.9）≒ **¥9.5〜12** | meet-bot 1 h ¥8.15 ＋ stt 2 vCPU（RTF 0.34 → 21 分。Spot ¥1.8／オンデマンド ¥5.4）≒ **¥10.0〜13.6**。stt を 4 vCPU にすると（RTF 0.22 → 14 分。Spot ¥2.3／オンデマンド ¥7.3）≒ ¥10.5〜15.5 |
| **Zoom（RTMS）** | rtms 1 h（¥1.9 ＋ IP ¥0.75）＋ stt 同上 ≒ **¥4〜6.5** | rtms 1 h ¥2.65 ＋ stt 同上 ≒ **¥4.5〜8.1**（4 vCPU なら ¥5〜10）。**Zoom のクレジット ≈ $0.6/h（¥90）が別に乗り、AWS 側の 10 倍以上**（`poc/rtms/README.md`） |

- 概算との差はほぼ **stt の RTF**（手元の i5・4 スレッドで 0.19〜0.23 → Graviton 2 vCPU・2 スレッドで 0.34）。Bot 側の器（meet-bot・rtms）は概算どおりで、実際の CPU 使用率は 1 割以下（擬似ページなので下限。本物の Meet はもっと使う）
- Spot の実単価は Price List に無く「×0.3」の目安のまま。請求の usage type `APN1-Fargate-Spot-*` で確認して置き換える

## 実測（2026-09-06・#485）

画像は `.github/workflows/build-images.yml` が `ubuntu-24.04-arm` で作った arm64（ECR 上の圧縮サイズ: **stt 597 MB**〔うち small モデル 464 MB〕・**rtms 81 MB**・**meet-bot 948 MB**〔Playwright 公式画像 v1.62.1-noble・Node 24〕。ビルドは 3 つ並列で 2 分。faster-whisper の依存はすべて manylinux aarch64 の wheel で、コンパイルは無かった）。
すべて **1 タスク＝1 本**、`infra/poc/scripts/run-task.sh`（`--env` / `--cpu` `--memory` で上書き）で起動。CPU・メモリは Container Insights の performance ログをタスク ID で絞った per-task の値（1 分ごとのサンプル。瞬間のピークは拾わない）。円は 1 ドル 150 円・上の単価表・Spot は ×0.3 の目安・IPv4 込み。

| タスク | 大きさ | キャパシティ | 入力・条件 | 処理時間（wall） | RTF | CPU（avg / max・予約比） | メモリ（CI max ／ プロセスの peak RSS） | 課金秒（pull → stop） | 円（Spot 目安／オンデマンド） | 出力 |
| --- | --- | --- | --- | ---: | ---: | --- | --- | ---: | --- | --- |
| **stt** | 2 vCPU / 4 GB | FARGATE_SPOT | 60 分の合成日本語音声（`ja60min.wav`・115 MB）・small int8・2 スレッド | 文字起こし 1,211 s（20.2 分）＋ DL 0.4 s ＋ モデル読込 0.6 s | **0.336** | 1,905 / 2,046 unit（**93% / 100%**） | 1,894 MiB ／ **3,200 MB** | **1,251** | **¥1.8 ／ ¥5.4**（＝音声 1 時間あたり） | 15,712 字・`completed_with_gaps`（被覆率 99.8%・説明のつかない隙間 1 か所〔1148〜1158 s・発話 5 s〕・低信頼 5 区間） |
| **stt** | 1 vCPU / 2 GB | FARGATE_SPOT | 同じ音声の先頭 30 分（`ja30min.wav`）・1 スレッド | 文字起こし 1,243 s（20.7 分）＋ モデル読込 1.6 s | **0.691** | 1,007 / 1,024 unit（**98% / 100%**） | 1,784 MiB ／ 1,867 MB（2 GB の枠に対して 9 割） | **1,285** | **¥1.1 ／ ¥2.9**（音声 1 時間あたり ¥2.1 ／ ¥5.8） | 7,784 字・`completed`（exit 0） |
| **stt** | 4 vCPU / 8 GB | FARGATE_SPOT | 同じ 30 分・4 スレッド | 文字起こし 393 s（6.5 分） | **0.218** | 3,798 / 4,088 unit（93% / 100%） | 1,755 MiB ／ 1,945 MB | **436** | **¥1.2 ／ ¥3.7**（音声 1 時間あたり ¥2.3 ／ ¥7.3） | 7,809 字・`completed`（exit 0） |
| **meet-bot** | 1 vCPU / 2 GB | FARGATE | `MODE=fake-meet` 300 s・擬似 Meet に「今すぐ参加」→ 440 Hz を WebRTC ループバックで受信 → 60 s WAV | 在室 300.5 s（起動→入室 2 s） | — | 66 / 95 unit（**6.4% / 9.2%**） | 330 MiB ／ — | **363** | ¥0.8（オンデマンド） | WAV 6 本（60 s × 5 ＋ 0.3 s）・全チャンク RMS ≈ 11,600（無音なし・S3 の 0002.wav を手元で再計算しても同じ）・manifest/result/events/スクショが S3 に |
| **rtms** | 0.25 vCPU / 0.5 GB | FARGATE | `MODE=fake-zoom` 300 s・実時間（10 packets/s）・受信機と偽 Zoom（送信側）を同じコンテナで・60 s WAV | 305 s | — | 11 / 32 unit（**4.4% / 12.4%**・送信側込み） | 74 MiB ／ — | **340** | ¥0.25（オンデマンド） | WAV 5 本（60 s × 5・9.6 MB）・manifest の SHA-256 全部あり・S3 に |

このタスク（#485）の AWS 支出は上の 5 本で **約 ¥5**（Spot 目安。全部オンデマンド換算でも約 ¥13）＋ ECR の保存料（1.6 GB ≒ ¥25/月）。S3・CloudWatch・GitHub Actions（公開リポジトリ）は ¥0。

### 読み取り

- **stt**: RTF は 1 vCPU 0.69 → 2 vCPU 0.34 → 4 vCPU 0.22（1 → 2 はほぼ 2 倍、2 → 4 は 1.5 倍）。音声 1 時間あたりの費用は 1 vCPU ¥2.1・2 vCPU ¥1.8・4 vCPU ¥2.3（Spot 目安）で 1 と 2 は同じ、4 は 3 割高。Graviton の 2 vCPU は **RTF 0.34 で NFR（≤ 0.25）を満たさない**。4 vCPU なら 0.22 で満たす（2 → 4 vCPU で 1.54 倍。スレッドが増えるほど効率は落ち、音声 1 時間あたりの費用は 2 vCPU の ¥1.8 → 4 vCPU の ¥2.3）。1 会議 1 タスクなら「会議終了から 15 分以内」のために **stt は 4 vCPU / 8 GB** が候補（`task_sizes` はまだ変えていない。15 分チャンク単位で回す本番の形〔spec FR-2.5〕なら 2 vCPU でも並列で間に合うので、そちらを測ってから決める）
- **stt のメモリ**: プロセスの peak RSS は **音声長に比例して伸びる**（30 分で 1.9 GB・60 分で 3.2 GB ≒ 1.3 GB ＋ 32 MB/分）。1 本まるごと渡すなら 60 分の会議で 4 GB が要る。15 分チャンクなら 1.8 GB 程度で、2 GB は際どく 4 GB が安全
- **モデル同梱の効果**: モデル読込 0.6 秒（手元は 2〜5 秒＋初回 DL）。画像の pull は 597 MB で 10 秒、meet-bot の 948 MB で 29 秒
- **meet-bot / rtms の器**: 擬似ページでは CPU 1 割・メモリ 2 割以下。ただし擬似ページは映像タイルも Meet の UI も無い**下限**なので、`task_sizes` は本物の Meet（#478 の Bot 用アカウント後）で測るまで据え置く。rtms は最小サイズ（0.25 vCPU）でも 1 割なので据え置き
- **Spot**: stt 3 本とも FARGATE_SPOT で即時に取れた（中断なし）
- **`/data` の bind mount は root 所有**で非 root のコンテナから書けない（3 つとも `Permission denied` → 入口スクリプトが `/tmp/data` に退避して続行）。Fargate の一時ストレージは同じ 20 GB の枠なので実害は無いが、タスク定義の `volume`/`mountPoints` は意味を成していない。次の apply で外すか、root で `chown` する init コンテナを足す（「残る課題」）

### 上限（Service Quotas）

AWS の既定値は **Fargate On-Demand vCPU 6・Fargate Spot vCPU 6**（`get-aws-default-service-quota`）だが、このアカウントに**適用されている値は 2026-09-06 時点でどちらも 64**（`aws service-quotas get-service-quota --service-code fargate --quota-code L-3032A538` / `L-36FBB829`）。#485 で 32 への引き上げを申請したところ「現在値より大きい値を指定すること」（`IllegalArgumentException`）で弾かれた＝**申請は不要**。同時実行の計測（meet-bot ×5 など）はこのまま始められる。64 を超える計画になったら同じコマンドで申請する（無料・通常は数時間〜1 日）。

## 事前準備（手元）

- `aws` CLI v2 と `terraform` ≥ 1.10（`~/.local/bin`）。`export PATH="$HOME/.local/bin:$PATH"`
- `~/.aws/` に IAM ユーザー `kimaru-bot-dev` の認証情報（リージョン `ap-northeast-1`）。`aws sts get-caller-identity` で確認
- Docker は要らない（画像は GitHub Actions が作る）

## apply の手順

```bash
cd infra/poc
scripts/bootstrap-state.sh     # 1 回だけ。state 用 S3 を作る（あれば設定を揃えるだけ。何度実行してもよい）
terraform init                 # backend は versions.tf（bucket 名にアカウント ID の下 6 桁）
terraform plan
terraform apply
```

- 別アカウントで使うときは `versions.tf` の `bucket` を bootstrap が出した名前に直してから `init`
- GitHub の OIDC provider がアカウントに既にある場合（1 つしか作れない）は bootstrap が案内する `terraform import ...` を先に実行する
- apply の後、GitHub Actions 用の変数を入れる（`gh variable set`。値は `terraform output`）:
  - `AWS_ROLE_ARN` ← `github_actions_role_arn`
  - `AWS_REGION` ← `region`
  - `ECR_REGISTRY` ← `ecr_registry`

### 疎通確認（画像無しで通る）

```bash
scripts/run-task.sh smoke               # オンデマンド
scripts/run-task.sh smoke FARGATE_SPOT  # Spot
aws s3 ls s3://$(terraform output -raw audio_bucket)/smoke/
```

`smoke` は `public.ecr.aws/aws-cli/aws-cli:latest`（arm64 の manifest あり）で `uname -m`・タスクロールの ARN・`aws s3 cp /etc/hostname s3://<bucket>/smoke/<epoch>.txt` を実行する。**公開サブネットからの外向き通信・CloudWatch へのログ・タスクロールの S3 権限・arm64** を自前の画像無しで一度に確かめる。2026-09-06 の結果: FARGATE / FARGATE_SPOT ともに `arch=aarch64`・exit 0・S3 にオブジェクト・ログ 4 行。起動（PROVISIONING）から停止まで約 55 秒、課金対象（pull 開始→停止）約 40 秒。

## destroy の手順

```bash
cd infra/poc
terraform destroy      # ECR の画像・S3 の音声も一緒に消える（force_delete / force_destroy）
```

残るのは **state 用の S3 バケットだけ**（数十 KB。完全に畳むなら `aws s3 rb s3://kimaru-bot-tfstate-<acct6> --force`）。`AWSServiceRoleForECS` の削除が「使用中」で失敗したときは無料の資源なので放置してよい（再 apply 時は `terraform import aws_iam_service_linked_role.ecs arn:aws:iam::<acct>:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS`）。

## `scripts/run-task.sh` の使い方

```
scripts/run-task.sh <smoke|meet-bot|rtms|stt> [FARGATE|FARGATE_SPOT] [--no-wait] [--timeout <秒>] [--task <arn>]
```

1 本起動して止まるまで待ち、次を出す。

- 状態遷移（PROVISIONING → PENDING → RUNNING → STOPPED）と、RUNNING になった時点の**パブリック IP**（rtms の webhook URL に使う。ENI は停止で消えるので走っている間に取る）
- `describe-tasks` の要約: 終了コード・停止理由・capacity provider・AZ・`cpuArchitecture`・pull 開始/停止・開始/停止時刻と **課金対象秒（pull 開始 → 停止）**
- CloudWatch Logs の末尾 50 行（ストリーム `<key>/<コンテナ名>/<タスク ID>`）
- Container Insights: family 単位の `CpuUtilized`（CPU unit・1024 = 1 vCPU）と `MemoryUtilized`（MiB）の平均・最大、さらに performance ログをタスク ID で絞った **per-task の平均・最大・予約値**（Logs Insights）。反映まで数分かかるので、`samples=0` なら少し待って `--task <arn>` で見直す

会議 1 本ぶん走らせるときは `--no-wait` で起動だけして、終わってから `--task <arn>` で結果を取る。同じ family を並走させると family 単位の指標は合算になる（per-task のほうを見る）。

## 秘密（Secrets）の入れ方 — まだ入れていない

Zoom の資格情報などは **SSM Parameter Store の SecureString** に置き、タスク定義の `secrets` で参照する（env に平文で書かない）。名前は `terraform output ssm_parameter_names`:

| タスク | パラメータ名 |
| --- | --- |
| rtms | `/kimaru-bot/poc/rtms/ZOOM_RTMS_CLIENT_ID`・`/kimaru-bot/poc/rtms/ZOOM_RTMS_CLIENT_SECRET`・`/kimaru-bot/poc/rtms/ZOOM_WEBHOOK_SECRET_TOKEN` |
| meet-bot | （無し。Google の資格情報は env ではなくログイン済み Chromium プロファイル＝ディレクトリ。下の「残る課題」） |
| stt | （無し） |

```bash
aws ssm put-parameter --type SecureString --name /kimaru-bot/poc/rtms/ZOOM_RTMS_CLIENT_ID --value '...'
```

入れたら `task-definitions.tf` の rtms に `secrets = [{ name = "ZOOM_RTMS_CLIENT_ID", valueFrom = "arn:aws:ssm:...:parameter/kimaru-bot/poc/rtms/ZOOM_RTMS_CLIENT_ID" }, ...]` を足して apply する。実行ロールは既にこの接頭辞を読める（既定の AWS 管理鍵なら `kms:Decrypt` は不要）。

## GitHub Actions（OIDC）— `.github/workflows/build-images.yml`（#485）

- **起動**: `main_bot` への push で `poc/**` か workflow 自身が変わったとき、または手動（`workflow_dispatch`・`images` 入力で絞れる）。**`workflow_dispatch` は既定ブランチ（main）に無い workflow を起こせない**ので、main_bot に入る前の作業ブランチで試すときは一時的に `push.branches` に自分のブランチを足す（PR 前に戻す）
- **ランナー**: `ubuntu-24.04-arm`（公開リポジトリは無料）。arm64 をネイティブに作るので QEMU は使わない
- **認証**: `aws-actions/configure-aws-credentials@v4` に `role-to-assume: ${{ vars.AWS_ROLE_ARN }}` → `amazon-ecr-login@v2` → `docker/build-push-action@v6`（`platforms: linux/arm64`・`:latest` と `:<sha>`・GHA キャッシュ・`provenance: false`）
- 信頼条件は今 `repo:apointokimaru-lab/kimaru:*`（どのブランチ・PR からでも）。workflow を `main_bot` だけにしたら `variables.tf` の `github_ref_pattern` を `ref:refs/heads/main_bot` にして apply
- このロールで**できないこと**: RunTask・S3・SSM・IAM の変更。実行は人が `run-task.sh` で行う
- 各画像の中身・環境変数・`MODE` は [`poc/README.md`](../../poc/README.md)

## Budgets のアラート

AWS Budgets（月 ¥1,000 などで通知）は**コンソールでユーザーが作る**（通知先メールアドレスが要るため Terraform に入れていない）。Billing → Budgets → Create budget → Cost budget → 月額 → メール。Cost Explorer では タグ `Project=kimaru-bot` で絞ると PoC ぶんだけが出る（state バケットにも同じタグ）。

## 残る課題

- ~~画像のビルド workflow~~ → #485 で `.github/workflows/build-images.yml`（`poc/README.md`）
- ~~S3 への書き出し~~ → #485 で各 PoC の入口スクリプト（`/data/out` → `s3://$S3_BUCKET/$S3_PREFIX<RUN_ID>/`）
- ~~quota~~ → 適用値は既に 64 vCPU（上の「上限」）。申請不要
- **実会議での計測**: Meet は Bot 用 Google アカウント（#478）ができてから `MODE=join`（プロファイルは `s3://<bucket>/profiles/meet-bot.tar.gz`）。Zoom は RTMS の資格情報とクレジット（#475）を SSM に入れてから `MODE=server`。擬似ページの値は下限
- **stt の器**: 2 vCPU は RTF 0.34。「会議終了から 15 分以内」を 1 本まるごとで満たすなら 4 vCPU / 8 GB。本番の 15 分チャンク並列（FR-2.5）を先に測って `task_sizes` を決める
- **`/data` の bind mount**: root 所有で非 root から書けない（実測）。タスク定義から `volume`/`mountPoints` を外す（コンテナ層も同じ一時ストレージ）か、init コンテナで `chown` する
- **同時実行の計測**: meet-bot ×5 など（quota は足りる）
- **Spot の実単価**: 請求の `APN1-Fargate-Spot-*` で ×0.3 の目安を置き換える
- **Secrets の投入**: 上の節。rtms の 3 つを SSM に入れてから `secrets` を足す
- **meet-bot のプロファイル**: S3 の `profiles/` は 7 日で消える設定なので、prefix 別のライフサイクルを足すか、別バケットにする
- **rtms の webhook**: Zoom からの POST を受けるにはパブリック IP に届く必要がある。タスクごとに IP が変わるので、PoC では `run-task.sh` が出す IP を Zoom アプリの Event notification endpoint に都度入れる（`rtms_ingress_cidrs` に Zoom の送信元 IP を入れて apply）。固定 URL は本番 #382（API Gateway / Lambda か ALB）で
- **OIDC の絞り込み**: `github_ref_pattern` を `ref:refs/heads/main_bot` に

## 本番化（#382・T-102）との差分

| 項目 | この PoC | 本番（`docs/ai-bot/infrastructure-architecture.md`・system-spec T-102〜107） |
| --- | --- | --- |
| VPC | 既定 VPC・公開サブネット・パブリック IP | 専用 VPC。Bot をプライベートに置くか（NAT 代）はこの PoC の実測で決める（infrastructure-architecture 8 章の比較） |
| 起動 | 人が `run-task.sh` | EventBridge Scheduler → SQS FIFO → RunTask（T-203） |
| 秘密 | SSM Parameter Store（手で put） | Secrets Manager or SSM を Terraform で（T-102） |
| 画像 | `:latest` MUTABLE | IMMUTABLE ＋ digest 固定・スキャン結果で止める（T-103） |
| S3 | 単一バケット・7 日で全削除 | 状態別 prefix（completed / with_gaps / incomplete）で保持日数を分ける（T-107） |
| ログ・監視 | CloudWatch Logs 14 日・Container Insights | 構造化ログ・Sentry・アラーム（T-106） |
| API 側 | 無し | Lambda / API（Zoom webhook の固定 URL・Meet の招待）|
| アカウント | 1 アカウント・`kimaru-bot-dev`（AdministratorAccess） | 環境分離・最小権限のロール |

## 変数（`variables.tf`）

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `task_sizes` | meet-bot 1024/2048・rtms 256/512・stt 2048/4096・smoke 256/512 | CPU unit / MiB。Fargate の組み合わせ制約に従う |
| `images` | `{}`（ECR の `:latest`） | digest 固定などで上書き |
| `log_retention_days` | 14 | CloudWatch Logs |
| `audio_expire_days` | 7 | 音声バケット |
| `rtms_port` / `rtms_ingress_cidrs` | 3400 / `[]` | rtms の webhook を受けるときだけ開ける |
| `github_repo` / `github_ref_pattern` | `apointokimaru-lab/kimaru` / `*` | OIDC の信頼条件 |

`*.tfvars` は `.gitignore` 済み（commit しない）。`.terraform.lock.hcl` は commit する（プロバイダの版を固定）。
