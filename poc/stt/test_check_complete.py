"""完了判定のルールを固定する最小テスト（unittest・外部依存なし・音声は合成）。

なぜ: 判定は「音声を削除してよいか」の門番なので、閾値をいじったときに
「発話を取りこぼしているのに completed になる」退行を機械的に止めたい。
実行: .venv/bin/python -m unittest test_check_complete -v
"""

from __future__ import annotations

import unittest

import numpy as np

from check_complete import SR, evaluate

RNG = np.random.default_rng(0)


def speech(sec: float) -> np.ndarray:
    """発話の代わりの雑音（RMS 0.1）。エネルギーがあればよいので中身は問わない。"""
    return (RNG.standard_normal(int(sec * SR)) * 0.1).astype(np.float32)


def silence(sec: float) -> np.ndarray:
    return np.zeros(int(sec * SR), dtype=np.float32)


def seg(start: float, end: float, logprob: float = -0.3, no_speech: float = 0.01) -> dict:
    return {"start": start, "end": end, "text": "x", "avg_logprob": logprob, "no_speech_prob": no_speech}


# 0-10s 発話 / 10-30s 無音 / 30-40s 発話 / 40-42s 無音 / 42-52s 発話 / 52-54s 無音
AUDIO = np.concatenate([speech(10), silence(20), speech(10), silence(2), speech(10), silence(2)])
FULL = [seg(0.2, 9.8), seg(30.1, 39.9), seg(42.0, 51.8)]


class CheckCompleteTest(unittest.TestCase):
    def test_full_transcript_is_completed_even_with_long_silence(self):
        # 20 秒の隙間があっても無音で説明できるので completed
        r = evaluate(AUDIO, FULL)
        self.assertEqual(r.verdict, "completed")
        self.assertEqual(r.unexplained_gaps, [])
        self.assertGreaterEqual(r.coverage, 0.95)

    def test_missing_one_utterance_is_incomplete(self):
        # 真ん中の発話（10 秒 ≒ 33%）が文字になっていない → 被覆率 67% は 90% を割るので incomplete
        r = evaluate(AUDIO, [FULL[0], FULL[2]])
        self.assertEqual(r.verdict, "incomplete")
        self.assertEqual(len(r.unexplained_gaps), 1)

    def test_small_loss_is_completed_with_gaps(self):
        # 末尾 2 秒だけ欠けた（被覆率 ≈93%）→ 削除はできないが要約には回せる completed_with_gaps
        r = evaluate(AUDIO, [FULL[0], FULL[1], seg(42.0, 49.5)])
        self.assertEqual(r.verdict, "completed_with_gaps")

    def test_short_audio_vs_manifest_is_incomplete(self):
        # 文字起こしが完璧でも、manifest より音声が短ければ音声自体の欠損 → incomplete
        r = evaluate(AUDIO, FULL, expected_duration=120.0)
        self.assertEqual(r.verdict, "incomplete")

    def test_low_confidence_is_reported_not_judged(self):
        segs = [FULL[0], FULL[1], seg(42.0, 51.8, logprob=-1.5)]
        r = evaluate(AUDIO, segs)
        self.assertEqual(r.verdict, "completed")
        self.assertEqual(len(r.low_confidence), 1)
        # --strict では低信頼区間を被覆から外すので、判定が下がる
        self.assertNotEqual(evaluate(AUDIO, segs, strict=True).verdict, "completed")

    def test_silent_recording_does_not_crash(self):
        r = evaluate(silence(30), [])
        self.assertEqual(r.verdict, "completed")
        self.assertTrue(any("無音" in n for n in r.notes))


if __name__ == "__main__":
    unittest.main()
