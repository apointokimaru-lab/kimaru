#!/usr/bin/env python
"""CPU ベンチマーク（#393 T-304 のこの PC でできる範囲）: small / medium を同じ音声で比べて Markdown 表を出す。

使い方:
  python bench.py [--models small medium] [--samples samples/meeting_short.wav ...] [--out bench_result.md]

なぜ子プロセスで回すか:
  ピーク RSS（ru_maxrss）はプロセス単位の「最大値」なので、同じプロセスで small → medium と回すと
  medium の値に small の分が混ざる。モデルごとに transcribe.py を別プロセスで起動し、
  その --json-summary を受け取る。モデル読み込み時間（固定起動費）も同じ理由で毎回まっさらに測れる。

品質の数え方（T-304「品質評価の手順を先に決める」）:
  - CER（文字誤り率）: 句読点・空白を除いた期待テキストとの編集距離 ÷ 期待文字数
  - 固有名詞の誤り数: samples/<name>.terms.json の各項目について、候補表記のどれも出力に無ければ 1 誤り
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent

# medium int8 は読み込みだけで 1.5 GB 前後、推論中に 2 GB を超える。他の作業と同居するこの PC では
# 空きがこれを割っていたら飛ばす（スワップに落ちると RTF が意味を失う）
MEM_GUARD_GB = {"small": 1.5, "medium": 3.0, "large-v3-turbo": 4.0, "large-v3": 6.0}

PUNCT = re.compile(r"[\s、。，．,.!?！？「」『』（）()・…〜~：:；;\-—]+")


def normalize(text: str) -> str:
    return PUNCT.sub("", text)


def levenshtein(a: str, b: str) -> int:
    """短い日本語文（数百文字）向けの素朴な DP。ライブラリを増やさないため"""
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(expected: str, hyp: str) -> float:
    e, h = normalize(expected), normalize(hyp)
    return levenshtein(e, h) / max(1, len(e))


def term_errors(terms: list[list[str]], hyp: str) -> list[str]:
    h = normalize(hyp)
    return ["/".join(t) for t in terms if not any(normalize(v) in h for v in t)]


def run_one(audio: Path, model: str, threads: int) -> dict | None:
    avail_gb = psutil.virtual_memory().available / 2**30
    need = MEM_GUARD_GB.get(model, 3.0)
    if avail_gb < need:
        print(f"skip {model}: 空きメモリ {avail_gb:.1f} GB < {need} GB", file=sys.stderr)
        return {"model": model, "skipped": f"空きメモリ {avail_gb:.1f} GB < {need} GB"}
    cmd = [sys.executable, str(HERE / "transcribe.py"), str(audio), "--model", model, "--threads", str(threads), "--tag", model, "--json-summary"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return {"model": model, "skipped": f"transcribe.py が失敗（exit {proc.returncode}）"}
    return json.loads(proc.stdout.strip().splitlines()[-1])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--models", nargs="+", default=["small", "medium"])
    p.add_argument("--samples", nargs="+", type=Path, default=[HERE / "samples" / "meeting_short.wav"])
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--out", type=Path, default=None, help="Markdown を書き出すファイル（省略時は stdout のみ）")
    a = p.parse_args(argv)

    from check_complete import evaluate, load_audio, load_segments

    rows: list[str] = []
    details: list[str] = []
    cpu = f"{psutil.cpu_count(logical=True)} 論理コア / 使用 {a.threads} スレッド / RAM {psutil.virtual_memory().total / 2**30:.1f} GB"
    for audio in a.samples:
        expected_path = audio.with_suffix("").with_suffix(".expected.txt")
        terms_path = audio.with_suffix("").with_suffix(".terms.json")
        expected = expected_path.read_text(encoding="utf-8").strip() if expected_path.exists() else None
        terms = json.loads(terms_path.read_text(encoding="utf-8")) if terms_path.exists() else []
        for model in a.models:
            r = run_one(audio, model, a.threads)
            if r is None or "skipped" in r:
                rows.append(f"| {model} / int8 / CPU | {audio.name} | — | — | — | — | — | — | {r['skipped'] if r else '失敗'} |")
                continue
            hyp = r["text"]
            verdict = evaluate(load_audio(audio), load_segments(Path(r["segments_path"]))).verdict
            q = ""
            if expected is not None:
                errs = term_errors(terms, hyp)
                q = f"CER {cer(expected, hyp):.1%} / 固有名詞誤り {len(errs)}/{len(terms)}" + (f"（{'、'.join(errs)}）" if errs else "")
            one_hour_min = (r["model_load_s"] + 3600 * r["rtf"]) / 60
            rows.append(
                f"| {model} / int8 / CPU | {audio.name}（{r['duration_s']:.0f}s） | {r['model_load_s']:.1f}s | {r['transcribe_s']:.1f}s | "
                f"**{r['rtf']:.3f}** | {r['peak_rss_mb']:.0f} MB | {one_hour_min:.0f} 分 | {verdict} | {q} |"
            )
            details.append(f"### {model} × {audio.name}\n\n```text\n{hyp}\n```\n")

    header = (
        f"環境: {cpu}（WSL2・GPU なし）\n\n"
        "| 構成 | 音声 | モデル読込 | 文字起こし | RTF | ピーク RSS | 1時間会議の見込み | 完了判定 | 精度 |\n"
        "|---|---|---:|---:|---:|---:|---:|---|---|\n"
    )
    md = header + "\n".join(rows) + "\n\n" + "\n".join(details)
    if expected is not None:
        md += f"\n期待テキスト:\n\n```text\n{expected}\n```\n"
    print(md)
    if a.out:
        a.out.write_text(md, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
