#!/usr/bin/env bash
# Zoom RTMS 受信機の Fargate 用入口（#485）。
#
# MODE=server（既定） 受信サーバー（dist/main.mjs）を前面で動かし、止められたら（ECS の SIGTERM）出力を S3 へ上げる。
#                     Zoom の資格情報は SSM から secrets で入る想定（infra/poc/README.md「秘密の入れ方」）。
# MODE=fake-zoom      Zoom 無しで端から端まで: 受信サーバーを裏で起動 → scripts/fake-zoom を同じコンテナで流す →
#                     サーバーを止めて出力を S3 へ。Fargate 上の受信機の CPU・メモリの基礎値を取るため。
#                     FAKE_SECONDS（既定 300）ぶんを FAKE_SPEED（既定 1 = 実時間。10 packets/s）で流す。
#
# 出力は /data/out（タスク定義の bind mount）。root 所有で書けなければ /tmp/data/out に退避する
# （Fargate の空ボリュームは root 所有で非 root から書けないことがある）。
set -euo pipefail

MODE="${MODE:-server}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%d-%H%M%S)}"

pick_out_dir() {
  local d
  for d in "${RTMS_OUT_DIR:-/data/out}" /tmp/data/out; do
    if mkdir -p "$d" 2>/dev/null && [ -w "$d" ]; then echo "$d"; return; fi
    echo "[entrypoint] $d に書けない" >&2
  done
  exit 1
}
OUT_DIR="$(pick_out_dir)"
export RTMS_OUT_DIR="$OUT_DIR"
echo "[entrypoint] mode=$MODE run_id=$RUN_ID out=$OUT_DIR arch=$(uname -m) node=$(node -v)"

upload() {
  if [ -z "${S3_BUCKET:-}" ]; then echo "[entrypoint] S3_BUCKET が無いので S3 へは上げない"; return 0; fi
  local prefix="${S3_PREFIX:-rtms/}"
  case "$prefix" in */|"") ;; *) prefix="$prefix/";; esac
  node /app/scripts/s3.mjs upload "$OUT_DIR" "s3://$S3_BUCKET/${prefix}${RUN_ID}/"
}

case "$MODE" in
  server)
    # SIGTERM を子へ渡し、閉じ切ってから S3 へ。ECS は stopTimeout（既定 30 秒）後に SIGKILL するので、
    # 上げ切れない量なら stopTimeout をタスク定義で伸ばす
    node /app/dist/main.mjs &
    SERVER=$!
    trap 'kill -TERM $SERVER 2>/dev/null || true' TERM INT
    set +e; wait $SERVER; CODE=$?; set -e
    echo "[entrypoint] server exited ($CODE)"
    upload
    exit "$CODE"
    ;;
  fake-zoom)
    # 受信サーバーは必須の資格情報が無いと起動しないので、擬似の値を入れる（fake-zoom は同じ値で署名する）
    export ZOOM_RTMS_CLIENT_ID="${ZOOM_RTMS_CLIENT_ID:-fake-client-id}"
    export ZOOM_RTMS_CLIENT_SECRET="${ZOOM_RTMS_CLIENT_SECRET:-fake-client-secret}"
    export ZOOM_WEBHOOK_SECRET_TOKEN="${ZOOM_WEBHOOK_SECRET_TOKEN:-fake-webhook-token}"
    export PORT="${PORT:-3400}"
    node /app/dist/main.mjs &
    SERVER=$!
    # node:22-slim に curl は無いので Node の fetch で healthz を待つ（最大 10 秒）
    for _ in $(seq 1 50); do
      if node -e "fetch('http://127.0.0.1:$PORT/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then break; fi
      sleep 0.2
    done
    START=$(date +%s)
    set +e
    node /app/dist/fake-zoom.mjs --seconds "${FAKE_SECONDS:-300}" --speed "${FAKE_SPEED:-1}"
    CODE=$?
    set -e
    echo "[entrypoint] fake-zoom exited ($CODE) after $(( $(date +%s) - START ))s"
    kill -TERM $SERVER 2>/dev/null || true
    wait $SERVER || true
    # 計測のまとめ（CloudWatch Logs から 1 行で拾う）
    MANIFEST="$(find "$OUT_DIR" -name manifest.json | head -1)"
    if [ -n "$MANIFEST" ]; then
      node -e '
        const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        console.log("RTMS_RESULT " + JSON.stringify({ run_id: process.argv[2], status: m.status, end_reason: m.end_reason, total_seconds: m.total_seconds, chunks: m.chunks.length, pcm_bytes: m.chunks.reduce((a, c) => a + (c.pcm_bytes || 0), 0), all_hashed: m.chunks.every((c) => !!c.sha256) }));
      ' "$MANIFEST" "$RUN_ID"
    fi
    upload
    exit "$CODE"
    ;;
  *)
    echo "unknown MODE: $MODE（server | fake-zoom）" >&2
    exit 2
    ;;
esac
