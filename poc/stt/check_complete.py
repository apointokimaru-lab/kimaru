#!/usr/bin/env python
"""文字起こしの「完了判定」PoC（#393 T-303 の STT 側）。

使い方:
  python check_complete.py <audio> <segments.json> [--expected-duration SEC] [--json]
終了コード: 0 = completed / 1 = completed_with_gaps / 2 = incomplete

なぜ必要か:
  spec FR-3.5〜3.7 は「全区間が成功した会議だけ completed にし、その時点で音声を削除する。一部が
  回収不能なら completed_with_gaps（音声 72 時間保持）、欠損なら incomplete（14 日保持）」と決めている。
  完了条件は「不完全な音声で削除が起きないこと」。つまり判定は **削除してよいかの門番** で、
  迷ったら completed 側に倒してはいけない。manifest（欠番・ハッシュ）の検証は上流のサーバが行うので、
  ここでは manifest を通った音声に対して「文字起こしが音声を取りこぼしていないか」を見る。

何を見るか（ルールは README「完了判定の考え方」と同じ）:
  1. 音声長: --expected-duration（manifest の total_seconds）より 2% 以上短ければ音声そのものが欠けている
     → 文字起こしを何度やり直しても直らないので即 incomplete。
  2. 発話のある時間の被覆率: 音声を 0.5 秒の枠に切り、エネルギー（RMS）が雑音床の 4 倍を超える枠を
     「発話あり」とみなす。発話ありの枠のうち、どこかの区間（前後 0.3 秒の余裕付き）に入っているものの
     割合が coverage。無音の枠は分母に入れない——VAD が無音を落とすと区間の隙間が自然に生まれるので、
     「隙間の長さ」だけで判定すると無音の多い会議が全部 incomplete になってしまう。
  3. 説明のつかない隙間: 区間と区間の隙間（先頭・末尾を含む）が gap-seconds 以上で、その中に 1 秒以上
     「発話あり」があるもの。無音で説明できる隙間は数えない。
  4. 低信頼区間: avg_logprob < -1.0 または no_speech_prob > 0.6。判定は変えず一覧に出す（幻聴の疑い）。
     --strict を付けたときだけ被覆から外す。

判定:
  - 音声長が足りない、または coverage < (1 - max-gap-ratio)（既定 0.90） → incomplete
  - 説明のつかない隙間がある、または coverage < min-coverage（既定 0.95）  → completed_with_gaps
  - それ以外                                                              → completed

TTS の合成音は雑音床がゼロなので閾値はゆるく見えるが、実録音では 10 パーセンタイルの枠 RMS を
雑音床にして相対判定する。実会議音声で閾値を見直す前提（README「残る課題」）。
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np

SR = 16_000
FRAME_S = 0.5
PAD_S = 0.3
MIN_ACTIVE_IN_GAP_S = 1.0
ABS_FLOOR = 0.004  # 無音が完全なゼロ（合成音）のときの最低閾値。int16 換算で約 130
LOW_LOGPROB = -1.0
HIGH_NO_SPEECH = 0.6


@dataclass
class Report:
    verdict: str
    duration_s: float
    expected_duration_s: float | None
    active_s: float
    covered_active_s: float
    coverage: float
    unexplained_gaps: list[dict] = field(default_factory=list)
    low_confidence: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        return {"completed": 0, "completed_with_gaps": 1, "incomplete": 2}[self.verdict]


def load_audio(path: Path) -> np.ndarray:
    """PyAV 経由で 16 kHz mono float32 に復号する（WAV/M4A/MP3 を同じ経路で読む）。"""
    from faster_whisper.audio import decode_audio

    return np.asarray(decode_audio(str(path), sampling_rate=SR), dtype=np.float32)


def load_segments(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    # transcribe.py の出力（計測値付き object）と、区間の配列だけの両方を受ける
    return data["segments"] if isinstance(data, dict) else data


def frame_rms(audio: np.ndarray) -> np.ndarray:
    n = int(FRAME_S * SR)
    total = (len(audio) + n - 1) // n
    padded = np.zeros(total * n, dtype=np.float32)
    padded[: len(audio)] = audio
    return np.sqrt((padded.reshape(total, n) ** 2).mean(axis=1))


def active_frames(audio: np.ndarray) -> np.ndarray:
    """枠ごとの「発話あり」フラグ。雑音床は下位 10% の枠 RMS。"""
    rms = frame_rms(audio)
    floor = float(np.percentile(rms, 10)) if len(rms) else 0.0
    return rms > max(ABS_FLOOR, floor * 4.0)


def evaluate(
    audio: np.ndarray,
    segments: list[dict],
    *,
    expected_duration: float | None = None,
    gap_seconds: float = 5.0,
    min_coverage: float = 0.95,
    max_gap_ratio: float = 0.10,
    strict: bool = False,
) -> Report:
    duration = len(audio) / SR
    active = active_frames(audio)
    n_frames = len(active)
    active_s = float(active.sum()) * FRAME_S

    low_conf = [
        {"start": s["start"], "end": s["end"], "avg_logprob": s.get("avg_logprob"), "no_speech_prob": s.get("no_speech_prob"), "text": s.get("text", "")}
        for s in segments
        if (s.get("avg_logprob") is not None and s["avg_logprob"] < LOW_LOGPROB)
        or (s.get("no_speech_prob") is not None and s["no_speech_prob"] > HIGH_NO_SPEECH)
    ]
    low_keys = {(d["start"], d["end"]) for d in low_conf}
    used = [s for s in segments if not (strict and (s["start"], s["end"]) in low_keys)]

    # 区間で覆われている枠。前後 PAD_S の余裕は、Whisper の区間境界が語頭・語尾より少し内側に
    # 付くことがあるため（それを欠損と数えないため）
    covered = np.zeros(n_frames, dtype=bool)
    for s in used:
        i0 = max(0, int((s["start"] - PAD_S) / FRAME_S))
        i1 = min(n_frames, int(np.ceil((s["end"] + PAD_S) / FRAME_S)))
        covered[i0:i1] = True
    covered_active_s = float((active & covered).sum()) * FRAME_S
    coverage = covered_active_s / active_s if active_s > 0 else 1.0

    # 説明のつかない隙間: 区間列を時間順に見て、先頭〜最初の区間・区間同士・最後の区間〜末尾
    gaps: list[dict] = []
    edges = [0.0] + [t for s in sorted(used, key=lambda s: s["start"]) for t in (s["start"], s["end"])] + [duration]
    for g0, g1 in zip(edges[0::2], edges[1::2]):
        if g1 - g0 < gap_seconds:
            continue
        # 隙間の内側に完全に入る枠だけを見る。区間境界をまたぐ枠には隣の発話の端が入るので、
        # 端の枠まで数えると「無音で説明できる隙間」が毎回 1 秒ぶん誤検出される
        i0 = int(np.ceil((g0 + PAD_S) / FRAME_S))
        i1 = min(n_frames, int((g1 - PAD_S) / FRAME_S))
        active_in_gap = float(active[i0:i1].sum()) * FRAME_S if i1 > i0 else 0.0
        if active_in_gap >= MIN_ACTIVE_IN_GAP_S:
            gaps.append({"start": round(g0, 2), "end": round(g1, 2), "active_s": round(active_in_gap, 1)})

    notes: list[str] = []
    if expected_duration is not None and duration < expected_duration * 0.98 - 1.0:
        verdict = "incomplete"
        notes.append(f"音声長 {duration:.1f}s が申告 {expected_duration:.1f}s より短い（音声自体が欠けている）")
    elif coverage < 1.0 - max_gap_ratio:
        verdict = "incomplete"
        notes.append(f"発話の被覆率 {coverage:.1%} が下限 {1 - max_gap_ratio:.0%} を割った（文字起こしのやり直しが必要）")
    elif gaps or coverage < min_coverage:
        verdict = "completed_with_gaps"
        if gaps:
            notes.append(f"発話があるのに文字が無い隙間が {len(gaps)} か所")
        if coverage < min_coverage:
            notes.append(f"発話の被覆率 {coverage:.1%} が目標 {min_coverage:.0%} 未満")
    else:
        verdict = "completed"
    if active_s < 1.0:
        notes.append("発話がほとんど検出されない（無音の録音か、雑音床の推定が外れている）")
    if low_conf:
        notes.append(f"低信頼の区間 {len(low_conf)} 件（判定には使っていない。幻聴の疑いとして確認する）")

    return Report(
        verdict=verdict,
        duration_s=round(duration, 2),
        expected_duration_s=expected_duration,
        active_s=round(active_s, 1),
        covered_active_s=round(covered_active_s, 1),
        coverage=round(coverage, 4),
        unexplained_gaps=gaps,
        low_confidence=low_conf,
        notes=notes,
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("audio", type=Path)
    p.add_argument("segments", type=Path, help="transcribe.py が書いた <name>.segments.json")
    p.add_argument("--expected-duration", type=float, default=None, help="manifest の total_seconds に相当する申告音声長（秒）")
    p.add_argument("--gap-seconds", type=float, default=5.0, help="この長さ以上の隙間を点検する（既定 5 秒）")
    p.add_argument("--min-coverage", type=float, default=0.95)
    p.add_argument("--max-gap-ratio", type=float, default=0.10, help="被覆率がこれ以上欠けたら incomplete（既定 10%%）")
    p.add_argument("--strict", action="store_true", help="低信頼区間を被覆に数えない")
    p.add_argument("--json", action="store_true", help="結果を JSON で出す")
    a = p.parse_args(argv)

    report = evaluate(
        load_audio(a.audio),
        load_segments(a.segments),
        expected_duration=a.expected_duration,
        gap_seconds=a.gap_seconds,
        min_coverage=a.min_coverage,
        max_gap_ratio=a.max_gap_ratio,
        strict=a.strict,
    )
    if a.json:
        print(json.dumps(asdict(report), ensure_ascii=False, indent=1))
    else:
        print(f"判定        : {report.verdict}")
        print(f"音声長      : {report.duration_s} s" + (f"（申告 {report.expected_duration_s} s）" if report.expected_duration_s else ""))
        print(f"発話あり    : {report.active_s} s  うち文字あり {report.covered_active_s} s  → 被覆率 {report.coverage:.1%}")
        for g in report.unexplained_gaps:
            print(f"  隙間 {g['start']:7.2f} - {g['end']:7.2f} s  発話 {g['active_s']} s なのに文字なし")
        for s in report.low_confidence:
            print(f"  低信頼 {s['start']:7.2f} - {s['end']:7.2f} s  logprob={s['avg_logprob']} no_speech={s['no_speech_prob']}  {s['text']}")
        for n in report.notes:
            print(f"  - {n}")
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
