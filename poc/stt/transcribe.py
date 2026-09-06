#!/usr/bin/env python
"""音声 1 本を faster-whisper（CTranslate2・CPU int8）で文字起こしする PoC（#393 T-302 相当の最小形）。

使い方:
  python transcribe.py path/to/zoom.m4a [--model small|medium|large-v3-turbo] [--lang ja]

書き出し（音声と同じ場所・--out-dir で変更）:
  <name>.segments.json … 区間ごとの start/end/text/avg_logprob/no_speech_prob と計測値
  <name>.txt           … 本文だけ（1 区間 1 行）

なぜこの形か:
- 入力は WAV/M4A/MP3 を受ける。Zoom/Meet の録音は m4a/mp4 なので、WAV 前提にすると本番で詰まる。
  faster-whisper は PyAV で復号するため ffmpeg のバイナリは要らない（この PC には無い）。
- モデルの読み込み時間（＝固定起動費）と推論時間（＝音声長 × RTF）を分けて出す。
  7.2.2 の原価式「固定起動費 + 音声長 × RTF × 単価」に当てはめるため。
- 区間に avg_logprob / no_speech_prob を残すのは、check_complete.py の完了判定（低信頼区間の検出）が使うため。
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# モデル置き場。HF のキャッシュ（~/.cache）ではなく PoC 直下に置いて .gitignore で除外する。
# 本番はイメージ同梱（起動時 DL しない・T-302）なので、その配置に近い形にしておく。
# コンテナ（#485）ではビルド時に /opt/models へ落としてあり、env STT_MODEL_DIR でその場所を指す
# （タスク定義 infra/poc/task-definitions.tf の STT_MODEL_DIR と同じ名前）
MODEL_DIR = Path(os.environ.get("STT_MODEL_DIR") or HERE / ".models")

MODELS = ("tiny", "base", "small", "medium", "large-v3-turbo", "large-v3")


def peak_rss_mb() -> float:
    """このプロセスの最大 RSS（MB）。Linux の ru_maxrss は KB 単位。"""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def transcribe_file(
    audio: Path,
    *,
    model_name: str = "small",
    language: str = "ja",
    compute_type: str = "int8",
    cpu_threads: int = 4,
    vad: bool = True,
    beam_size: int = 5,
) -> dict:
    """1 本を文字起こしして、区間列と計測値を dict で返す（bench.py も同じ関数を使う）。"""
    # import をここに置くのは、--help だけで CTranslate2 を読み込まないため
    from faster_whisper import WhisperModel

    t0 = time.perf_counter()
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type=compute_type,
        cpu_threads=cpu_threads,
        download_root=str(MODEL_DIR),
    )
    model_load_s = time.perf_counter() - t0

    t1 = time.perf_counter()
    # vad_filter: 無音を Silero VAD で落としてから推論する。日本語の Whisper は長い無音で
    # 同じ語句を繰り返す（幻聴）ことがあり、会議録音には無音が多いので既定で有効にする。
    # 落とした無音は区間の隙間として残るので、完了判定側で「無音で説明できる隙間」として扱う
    segments_iter, info = model.transcribe(
        str(audio),
        language=language,
        beam_size=beam_size,
        vad_filter=vad,
        # 直前の出力を次の窓の prompt に使わない。日本語で繰り返し（ループ）を誘発しやすいため
        condition_on_previous_text=False,
    )
    # transcribe() は generator で、実際の推論は列挙したときに走る。ここで全部回して時間を測る
    segments = [
        {
            "id": s.id,
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": s.text.strip(),
            "avg_logprob": round(s.avg_logprob, 4),
            "no_speech_prob": round(s.no_speech_prob, 4),
        }
        for s in segments_iter
    ]
    transcribe_s = time.perf_counter() - t1

    duration = float(info.duration)
    return {
        "audio": str(audio),
        "model": model_name,
        "compute_type": compute_type,
        "device": "cpu",
        "cpu_threads": cpu_threads,
        "language": info.language,
        "language_probability": round(float(info.language_probability), 4),
        "vad_filter": vad,
        "duration_s": round(duration, 3),
        "model_load_s": round(model_load_s, 3),
        "transcribe_s": round(transcribe_s, 3),
        # RTF（実時間比）= 処理時間 ÷ 音声長。1.0 なら音声と同じ長さだけかかる。NFR は ≤0.25
        "rtf": round(transcribe_s / duration, 4) if duration > 0 else None,
        "peak_rss_mb": round(peak_rss_mb(), 1),
        "segments": segments,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("audio", type=Path, help="WAV / M4A / MP3 など（PyAV が読める形式）")
    p.add_argument("--model", default="small", choices=MODELS)
    p.add_argument("--lang", default="ja", help="言語コード。省略時 ja（自動判定はしない）")
    p.add_argument("--compute", default="int8", help="CTranslate2 の compute_type（CPU は int8 が最速）")
    p.add_argument("--threads", type=int, default=4, help="CPU スレッド数（この PC は 8 コアだが他の作業と同居するため既定 4）")
    p.add_argument("--no-vad", action="store_true", help="VAD で無音を落とさない")
    p.add_argument("--out-dir", type=Path, default=None, help="書き出し先（既定: 音声と同じディレクトリ）")
    p.add_argument("--tag", default=None, help="出力名に挟む識別子（例: --tag small → <name>.small.segments.json）")
    p.add_argument("--json-summary", action="store_true", help="最後に計測値の JSON を 1 行で stdout に出す（bench.py 用）")
    a = p.parse_args(argv)

    if not a.audio.exists():
        print(f"音声が見つかりません: {a.audio}", file=sys.stderr)
        return 2

    result = transcribe_file(
        a.audio,
        model_name=a.model,
        language=a.lang,
        compute_type=a.compute,
        cpu_threads=a.threads,
        vad=not a.no_vad,
    )

    out_dir = a.out_dir or a.audio.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = a.audio.stem + (f".{a.tag}" if a.tag else "")
    seg_path = out_dir / f"{stem}.segments.json"
    txt_path = out_dir / f"{stem}.txt"
    seg_path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    txt_path.write_text("".join(s["text"] + "\n" for s in result["segments"]), encoding="utf-8")

    print(f"モデル        : {result['model']} / {result['compute_type']} / cpu x{result['cpu_threads']}", file=sys.stderr)
    print(f"音声長        : {result['duration_s']:.1f} s", file=sys.stderr)
    print(f"モデル読み込み: {result['model_load_s']:.1f} s", file=sys.stderr)
    print(f"文字起こし    : {result['transcribe_s']:.1f} s  (RTF {result['rtf']:.3f})", file=sys.stderr)
    print(f"ピーク RSS    : {result['peak_rss_mb']:.0f} MB", file=sys.stderr)
    print(f"区間数        : {len(result['segments'])}  → {seg_path}", file=sys.stderr)
    for s in result["segments"]:
        print(f"[{s['start']:7.2f} - {s['end']:7.2f}] {s['text']}", file=sys.stderr)

    if a.json_summary:
        summary = {k: v for k, v in result.items() if k != "segments"}
        summary["segments_path"] = str(seg_path)
        summary["text"] = "".join(s["text"] for s in result["segments"])
        print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
