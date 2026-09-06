import assert from "node:assert/strict";
import { test } from "node:test";
import { pcmRms, toneMagnitude } from "./pcm-analysis.js";
import { LinearResampler } from "./resample.js";

function sine(seconds: number, hz: number, rate: number): Int16Array {
  const n = Math.round(seconds * rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 16000);
  return out;
}

test("48 kHz → 16 kHz で長さが 1/3 になり、440 Hz が保たれる（分割入力でも境界が繋がる）", () => {
  const r = new LinearResampler(48000, 16000);
  const src = sine(2, 440, 48000);
  const parts: Int16Array[] = [];
  for (let i = 0; i < src.length; i += 4096) parts.push(r.process(src.subarray(i, i + 4096)));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  assert.ok(Math.abs(out.length - 32000) <= 2, `length ${out.length}`);
  assert.ok(toneMagnitude(out, 440, 16000) > 0.45, "440 Hz が主成分");
  assert.ok(toneMagnitude(out, 1320, 16000) < 0.02, "分割境界のクリックで倍音が立っていない");
  assert.ok(Math.abs(pcmRms(out) - 16000 / Math.SQRT2) < 300);
});

test("同じレートなら素通し", () => {
  const r = new LinearResampler(16000, 16000);
  const src = sine(0.1, 440, 16000);
  assert.equal(r.process(src), src);
});
