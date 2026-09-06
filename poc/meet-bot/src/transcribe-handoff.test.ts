// 文字起こしへの受け渡し: 未設定なら skipped、設定があれば直列に回り、defer なら drain() まで走らない。
// Python の代わりに node と小さなスクリプトを「transcribe.py」として渡す（faster-whisper は要らない）。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TranscribeHandoff } from "./transcribe-handoff.js";
import type { ChunkRecord, TranscriptRecord } from "./wav-writer.js";

function chunk(seq: number): ChunkRecord {
  return { seq, file: `${String(seq).padStart(4, "0")}.wav`, started_at: "", ended_at: null, pcm_bytes: 0, file_bytes: null, duration_seconds: 0, sha256: null };
}

// transcribe.py のふり: 引数の音声と同じ名前の .txt を --out-dir に書き、呼ばれた順を記録する
const FAKE_SCRIPT = `
const [audio, , outDir] = process.argv.slice(2);
const path = require("node:path"); const fs = require("node:fs");
const stem = path.basename(audio, path.extname(audio));
fs.writeFileSync(path.join(outDir, stem + ".txt"), "text " + stem);
fs.appendFileSync(path.join(outDir, "order.log"), stem + "\\n");
`;

test("STT_PYTHON が空なら skipped を返して何も起動しない", () => {
  const results: [number, TranscriptRecord][] = [];
  const h = new TranscribeHandoff({ python: "", script: "/nonexistent", onResult: (s, r) => results.push([s, r]) });
  h.enqueue(chunk(0), "/tmp/0000.wav");
  assert.equal(results[0]?.[1].status, "skipped");
  assert.match(results[0]?.[1].reason ?? "", /STT_PYTHON/);
});

test("直列に回り、.txt があれば done として text_file を返す", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kimaru-stt-test-"));
  const script = path.join(dir, "fake-transcribe.cjs");
  writeFileSync(script, FAKE_SCRIPT);
  for (const seq of [0, 1]) writeFileSync(path.join(dir, chunk(seq).file), "");
  const results = new Map<number, TranscriptRecord>();
  const h = new TranscribeHandoff({ python: process.execPath, script, onResult: (s, r) => results.set(s, r) });
  h.enqueue(chunk(0), path.join(dir, "0000.wav"));
  h.enqueue(chunk(1), path.join(dir, "0001.wav"));
  assert.equal(h.pendingCount, 2);
  await h.drain();
  assert.equal(h.pendingCount, 0);
  assert.equal(results.get(0)?.status, "done");
  assert.equal(results.get(0)?.text_file, "0000.txt");
  assert.equal(results.get(1)?.status, "done");
  assert.equal(readFileSync(path.join(dir, "order.log"), "utf8"), "0000\n0001\n");
  rmSync(dir, { recursive: true, force: true });
});

test("deferUntilDrain: enqueue では走らず、drain() で順に回る", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kimaru-stt-test-"));
  const script = path.join(dir, "fake-transcribe.cjs");
  writeFileSync(script, FAKE_SCRIPT);
  const h = new TranscribeHandoff({ python: process.execPath, script, deferUntilDrain: true });
  h.enqueue(chunk(0), path.join(dir, "0000.wav"));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!existsSync(path.join(dir, "0000.txt")), "drain 前には走らない");
  await h.drain();
  assert.ok(existsSync(path.join(dir, "0000.txt")));
  rmSync(dir, { recursive: true, force: true });
});

test("スクリプトが失敗したら failed と終了コードを記録する", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kimaru-stt-test-"));
  const script = path.join(dir, "fail.cjs");
  writeFileSync(script, 'process.stderr.write("boom\\n"); process.exit(3);');
  const results = new Map<number, TranscriptRecord>();
  const h = new TranscribeHandoff({ python: process.execPath, script, onResult: (s, r) => results.set(s, r) });
  h.enqueue(chunk(0), path.join(dir, "0000.wav"));
  await h.drain();
  assert.equal(results.get(0)?.status, "failed");
  assert.match(results.get(0)?.reason ?? "", /exit=3.*boom/);
  rmSync(dir, { recursive: true, force: true });
});
