// 擬似 Meet ページに対してヘッドレス Chromium を起動し、録音の取り込みと Bot の全経路をオフラインで固定する。
// メモリの都合で Chromium は同時に 1 つ（package.json の --test-concurrency=1 と、この中の直列実行）。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { BotConfig } from "../../src/config.js";
import { runBot, type JoinResult } from "../../src/join.js";
import { runSelftest } from "../../src/selftest.js";
import type { Manifest } from "../../src/wav-writer.js";
import { startFakeMeet } from "./server.js";

const CHANNEL = process.env.MEET_BROWSER_CHANNEL ?? "chromium";

function tmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function botConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    profileDir: tmp("kimaru-meet-test-profile-"),
    outDir: tmp("kimaru-meet-test-out-"),
    maxSeconds: 4 * 3600,
    waitingRoomSeconds: 30,
    aloneSeconds: 2,
    inactivitySeconds: 60,
    chunkSeconds: 2,
    sttPython: "",
    sttScript: "/nonexistent/transcribe.py",
    sttArgs: [],
    sttWhen: "after",
    headless: true,
    browserChannel: CHANNEL,
    fakeDevices: false,
    ...overrides,
  };
}

test("録音: ループバックの 440 Hz が 16 kHz WAV に 2 秒ごとに分割され、途中参加のトラック（660 Hz）も混ざる", { timeout: 90_000 }, async () => {
  const r = await runSelftest({ seconds: 6, toneHz: 440, lateMs: 2500, chunkSeconds: 2, channel: CHANNEL });
  try {
    assert.equal(r.audioMode, "worklet", "AudioWorklet で動く（ScriptProcessor に落ちていない）");
    assert.equal(r.ctxSampleRate, 16000, "AudioContext が 16 kHz で作れた");
    assert.equal(r.tracksSeen, 2, "最初のトラックと後から足したトラックの両方を捕まえた");
    assert.ok(r.pcmBytes >= 16000 * 2 * 4.5, `PCM が 4.5 秒以上届いた（${r.pcmBytes} bytes）`);
    assert.ok(r.wav.length >= 3, `チャンクが 3 本以上（${r.wav.length}）`);
    for (const w of r.wav) assert.equal(w.sampleRate, 16000);
    assert.ok(Math.abs((r.wav[0]?.durationSeconds ?? 0) - 2) < 1e-6, "1 本目はちょうど 2 秒");
    // 先頭チャンク: 440 Hz あり、660 Hz はまだ無い
    assert.ok((r.wav[0]?.rms ?? 0) > 2000, `音が入っている（RMS ${r.wav[0]?.rms}）`);
    assert.ok((r.wav[0]?.tone ?? 0) > 0.1, `440 Hz が立つ（${r.wav[0]?.tone}）`);
    assert.ok((r.wav[0]?.tone660 ?? 1) < 0.1, `660 Hz はまだ無い（${r.wav[0]?.tone660}）`);
    // 2 本目以降: 660 Hz も立つ
    const later = r.wav.slice(1, 3);
    assert.ok(later.some((w) => w.tone660 > 0.1), `後半に 660 Hz が混ざる（${later.map((w) => w.tone660).join(",")}）`);
    // manifest: ハッシュとサイズが実ファイルと一致（サーバ側再検証の前提）
    const m = r.manifest;
    assert.equal(m.status, "closed");
    assert.equal(m.format.sample_rate, 16000);
    for (const c of m.chunks) {
      assert.ok(c.sha256 && c.sha256.length === 64);
      assert.equal(c.file_bytes, 44 + c.pcm_bytes);
    }
  } finally {
    rmSync(r.outDir, { recursive: true, force: true });
  }
});

async function runAgainstFake(query: Record<string, string>, cfg: BotConfig, extra: Partial<Parameters<typeof runBot>[1]> = {}): Promise<JoinResult> {
  const server = await startFakeMeet();
  try {
    const url = `${server.url}?${new URLSearchParams(query).toString()}`;
    return await runBot(cfg, { url, mode: "invited", pollMs: 1000, screenshots: false, ...extra });
  } finally {
    await server.close();
    rmSync(cfg.profileDir, { recursive: true, force: true });
  }
}

test("Bot 全経路: 今すぐ参加 → 録音 → 相手が退出（Bot だけ）→ everyone_left で退出。manifest と result.json が残る", { timeout: 120_000 }, async () => {
  const cfg = botConfig();
  const r = await runAgainstFake({ tone: "440", participants: "2", end: "alone", after: "4000" }, cfg);
  try {
    assert.equal(r.join_button_seen, "join_now");
    assert.deepEqual(
      r.transitions.map((t) => t.state),
      ["launching", "joining", "in_meeting", "leaving", "meeting_ended"],
    );
    assert.equal(r.end_reason, "everyone_left");
    assert.ok((r.in_meeting_seconds ?? 0) >= 5, `在室 ${r.in_meeting_seconds} 秒（退出まで after 4 秒 + alone 2 秒）`);
    assert.ok(r.audio.bytes > 16000 * 2 * 4, `PCM ${r.audio.bytes} bytes`);
    assert.equal(r.audio.mode, "worklet");
    assert.ok(r.manifest && r.manifest.chunks.length >= 2, "2 秒チャンクが 2 本以上");
    assert.equal(r.manifest?.status, "closed");
    assert.equal(r.manifest?.end_reason, "everyone_left");
    // STT 未設定なら全チャンク skipped と記録される
    assert.ok(r.manifest?.chunks.every((c) => c.transcript?.status === "skipped"));
    assert.ok(existsSync(path.join(r.out_dir, "result.json")));
    assert.ok(existsSync(path.join(r.out_dir, "events.jsonl")));
    const onDisk = JSON.parse(readFileSync(path.join(r.out_dir, "manifest.json"), "utf8")) as Manifest;
    assert.equal(onDisk.chunks.length, r.manifest?.chunks.length);
    // マイク・カメラを切っている
    const events = readFileSync(path.join(r.out_dir, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const toggles = events.filter((e) => e.event === "device_toggle").map((e) => `${e.device}:${e.result}`);
    assert.deepEqual(toggles.sort(), ["cam:turned_off", "mic:turned_off"]);
  } finally {
    rmSync(cfg.outDir, { recursive: true, force: true });
  }
});

test("退出させられた文言が出たら removed で終わる", { timeout: 120_000 }, async () => {
  const cfg = botConfig({ aloneSeconds: 600 });
  const r = await runAgainstFake({ participants: "2", end: "removed", after: "3000" }, cfg);
  try {
    assert.equal(r.final_state, "removed");
    assert.equal(r.end_reason, "removed");
    assert.ok(r.manifest && r.manifest.chunks.length >= 1);
  } finally {
    rmSync(cfg.outDir, { recursive: true, force: true });
  }
});

test("参加をリクエスト → 待機室 → 承認 → 入室（waiting_room を経る）", { timeout: 120_000 }, async () => {
  const cfg = botConfig();
  const r = await runAgainstFake({ prejoin: "ask", admit: "2500", participants: "2", end: "ended", after: "3000" }, cfg);
  try {
    assert.equal(r.join_button_seen, "ask_to_join");
    assert.ok(r.transitions.some((t) => t.state === "waiting_room"));
    assert.ok((r.waiting_room_seconds ?? 0) >= 2, `待機 ${r.waiting_room_seconds} 秒`);
    assert.equal(r.final_state, "meeting_ended");
    assert.equal(r.end_reason, "meeting_ended");
  } finally {
    rmSync(cfg.outDir, { recursive: true, force: true });
  }
});

test("参加をリクエスト → 拒否 → denied で止まり、録音しない", { timeout: 120_000 }, async () => {
  const cfg = botConfig();
  const r = await runAgainstFake({ prejoin: "ask", end: "denied", after: "1500" }, cfg);
  try {
    assert.equal(r.join_button_seen, "ask_to_join");
    assert.equal(r.final_state, "denied");
    assert.equal(r.end_reason, "denied");
    assert.equal(r.manifest, null);
    assert.equal(r.audio.bytes, 0);
  } finally {
    rmSync(cfg.outDir, { recursive: true, force: true });
  }
});
