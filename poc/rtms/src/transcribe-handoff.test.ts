// 文字起こしへの受け渡し: 偽の transcribe（fixtures/fake-transcribe.mjs）を node で起こして、
// 呼び方・stdout の JSON の読み取り・失敗・未導入時のスキップ・直列実行を確かめる。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { POC_ROOT } from "./config";
import { createTranscribeHandoff } from "./transcribe-handoff";

const FAKE = path.join(POC_ROOT, "fixtures", "fake-transcribe.mjs");

function tmpWav(name = "0001.wav"): { dir: string; wav: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rtms-poc-stt-"));
  const wav = path.join(dir, name);
  writeFileSync(wav, Buffer.alloc(44 + 3200));
  return { dir, wav };
}

test("done: 子プロセスの stdout 最終行の JSON から text を拾い、隣に .txt ができている", async () => {
  const { dir, wav } = tmpWav();
  try {
    const h = createTranscribeHandoff({ python: process.execPath, scriptPath: FAKE, model: "small" });
    assert.equal(h.isAvailable(), true);
    const r = await h.enqueue(wav);
    assert.equal(r.status, "done");
    if (r.status !== "done") return;
    assert.equal(r.text, "これはテストです");
    assert.equal(r.textPath, path.join(dir, "0001.txt"));
    assert.ok(existsSync(r.textPath));
    assert.equal(r.segmentsPath, path.join(dir, "0001.segments.json"));
    assert.equal(r.rtf, 0.1);
    assert.equal(r.durationS, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skipped: STT_PYTHON 未設定、または transcribe.py が無い", async () => {
  const { dir, wav } = tmpWav();
  try {
    const none = createTranscribeHandoff({ python: "", scriptPath: FAKE });
    assert.equal(none.isAvailable(), false);
    const r1 = await none.enqueue(wav);
    assert.equal(r1.status, "skipped");

    const missing = createTranscribeHandoff({ python: process.execPath, scriptPath: path.join(dir, "no-such.py") });
    assert.equal(missing.isAvailable(), false);
    const r2 = await missing.enqueue(wav);
    assert.equal(r2.status, "skipped");
    if (r2.status === "skipped") assert.match(r2.reason, /transcribe\.py が無い/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed: 非 0 終了は failed（stderr を添える）・WAV が無ければ failed", async () => {
  const { dir, wav } = tmpWav();
  process.env["FAKE_STT_EXIT"] = "3";
  try {
    const h = createTranscribeHandoff({ python: process.execPath, scriptPath: FAKE });
    const r = await h.enqueue(wav);
    assert.equal(r.status, "failed");
    if (r.status === "failed") {
      assert.equal(r.reason, "exit 3");
      assert.match(r.stderr ?? "", /わざと失敗/);
    }
    delete process.env["FAKE_STT_EXIT"];
    const missing = await h.enqueue(path.join(dir, "nope.wav"));
    assert.equal(missing.status, "failed");
  } finally {
    delete process.env["FAKE_STT_EXIT"];
    rmSync(dir, { recursive: true, force: true });
  }
});

test("直列: 2 本入れると pending が 2 → 0 になり、両方 done", async () => {
  const a = tmpWav("0001.wav");
  const b = tmpWav("0002.wav");
  try {
    const h = createTranscribeHandoff({ python: process.execPath, scriptPath: FAKE });
    const p1 = h.enqueue(a.wav);
    const p2 = h.enqueue(b.wav);
    assert.equal(h.pending(), 2);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, "done");
    assert.equal(r2.status, "done");
    assert.equal(h.pending(), 0);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
