#!/usr/bin/env bash
# Fargate タスクを 1 本起動し、止まるまで待って、CloudWatch のログの末尾と CPU/メモリの実測を出す（#483）。
#
# 使い方:
#   scripts/run-task.sh <smoke|meet-bot|rtms|stt> [FARGATE|FARGATE_SPOT] [--no-wait] [--timeout <秒>]
#                       [--env KEY=VALUE ...] [--cpu <unit> --memory <MiB>]
#
#   第 1 引数はタスク定義の短い名前（outputs の task_definition_families の key）。
#   第 2 引数はキャパシティプロバイダ（既定 FARGATE = オンデマンド。stt は FARGATE_SPOT で回す前提）。
#   --no-wait   起動だけして戻る（会議 1 本ぶん走らせるとき）。後で同じ引数に --task <arn> を付けると結果だけ取れる
#   --timeout   待つ上限秒（既定 3600）。超えたら止めずに戻る
#   --task <arn> 起動せず、既に走った／走っているタスクの結果だけを出す
#   --env K=V   コンテナの環境変数を上書き・追加する（run-task の overrides。繰り返し可。#485: MODE / INPUT_S3_URI / RUN_ID 等）
#   --cpu/--memory  タスクの大きさをタスク定義を登録し直さずに変える（Fargate の組み合わせ制約に従う。両方指定する）
#
# 前提: このディレクトリで terraform init/apply 済み（cluster・subnet・SG・log group を terraform output から取る）。
#       jq は使わない（aws --query だけ）。GNU date（Linux / WSL）前提。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TF_DIR="$HERE/.."

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

NAME="${1:-}"; [ -n "$NAME" ] || usage
shift
CAPACITY="FARGATE"
WAIT=1
TIMEOUT=3600
TASK_ARN=""
ENV_JSON=""
CPU_OVERRIDE=""
MEM_OVERRIDE=""
# JSON 文字列の中に入れる値の最小のエスケープ（" と \ だけ。jq を使わない方針のため）
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
while [ $# -gt 0 ]; do
  case "$1" in
    FARGATE|FARGATE_SPOT) CAPACITY="$1" ;;
    --no-wait) WAIT=0 ;;
    --timeout) TIMEOUT="$2"; shift ;;
    --task) TASK_ARN="$2"; shift ;;
    --env)
      KV="$2"; shift
      [ "${KV#*=}" != "$KV" ] || { echo "--env は KEY=VALUE の形にする: $KV" >&2; exit 2; }
      ENV_JSON="${ENV_JSON:+$ENV_JSON,}{\"name\":\"$(json_str "${KV%%=*}")\",\"value\":\"$(json_str "${KV#*=}")\"}"
      ;;
    --cpu) CPU_OVERRIDE="$2"; shift ;;
    --memory) MEM_OVERRIDE="$2"; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
  shift
done

tfout() { terraform -chdir="$TF_DIR" output -raw "$1"; }
tfout_list() { terraform -chdir="$TF_DIR" output -json "$1" | tr -d '[]" \n'; }

CLUSTER="$(tfout ecs_cluster_name)"
LOG_GROUP="$(tfout log_group)"
SG="$(tfout security_group_id)"
SUBNETS="$(tfout_list subnet_ids)"
FAMILY="$(terraform -chdir="$TF_DIR" output -json task_definition_families | sed -nE "s/.*\"$NAME\": *\"([^\"]+)\".*/\1/p")"
[ -n "$FAMILY" ] || { echo "unknown task definition key: $NAME（outputs の task_definition_families を参照）" >&2; exit 2; }

if [ -z "$TASK_ARN" ]; then
  echo "== run-task: family=$FAMILY capacity=$CAPACITY cluster=$CLUSTER"
  # --env / --cpu / --memory は run-task の overrides に載せる。コンテナ名はタスク定義で key と同じ（task-definitions.tf）。
  # cpu/memory はタスク定義を登録し直さずに大きさを変える手（#485 の 2 vCPU と 1 vCPU の比較）
  OVERRIDES=""
  [ -n "$ENV_JSON" ] && OVERRIDES="\"containerOverrides\":[{\"name\":\"$NAME\",\"environment\":[$ENV_JSON]}]"
  if [ -n "$CPU_OVERRIDE" ] || [ -n "$MEM_OVERRIDE" ]; then
    [ -n "$CPU_OVERRIDE" ] && [ -n "$MEM_OVERRIDE" ] || { echo "--cpu と --memory は両方指定する" >&2; exit 2; }
    OVERRIDES="${OVERRIDES:+$OVERRIDES,}\"cpu\":\"$CPU_OVERRIDE\",\"memory\":\"$MEM_OVERRIDE\""
  fi
  OVERRIDE_ARGS=()
  [ -n "$OVERRIDES" ] && { OVERRIDE_ARGS=(--overrides "{$OVERRIDES}"); echo "   overrides: {$OVERRIDES}"; }
  # run-task の戻りに失敗理由（quota 超えなど）が入ることがあるので、tasks と failures の両方を見る
  RESULT="$(aws ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$FAMILY" \
    --capacity-provider-strategy "capacityProvider=$CAPACITY,weight=1" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
    --started-by "run-task.sh" \
    --tags "key=Project,value=kimaru-bot" "key=Env,value=poc" "key=ManagedBy,value=run-task.sh" \
    "${OVERRIDE_ARGS[@]}" \
    --query '{tasks: tasks[].taskArn, failures: failures}' --output json)"
  TASK_ARN="$(printf '%s' "$RESULT" | sed -nE 's/.*"(arn:aws:ecs:[^"]+:task\/[^"]+)".*/\1/p' | head -1)"
  if [ -z "$TASK_ARN" ]; then
    echo "run-task failed:" >&2
    printf '%s\n' "$RESULT" >&2
    exit 1
  fi
  echo "task: $TASK_ARN"
  if [ "$WAIT" = 0 ]; then
    echo "started (--no-wait). 後で結果を見る: $0 $NAME --task $TASK_ARN"
    exit 0
  fi
fi
TASK_ID="${TASK_ARN##*/}"

# 止まるまで待つ。aws ecs wait tasks-stopped は 10 分で諦めるので自前でループする
echo "== waiting (timeout ${TIMEOUT}s)"
LAST=""
DEADLINE=$(( $(date +%s) + TIMEOUT ))
while :; do
  STATUS="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].lastStatus' --output text)"
  if [ "$STATUS" != "$LAST" ]; then
    echo "  $(date -u +%H:%M:%SZ) $STATUS"
    LAST="$STATUS"
    # パブリック IP は ENI にしか無く、ENI はタスク停止で消える。走っている間に 1 回だけ引く（rtms の webhook URL 用）
    if [ "$STATUS" = "RUNNING" ]; then
      ENI="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
        --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value | [0]' --output text)"
      [ -n "$ENI" ] && [ "$ENI" != "None" ] && echo "  public IP: $(aws ec2 describe-network-interfaces --network-interface-ids "$ENI" \
        --query 'NetworkInterfaces[0].Association.PublicIp' --output text)  (eni $ENI)"
    fi
  fi
  [ "$STATUS" = "STOPPED" ] && break
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "  timeout: still $STATUS（止めるなら aws ecs stop-task --cluster $CLUSTER --task $TASK_ARN）"; break; fi
  sleep 10
done

echo "== result"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --output table --query 'tasks[0].{
  lastStatus: lastStatus, stopCode: stopCode, stoppedReason: stoppedReason,
  exitCode: containers[0].exitCode, capacityProvider: capacityProviderName, az: availabilityZone,
  cpuArchitecture: attributes[?name==`ecs.cpu-architecture`].value | [0],
  cpu: cpu, memory: memory, privateIp: containers[0].networkInterfaces[0].privateIpv4Address,
  pullStartedAt: pullStartedAt, pullStoppedAt: pullStoppedAt, startedAt: startedAt, stoppedAt: stoppedAt
}'

# 起動〜終了の秒数（課金は pull 開始から停止までなので pullStartedAt を起点にする）
read -r PULL_STARTED STARTED STOPPED < <(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].[pullStartedAt, startedAt, stoppedAt]' --output text)
if [ "$PULL_STARTED" != "None" ] && [ "$STOPPED" != "None" ]; then
  BILL_SEC=$(( $(date -d "$STOPPED" +%s) - $(date -d "$PULL_STARTED" +%s) ))
  echo "billable seconds (pullStartedAt -> stoppedAt): $BILL_SEC"
fi

# ログの末尾。ストリーム名は <stream-prefix>/<container name>/<task id>（container name = key）
CONTAINER="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].name' --output text)"
STREAM="$NAME/$CONTAINER/$TASK_ID"
echo "== log tail: $LOG_GROUP  $STREAM"
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "$STREAM" --limit 50 \
  --query 'events[].[timestamp, message]' --output text 2>/dev/null \
  | while IFS=$'\t' read -r TS MSG; do printf '  %s %s\n' "$(date -u -d "@$((TS/1000))" +%H:%M:%SZ)" "$MSG"; done \
  || echo "  (まだログが無いか、ストリーム名が違う)"

# Container Insights の実測（1 分粒度・反映まで数分かかる）。次元は ClusterName + TaskDefinitionFamily
# なので、同じ family を同時に複数走らせると合算になる。CpuUtilized の単位は CPU unit（1024 = 1 vCPU）、
# MemoryUtilized は MiB
if [ "$STARTED" != "None" ]; then
  START_T="$(date -u -d "@$(( $(date -d "$STARTED" +%s) - 60 ))" +%Y-%m-%dT%H:%M:%SZ)"
  END_EPOCH="$(date +%s)"; [ "$STOPPED" != "None" ] && END_EPOCH=$(( $(date -d "$STOPPED" +%s) + 180 ))
  END_T="$(date -u -d "@$END_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
  echo "== Container Insights (ECS/ContainerInsights, family=$FAMILY, $START_T .. $END_T)"
  for M in CpuUtilized MemoryUtilized; do
    printf '  %-15s ' "$M"
    aws cloudwatch get-metric-statistics --namespace ECS/ContainerInsights --metric-name "$M" \
      --dimensions "Name=ClusterName,Value=$CLUSTER" "Name=TaskDefinitionFamily,Value=$FAMILY" \
      --start-time "$START_T" --end-time "$END_T" --period 60 --statistics Average Maximum \
      --query 'sort_by(Datapoints,&Timestamp)[].join(` `, [to_string(Average), to_string(Maximum)])' --output text \
      | tr '\t' '\n' | awk 'NF{n++; a+=$1; if($2>m)m=$2} END{ if(n==0) print "(no datapoints yet — 数分後にもう一度 --task で見る)"; else printf "avg=%.1f max=%.1f (%d datapoints)\n", a/n, m, n }'
  done

  # 同じ family を並走させると上の指標は合算になるので、performance ログをタスク ID で絞った per-task の値も出す。
  # Logs Insights は非同期（start-query → get-query-results をポーリング）。反映は停止から数分かかることがある
  PERF_GROUP="/aws/ecs/containerinsights/$CLUSTER/performance"
  echo "== per-task (Logs Insights on $PERF_GROUP, TaskId=$TASK_ID)"
  QID="$(aws logs start-query --log-group-name "$PERF_GROUP" \
    --start-time "$(( $(date -d "$STARTED" +%s) - 60 ))" --end-time "$END_EPOCH" \
    --query-string "fields @timestamp, CpuUtilized, MemoryUtilized, CpuReserved, MemoryReserved | filter Type = \"Task\" and TaskId = \"$TASK_ID\" | stats count(*) as samples, avg(CpuUtilized) as cpu_avg, max(CpuUtilized) as cpu_max, max(CpuReserved) as cpu_reserved, avg(MemoryUtilized) as mem_avg, max(MemoryUtilized) as mem_max, max(MemoryReserved) as mem_reserved" \
    --query queryId --output text)"
  for _ in $(seq 1 12); do
    sleep 5
    QSTATUS="$(aws logs get-query-results --query-id "$QID" --query status --output text)"
    [ "$QSTATUS" = "Complete" ] || [ "$QSTATUS" = "Failed" ] || [ "$QSTATUS" = "Cancelled" ] && break
  done
  ROWS="$(aws logs get-query-results --query-id "$QID" --query 'results[0][].join(`=`, [field, value])' --output text)"
  if [ -z "$ROWS" ] || [ "$ROWS" = "None" ]; then
    echo "  (まだ性能ログが無い。数分後に: $0 $NAME --task $TASK_ARN)"
  else
    printf '%s' "$ROWS" | tr '\t' '\n' | sed 's/^/  /'
    echo
  fi
fi
