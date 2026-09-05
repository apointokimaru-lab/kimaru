// WAV／PCM を読んで数値にする補助（テストと selftest 用）。録音の本流では使わない。

import { readFileSync } from "node:fs";

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
  pcm: Int16Array;
}

/** 44 byte ヘッダの PCM WAV を読む（buildWavHeader が書く形だけを想定） */
export function readWav(file: string): WavInfo {
  const buf = readFileSync(file);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`WAV ではない: ${file}`);
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  const body = buf.subarray(44, 44 + dataBytes);
  const pcm = new Int16Array(body.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = body.readInt16LE(i * 2);
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
    pcm,
  };
}

/** 実効値（0〜32767 のスケール） */
export function pcmRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function pcmPeak(samples: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > peak) peak = v;
  }
  return peak;
}

/**
 * Goertzel 法で単一周波数の振幅を測る。返り値はフルスケール比（振幅 A の正弦波なら ≈ A/32767）。
 * なぜ: サンプルレートの取り違え（48 kHz を 16 kHz と書く等）は RMS では見えないが、
 * 440 Hz の音を入れて 440 Hz に山が立つかを見れば一発で分かる。
 */
export function toneMagnitude(samples: Int16Array, freqHz: number, sampleRate: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  const k = Math.round((n * freqHz) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = (samples[i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return (Math.sqrt(real * real + imag * imag) * 2) / n / 32767;
}
