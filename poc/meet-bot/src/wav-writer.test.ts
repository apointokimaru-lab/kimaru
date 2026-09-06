// WAV 分割と manifest の固定。実時間は使わず、時計を差し替えて決定的に回す。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pcmRms, readWav, toneMagnitude } from "./pcm-analysis.js";
import { meetingCodeFromUrl, sha256File, WavChunkWriter, type ChunkRecord } from "./wav-writer.js";

function sinePcm(seconds: number, hz: number, sampleRate = 16000, amp = 0.5): Buffer {
  const n = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amp * 32767), i * 2);
  return buf;
}

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "kimaru-wav-test-"));
}

test("chunkSeconds ごとに分割され、端数は最後のチャンクに入る", () => {
  const dir = tmp();
  let t = Date.parse("2026-09-05T10:00:00Z");
  const closed: ChunkRecord[] = [];
  const w = new WavChunkWriter({
    dir,
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    chunkSeconds: 2,
    now: () => new Date(t),
    onChunkClosed: (c) => closed.push({ ...c }),
  });
  // 5 秒ぶんを 0.3 秒刻みで書く（チャンク境界をまたぐ書き込みが起きる）
  const step = sinePcm(0.3, 440);
  for (let i = 0; i < 17; i++) {
    w.write(step);
    t += 300;
  }
  const m = w.close("test");
  assert.equal(m.status, "closed");
  assert.equal(m.end_reason, "test");
  assert.equal(m.chunks.length, 3);
  assert.equal(m.expected_chunks, 3);
  assert.deepEqual(
    m.chunks.map((c) => c.seq),
    [0, 1, 2],
  );
  assert.deepEqual(
    m.chunks.map((c) => c.file),
    ["0000.wav", "0001.wav", "0002.wav"],
  );
  assert.equal(m.chunks[0]?.pcm_bytes, 2 * 16000 * 2);
  assert.equal(m.chunks[1]?.pcm_bytes, 2 * 16000 * 2);
  assert.ok(Math.abs((m.chunks[2]?.duration_seconds ?? 0) - 1.1) < 1e-6);
  assert.ok(Math.abs(m.total_seconds - 5.1) < 1e-6);
  // 閉じたときのコールバックは 3 回（最後の端数は close() で閉じる）
  assert.equal(closed.length, 3);
  // .part は残らない
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".part")), []);
  // 各ファイル: ヘッダ・サンプルレート・長さ・ハッシュが manifest と一致
  for (const c of m.chunks) {
    const file = path.join(dir, c.file);
    const info = readWav(file);
    assert.equal(info.sampleRate, 16000);
    assert.equal(info.channels, 1);
    assert.equal(info.bitsPerSample, 16);
    assert.equal(info.dataBytes, c.pcm_bytes);
    assert.equal(c.file_bytes, 44 + c.pcm_bytes);
    assert.equal(c.sha256, sha256File(file));
    assert.ok(pcmRms(info.pcm) > 10000, "音が入っている");
    assert.ok(toneMagnitude(info.pcm, 440, 16000) > 0.4, "440 Hz が主成分");
  }
  // 時刻は連続している（chunk n の ended_at = chunk n+1 の started_at）
  assert.equal(m.chunks[0]?.ended_at, m.chunks[1]?.started_at);
  // manifest.json は同じ内容
  const onDisk = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as typeof m;
  assert.deepEqual(onDisk, m);
  assert.equal(onDisk.meeting_code, "abc-defg-hij");
  assert.equal(onDisk.capture_generation, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("奇数バイト（半サンプル）は捨てて、サンプル境界を保つ", () => {
  const dir = tmp();
  const w = new WavChunkWriter({ dir, meetingUrl: "x", chunkSeconds: 10 });
  w.write(Buffer.from([1, 0, 2, 0, 3])); // 2.5 サンプル
  const m = w.close();
  assert.equal(m.chunks[0]?.pcm_bytes, 4);
  rmSync(dir, { recursive: true, force: true });
});

test("何も書かずに閉じるとチャンクは 0 本", () => {
  const dir = tmp();
  const w = new WavChunkWriter({ dir, meetingUrl: "x" });
  const m = w.close("nothing");
  assert.equal(m.chunks.length, 0);
  assert.equal(m.expected_chunks, 0);
  assert.ok(existsSync(path.join(dir, "manifest.json")));
  rmSync(dir, { recursive: true, force: true });
});

test("setTranscript はチャンクに載って manifest に書かれる", () => {
  const dir = tmp();
  const w = new WavChunkWriter({ dir, meetingUrl: "x", chunkSeconds: 1 });
  w.write(sinePcm(1.5, 300));
  w.close();
  w.setTranscript(0, { status: "done", text_file: "0000.txt", finished_at: "2026-09-05T00:00:00Z" });
  const onDisk = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { chunks: ChunkRecord[] };
  assert.equal(onDisk.chunks[0]?.transcript?.status, "done");
  assert.equal(onDisk.chunks[1]?.transcript, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("meetingCodeFromUrl", () => {
  assert.equal(meetingCodeFromUrl("https://meet.google.com/abc-defg-hij?authuser=0"), "abc-defg-hij");
  assert.equal(meetingCodeFromUrl("https://meet.google.com/ABC-DEFG-HIJ"), "abc-defg-hij");
  assert.equal(meetingCodeFromUrl("http://127.0.0.1:4321/?tone=440"), "127.0.0.1");
  assert.equal(meetingCodeFromUrl("not a url"), "meeting");
});
