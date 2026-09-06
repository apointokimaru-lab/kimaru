#!/usr/bin/env bash
# Google Meet Bot の Fargate 用入口（#485）。MODE で腕を選び、終わったら出力を S3 へ上げる。
#
# MODE=selftest（既定） 擬似ページに 440 Hz を流して録音の自己診断（cli の selftest）。数秒で終わる疎通確認
# MODE=fake-meet        擬似 Meet に「今すぐ参加」で入り、MEET_FAKE_SECONDS（既定 300）録音して会議終了で退出する
#                       （cli の fake-run）。Google に繋がずに Chromium＋音声取り込みの CPU/メモリの実値を取るため
# MODE=join             本物の Meet。S3 のログイン済みプロファイル（tar.gz）を MEET_PROFILE_DIR に展開してから
#                       MEET_URL に入る。Bot 用 Google アカウントが無い間は使えない（展開する物が無い）
#
# env: S3_BUCKET / S3_PREFIX（出力先）・RUN_ID（出力の区別）・MEET_OUT_DIR（/data/out）・MEET_PROFILE_DIR（/data/profile）
#      MEET_PROFILE_S3_KEY（既定 profiles/meet-bot.tar.gz）・MEET_URL・MEET_GUEST_NAME（未ログインで名前を入れる試験用）
set -euo pipefail

MODE="${MODE:-selftest}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%d-%H%M%S)}"
TSX=/app/node_modules/.bin/tsx

# Fargate の空ボリューム（/data）は root 所有で非 root から書けないことがあるので、書けなければ /tmp/data へ
pick_dir() {
  local d
  for d in "$1" "$2"; do
    if mkdir -p "$d" 2>/dev/null && [ -w "$d" ]; then echo "$d"; return; fi
    echo "[entrypoint] $d に書けない" >&2
  done
  exit 1
}
OUT_DIR="$(pick_dir "${MEET_OUT_DIR:-/data/out}" /tmp/data/out)"
PROFILE_DIR="$(pick_dir "${MEET_PROFILE_DIR:-/data/profile}" /tmp/data/profile)"
export MEET_OUT_DIR="$OUT_DIR" MEET_PROFILE_DIR="$PROFILE_DIR"
echo "[entrypoint] mode=$MODE run_id=$RUN_ID out=$OUT_DIR profile=$PROFILE_DIR arch=$(uname -m) node=$(node -v) cpus=$(nproc)"

upload() {
  if [ -z "${S3_BUCKET:-}" ]; then echo "[entrypoint] S3_BUCKET が無いので S3 へは上げない"; return 0; fi
  local prefix="${S3_PREFIX:-meet/}"
  case "$prefix" in */|"") ;; *) prefix="$prefix/";; esac
  node /app/scripts/s3.mjs upload "$OUT_DIR" "s3://$S3_BUCKET/${prefix}${RUN_ID}/"
}

cd /app
set +e
case "$MODE" in
  selftest)
    "$TSX" src/cli.ts selftest --seconds "${MEET_FAKE_SECONDS:-5}" --out "$OUT_DIR/selftest"
    CODE=$?
    ;;
  fake-meet)
    "$TSX" src/cli.ts fake-run --seconds "${MEET_FAKE_SECONDS:-300}"
    CODE=$?
    ;;
  join)
    if [ -z "${MEET_URL:-}" ]; then echo "MEET_URL が無い" >&2; exit 2; fi
    # ログイン済みプロファイルの復元。無ければ未ログインのまま入って not_logged_in で止まる（結果は残る）
    KEY="${MEET_PROFILE_S3_KEY:-profiles/meet-bot.tar.gz}"
    if [ -n "${S3_BUCKET:-}" ] && node /app/scripts/s3.mjs download "s3://$S3_BUCKET/$KEY" /tmp/profile.tar.gz; then
      tar xzf /tmp/profile.tar.gz -C "$PROFILE_DIR" && rm -f /tmp/profile.tar.gz
      echo "[entrypoint] profile restored → $PROFILE_DIR"
    else
      echo "[entrypoint] profile が S3 に無い（s3://${S3_BUCKET:-?}/$KEY）。未ログインで入る"
    fi
    if [ -n "${MEET_GUEST_NAME:-}" ]; then
      "$TSX" src/cli.ts join --url "$MEET_URL" --guest-name "$MEET_GUEST_NAME"
    else
      "$TSX" src/cli.ts join --url "$MEET_URL" --invited
    fi
    CODE=$?
    ;;
  *)
    echo "unknown MODE: $MODE（selftest | fake-meet | join）" >&2
    exit 2
    ;;
esac
set -e
echo "[entrypoint] $MODE exited ($CODE)"
upload
exit "$CODE"
