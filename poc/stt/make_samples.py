#!/usr/bin/env python
"""テスト音声を合成する（pyopenjtalk = Open JTalk 同梱の日本語 TTS・オフライン）。

なぜ: この PC には TTS も ffmpeg も無く、実会議の録音も手元に無い。正解テキストが分かっている
音声が無いと認識精度（CER・固有名詞の誤り数）が数えられないので、会議風の短い発話を合成して
「期待テキスト」と一緒に置く（#393 T-304「品質評価の手順を先に決める」）。

何を: samples/ に 16 kHz / mono / int16 の WAV と、採点用の期待テキスト・固有名詞リストを書く。
  - meeting_short.wav … 6 発話（2 話者を声の高さで区別）・発話間に 1〜2 秒の間
  - meeting_gap.wav   … 同じ発話列の途中に 20 秒の無音を挟む（完了判定の「無音で説明できる隙間」の確認用）
音声は決定的（Open JTalk は同じ入力で同じ波形）なので WAV は commit せず、必要なときに再生成する。
"""

from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np
import pyopenjtalk

HERE = Path(__file__).resolve().parent
SAMPLES = HERE / "samples"
TARGET_SR = 16_000

# (話者, TTS に読ませる文, 採点に使う期待テキスト)
# 期待テキストは Whisper が出す書き方（アラビア数字）に寄せる。TTS 入力は読みが安定する漢数字にする。
SCRIPT: list[tuple[str, str, str]] = [
    (
        "A",
        "本日はお時間をいただき、ありがとうございます。キマルの佐藤です。",
        "本日はお時間をいただき、ありがとうございます。キマルの佐藤です。",
    ),
    (
        "B",
        "よろしくお願いします。高橋です。今日は来月のキャンペーンについて相談したいと思っています。",
        "よろしくお願いします。高橋です。今日は来月のキャンペーンについて相談したいと思っています。",
    ),
    (
        "A",
        "承知しました。まず、前回の打ち合わせで出た課題を確認させてください。予約ページの公開が十月十五日にずれ込んでいましたね。",
        "承知しました。まず、前回の打ち合わせで出た課題を確認させてください。予約ページの公開が10月15日にずれ込んでいましたね。",
    ),
    (
        "B",
        "はい。デザインの修正に時間がかかりました。ただ、渋谷のイベント会場はもう押さえてあります。",
        "はい。デザインの修正に時間がかかりました。ただ、渋谷のイベント会場はもう押さえてあります。",
    ),
    (
        "A",
        "ありがとうございます。では、次回の打ち合わせは来週の火曜日、午後三時からでいかがでしょうか。",
        "ありがとうございます。では、次回の打ち合わせは来週の火曜日、午後3時からでいかがでしょうか。",
    ),
    (
        "B",
        "火曜日で大丈夫です。議事録は後ほどメールでお送りします。",
        "火曜日で大丈夫です。議事録は後ほどメールでお送りします。",
    ),
]

# 固有名詞・数値の採点リスト。各項目は「どれか 1 つ含まれていれば正解」とみなす表記の候補。
# 数字は Whisper が漢数字／アラビア数字のどちらで出しても誤りにしない。
TERMS: list[list[str]] = [
    ["キマル"],
    ["佐藤"],
    ["高橋"],
    ["渋谷"],
    ["10月15日", "十月十五日"],
    ["火曜日"],
    ["午後3時", "午後三時"],
]

# 声の高さ（半音）で話者を分ける。Open JTalk の既定音声は 1 つなので、これが唯一の区別手段
VOICE = {"A": 0.0, "B": -4.0}


def synth(text: str, half_tone: float) -> np.ndarray:
    """1 発話を合成して 16 kHz float32 [-1, 1] に落とす。"""
    x, sr = pyopenjtalk.tts(text, half_tone=half_tone)  # 48 kHz・int16 相当の float64
    x = x.astype(np.float32) / 32768.0
    # 48000 → 16000 は整数比 3 なので、3 サンプル平均（箱型ローパス）してから間引く。
    # scipy を入れないための簡易法。音声帯域は 8 kHz 以下に大半があるので PoC には十分
    assert sr % TARGET_SR == 0, sr
    k = sr // TARGET_SR
    n = len(x) - len(x) % k
    return x[:n].reshape(-1, k).mean(axis=1)


def silence(sec: float) -> np.ndarray:
    return np.zeros(int(sec * TARGET_SR), dtype=np.float32)


def build(gap_after: int | None, gap_sec: float) -> np.ndarray:
    """発話を間（1.2〜1.8 秒）を挟んで並べる。gap_after 番目の発話の後にだけ長い無音を入れる。"""
    parts = [silence(0.8)]
    for i, (spk, tts_text, _expected) in enumerate(SCRIPT):
        parts.append(synth(tts_text, VOICE[spk]))
        parts.append(silence(gap_sec if gap_after == i else 1.2 + 0.3 * (i % 3)))
    parts.append(silence(0.8))
    return np.concatenate(parts)


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = np.clip(x * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TARGET_SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    SAMPLES.mkdir(exist_ok=True)
    expected = "".join(e for _s, _t, e in SCRIPT)
    for name, audio in (
        ("meeting_short", build(gap_after=None, gap_sec=0)),
        ("meeting_gap", build(gap_after=2, gap_sec=20.0)),
    ):
        write_wav(SAMPLES / f"{name}.wav", audio)
        (SAMPLES / f"{name}.expected.txt").write_text(expected + "\n", encoding="utf-8")
        (SAMPLES / f"{name}.terms.json").write_text(
            json.dumps(TERMS, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        print(f"{name}.wav  {len(audio) / TARGET_SR:6.1f} s  {SAMPLES / name}.wav")


if __name__ == "__main__":
    main()
