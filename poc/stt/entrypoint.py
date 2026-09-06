#!/usr/bin/env python
"""Fargate 用の入口（#485）。S3 の音声 1 本を文字起こしして、計測値と出力を S3 に戻す。

流れ:
  1. INPUT_S3_URI（s3://bucket/key）を /data/in へ落とす
  2. transcribe.py（--json-summary）→ check_complete.py（--json）を別プロセスで回す
  3. 計測値（DL 秒・モデル読込秒・文字起こし秒・RTF・ピーク RSS・判定）を timings.json に書き、
     stdout にも 1 行 JSON（先頭 "STT_TIMINGS "）で出す（CloudWatch Logs から拾うため）
  4. 出力ディレクトリを丸ごと s3://$S3_BUCKET/$S3_PREFIX$RUN_ID/ へ上げる

なぜ別プロセスか: transcribe.py が出す peak_rss_mb は「そのプロセスの最大 RSS」なので、
同じプロセスで S3 の読み書きや numpy の音声解析（check_complete）を混ぜると値が汚れる。
transcribe.py / check_complete.py は手元でも使う PoC 本体なので、ここでは呼ぶだけで中身を変えない。

env（タスク定義 infra/poc/task-definitions.tf と run-task.sh の --env で渡す）:
  INPUT_S3_URI       必須。s3://bucket/key（WAV / M4A など PyAV が読めるもの）
  S3_BUCKET          出力先バケット。無ければ S3 へは上げない（手元の docker run 用）
  S3_PREFIX          出力先の接頭辞（既定 "stt/"）。RUN_ID（既定: 起動時刻）をその下に挟む
  RUN_ID             出力先の区別。run-task.sh --env RUN_ID=... で付ける
  STT_MODEL          small（既定）。STT_THREADS は vCPU 数に合わせる（既定 2）
  STT_MODEL_DIR      画像に同梱したモデルの場所（既定 /opt/models。transcribe.py が読む）
  STT_OUT_DIR        出力ディレクトリ（既定 /data/out。書けなければ /tmp/data/out に退避）
  EXPECTED_DURATION  任意。manifest の total_seconds に相当する申告音声長（秒）。check_complete に渡す
"""

from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def log(msg: str) -> None:
    print(f"[stt-entrypoint] {msg}", file=sys.stderr, flush=True)


def writable_dir(preferred: str, fallback: str) -> Path:
    """出力先を決める。Fargate の bind mount（/data）は root 所有で非 root から書けないことがあるので、
    書けなければコンテナ層の /tmp に退避する（一時ストレージ 20 GB の枠は同じ）。"""
    for cand in (preferred, fallback):
        p = Path(cand)
        try:
            p.mkdir(parents=True, exist_ok=True)
            probe = p / ".probe"
            probe.write_text("ok")
            probe.unlink()
            if cand != preferred:
                log(f"{preferred} に書けないので {cand} を使う")
            return p
        except OSError as e:
            log(f"{cand}: 書けない ({e})")
    raise SystemExit("出力先が無い")


def parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise SystemExit(f"INPUT_S3_URI は s3://bucket/key の形にする: {uri}")
    bucket, _, key = uri[5:].partition("/")
    if not bucket or not key:
        raise SystemExit(f"INPUT_S3_URI にバケットかキーが無い: {uri}")
    return bucket, key


def last_json_line(stdout: str) -> dict | None:
    """--json-summary / --json の出力は最終行の JSON。前に何か混ざっても最後の { 行だけ拾う。"""
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                return None
    return None


def main() -> int:
    import boto3  # 起動時に読む（--help 等は無いので遅延させる理由は薄いが、失敗を早く出す）

    env = os.environ
    input_uri = env.get("INPUT_S3_URI", "")
    if not input_uri:
        raise SystemExit("INPUT_S3_URI が無い（run-task.sh --env INPUT_S3_URI=s3://... で渡す）")
    run_id = env.get("RUN_ID") or time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    model = env.get("STT_MODEL", "small")
    threads = int(env.get("STT_THREADS", "2") or 2)
    out_dir = writable_dir(env.get("STT_OUT_DIR", "/data/out"), "/tmp/data/out")
    in_dir = writable_dir(str(out_dir.parent / "in"), "/tmp/data/in")

    s3 = boto3.client("s3", region_name=env.get("AWS_REGION") or None)
    bucket, key = parse_s3_uri(input_uri)
    audio = in_dir / Path(key).name
    t0 = time.perf_counter()
    s3.download_file(bucket, key, str(audio))
    download_s = time.perf_counter() - t0
    size = audio.stat().st_size
    log(f"downloaded {input_uri} → {audio} ({size / 1e6:.1f} MB, {download_s:.1f}s)")

    # ---- 文字起こし ----
    py = sys.executable
    t1 = time.perf_counter()
    tr = subprocess.run(
        [py, str(HERE / "transcribe.py"), str(audio), "--model", model, "--threads", str(threads), "--out-dir", str(out_dir), "--json-summary"],
        capture_output=True,
        text=True,
    )
    transcribe_wall_s = time.perf_counter() - t1
    # transcribe.py の stderr（経過と区間の一覧）はそのままログへ。60 分の音声だと区間が数百行になるので末尾だけ
    tail = tr.stderr.splitlines()[-15:]
    for line in tail:
        log(f"transcribe: {line}")
    summary = last_json_line(tr.stdout) if tr.returncode == 0 else None
    # 子プロセスのピーク RSS（ru_maxrss は KB）。transcribe.py 自身の peak_rss_mb と一致するはずの検算
    children_peak_mb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024.0

    # ---- 完了判定 ----
    verdict: dict | None = None
    check_rc: int | None = None
    if summary and summary.get("segments_path"):
        args = [py, str(HERE / "check_complete.py"), str(audio), summary["segments_path"], "--json"]
        if env.get("EXPECTED_DURATION"):
            args += ["--expected-duration", env["EXPECTED_DURATION"]]
        ck = subprocess.run(args, capture_output=True, text=True)
        check_rc = ck.returncode
        verdict = last_json_line(ck.stdout)
        if ck.stderr.strip():
            log(f"check_complete: {ck.stderr.strip()[-500:]}")

    timings = {
        "run_id": run_id,
        "input": input_uri,
        "input_bytes": size,
        "download_s": round(download_s, 2),
        "model": model,
        "threads": threads,
        "cpu_count": os.cpu_count(),
        "transcribe_exit_code": tr.returncode,
        "transcribe_wall_s": round(transcribe_wall_s, 2),
        # transcribe.py の内訳（音声長・モデル読込・推論・RTF・ピーク RSS）
        "duration_s": summary.get("duration_s") if summary else None,
        "model_load_s": summary.get("model_load_s") if summary else None,
        "transcribe_s": summary.get("transcribe_s") if summary else None,
        "rtf": summary.get("rtf") if summary else None,
        "peak_rss_mb": summary.get("peak_rss_mb") if summary else None,
        "children_peak_rss_mb": round(children_peak_mb, 1),
        "text_chars": len(summary.get("text", "")) if summary else None,
        "check_exit_code": check_rc,
        "verdict": verdict.get("verdict") if verdict else None,
        "coverage": verdict.get("coverage") if verdict else None,
    }
    (out_dir / "timings.json").write_text(json.dumps(timings, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    # CloudWatch Logs から grep で拾う 1 行
    print("STT_TIMINGS " + json.dumps(timings, ensure_ascii=False), flush=True)
    if tr.returncode != 0:
        log(f"transcribe.py が失敗 (exit {tr.returncode}):\n{tr.stderr[-2000:]}")

    # ---- S3 へ ----
    out_bucket = env.get("S3_BUCKET", "")
    if out_bucket:
        prefix = env.get("S3_PREFIX", "stt/")
        if prefix and not prefix.endswith("/"):
            prefix += "/"
        dest = f"{prefix}{run_id}/"
        n = 0
        for f in sorted(out_dir.rglob("*")):
            if f.is_file():
                s3.upload_file(str(f), out_bucket, dest + str(f.relative_to(out_dir)))
                n += 1
        log(f"uploaded {n} files → s3://{out_bucket}/{dest}")
    else:
        log("S3_BUCKET が無いので S3 へは上げない")
    return 0 if tr.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
