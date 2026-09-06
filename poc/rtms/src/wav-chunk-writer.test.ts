// 合成 PCM で: チャンクの分割（境界をまたぐ書き込み）・WAV ヘッダ・manifest の SHA-256・端数の扱い。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WavChunkWriter, buildWavHeader, safeDirName, type ChunkRecord, type Manifest } from "./wav-chunk-writer";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "rtms-poc-wav-"));
}

/** 決定的な PCM（16-bit LE のサンプル列） */
function pcm(samples: number, seed = 0): Buffer {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(((i * 37 + seed * 101) % 2000) - 1000, i * 2);
  return b;
}

function fakeClock(startMs: number) {
  let t = startMs;
  return {
    now: () => new Date(t),
    tick: (ms: number) => {
      t += ms;
    },
  };
}

test("WAV ヘッダ: 16 kHz mono 16-bit の 44 byte", () => {
  const h = buildWavHeader(32000);
  assert.equal(h.length, 44);
  assert.equal(h.toString("ascii", 0, 4), "RIFF");
  assert.equal(h.readUInt32LE(4), 36 + 32000);
  assert.equal(h.toString("ascii", 8, 12), "WAVE");
  assert.equal(h.toString("ascii", 12, 16), "fmt ");
  assert.equal(h.readUInt32LE(16), 16);
  assert.equal(h.readUInt16LE(20), 1); // PCM
  assert.equal(h.readUInt16LE(22), 1); // mono
  assert.equal(h.readUInt32LE(24), 16000);
  assert.equal(h.readUInt32LE(28), 32000); // byte rate
  assert.equal(h.readUInt16LE(32), 2); // block align
  assert.equal(h.readUInt16LE(34), 16);
  assert.equal(h.toString("ascii", 36, 40), "data");
  assert.equal(h.readUInt32LE(40), 32000);
});

test("分割: 0.5 秒（16000 byte）ごとに切り、境界をまたぐバッファも正しく分かれる", () => {
  const dir = tmpDir();
  const clock = fakeClock(Date.UTC(2026, 8, 5, 10, 0, 0));
  const closed: ChunkRecord[] = [];
  try {
    const w = new WavChunkWriter({
      dir,
      meetingUuid: "uuid/with+slash==",
      streamId: "stream_1",
      chunkSeconds: 0.5,
      now: clock.now,
      onChunkClosed: (c) => closed.push({ ...c }),
    });
    // 作った直後から manifest がある（status recording・chunks 空）
    const m0 = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    assert.equal(m0.status, "recording");
    assert.deepEqual(m0.chunks, []);
    assert.equal(m0.format.sample_rate, 16000);

    // 10000 + 10000 + 12000 + 3200 = 35200 byte → 16000 / 16000 / 3200
    const parts = [pcm(5000, 1), pcm(5000, 2), pcm(6000, 3), pcm(1600, 4)];
    const all = Buffer.concat(parts);
    let ts = 1738392033699;
    for (const p of parts) {
      w.write(p, ts);
      ts += 100;
      clock.tick(100);
    }
    // 2 つ閉じている。3 つ目は書き途中（.part）
    assert.equal(closed.length, 2);
    assert.deepEqual(closed.map((c) => c.seq), [1, 2]);
    assert.ok(existsSync(path.join(dir, "0001.wav")));
    assert.ok(existsSync(path.join(dir, "0002.wav")));
    assert.ok(existsSync(path.join(dir, "0003.wav.part")));
    assert.ok(!existsSync(path.join(dir, "0003.wav")));

    clock.tick(1000);
    const manifest = w.close("test_end");
    assert.equal(manifest.status, "closed");
    assert.equal(manifest.end_reason, "test_end");
    assert.equal(manifest.chunks.length, 3);
    assert.equal(closed.length, 3);
    assert.ok(!existsSync(path.join(dir, "0003.wav.part")));

    // 中身: ヘッダ + 入力の該当スライス
    const expectedSizes = [16000, 16000, 3200];
    let offset = 0;
    manifest.chunks.forEach((c, i) => {
      const size = expectedSizes[i] ?? -1;
      const file = readFileSync(path.join(dir, c.file));
      assert.equal(c.file, `000${i + 1}.wav`);
      assert.equal(c.pcm_bytes, size);
      assert.equal(file.length, 44 + size);
      assert.ok(file.subarray(0, 44).equals(buildWavHeader(size)), `chunk ${c.seq} のヘッダ`);
      assert.ok(file.subarray(44).equals(all.subarray(offset, offset + size)), `chunk ${c.seq} の PCM`);
      offset += size;
      // manifest の SHA-256 はファイル全体（ヘッダ込み）
      assert.equal(c.sha256, createHash("sha256").update(file).digest("hex"));
      assert.equal(c.duration_seconds, size / 32000);
      assert.ok(c.started_at <= (c.ended_at ?? ""), "started_at <= ended_at");
      assert.equal(typeof c.first_packet_ts, "number");
      assert.equal(typeof c.last_packet_ts, "number");
    });
    assert.equal(manifest.total_seconds, 35200 / 32000);
    // 1 つ目のチャンクは 1 パケット目と 2 パケット目にまたがる
    assert.equal(manifest.chunks[0]?.first_packet_ts, 1738392033699);
    assert.equal(manifest.chunks[0]?.last_packet_ts, 1738392033699 + 100);

    // ディスク上の manifest と戻り値が一致し、.tmp が残っていない
    const onDisk = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(manifest)));
    assert.ok(!readdirSync(dir).some((f) => f.endsWith(".tmp")));

    // 閉じた後の write は拒否・2 回目の close は無害
    assert.throws(() => w.write(pcm(10)));
    assert.equal(w.close().status, "closed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("端数: フレーム（2 byte）に満たない末尾は次の write に繰り越し、サンプルをずらさない", () => {
  const dir = tmpDir();
  try {
    const w = new WavChunkWriter({ dir, meetingUuid: "m", streamId: "s", chunkSeconds: 1 });
    const src = pcm(4); // 8 byte
    w.write(src.subarray(0, 3)); // 1.5 サンプル
    w.write(src.subarray(3, 5)); // → 2.5 サンプル
    w.write(src.subarray(5)); // → 4 サンプル
    const m = w.close();
    assert.equal(m.chunks.length, 1);
    const file = readFileSync(path.join(dir, "0001.wav"));
    assert.ok(file.subarray(44).equals(src));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("音が 1 byte も来ずに閉じたら chunks は空のまま（欠番も .part も作らない）", () => {
  const dir = tmpDir();
  try {
    const w = new WavChunkWriter({ dir, meetingUuid: "m", streamId: "s", chunkSeconds: 1 });
    const m = w.close("no_audio");
    assert.deepEqual(m.chunks, []);
    assert.equal(m.status, "closed");
    assert.deepEqual(readdirSync(dir), ["manifest.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateChunk: 文字起こしの結果を台帳に足して書き直す", () => {
  const dir = tmpDir();
  try {
    const w = new WavChunkWriter({ dir, meetingUuid: "m", streamId: "s", chunkSeconds: 1 });
    w.write(pcm(16000));
    w.close();
    w.updateChunk(1, { transcript: { status: "done", text_file: "0001.txt", finished_at: "2026-09-05T00:00:00.000Z" } });
    const onDisk = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    assert.equal(onDisk.chunks[0]?.transcript?.status, "done");
    assert.equal(onDisk.chunks[0]?.transcript?.text_file, "0001.txt");
    w.updateChunk(99, { transcript: { status: "failed", finished_at: "x" } }); // 無い seq は無視
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("safeDirName: base64 の記号を潰し、元の値のハッシュで衝突を避ける", () => {
  const a = safeDirName("TNhvT3WEBT6Srse3TgWRGr==", "rtms_1");
  const b = safeDirName("TNhvT3WEBT6Srse3TgWRGr//", "rtms_1");
  assert.match(a, /^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+__[0-9a-f]{8}$/);
  assert.ok(!a.includes("/"));
  assert.notEqual(a, b, "記号だけ違う UUID が同じディレクトリにならない");
});
