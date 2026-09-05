// 自己診断: 擬似 Meet ページに 440 Hz の音を流し、Bot の取り込み口（AudioCapture → WavChunkWriter）だけを通して、
// 出てきた WAV の RMS と 440 Hz 成分を数える。Google に繋がずに「音が録れる環境か」を確かめる最小の試験。
// cli の selftest と node:test の両方から使う。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { AudioCapture } from "./audio-capture.js";
import type { LogFn } from "./log.js";
import { pcmRms, readWav, toneMagnitude } from "./pcm-analysis.js";
import { WavChunkWriter, type Manifest } from "./wav-writer.js";
import { startFakeMeet } from "../test/fake-meet/server.js";

export interface SelftestOptions {
  seconds?: number;
  toneHz?: number;
  /** 正弦波の代わりに流す WAV（絶対パス）。--media-dir 経由で擬似ページに配る */
  wavFile?: string;
  chunkSeconds?: number;
  /** この ms 後に 660 Hz の 2 本目のトラックを足す（0 で無し） */
  lateMs?: number;
  outDir?: string;
  headless?: boolean;
  channel?: string;
  log?: LogFn;
}

export interface SelftestResult {
  outDir: string;
  manifest: Manifest;
  pcmBytes: number;
  chunksReceived: number;
  audioMode: string | null;
  ctxSampleRate: number | null;
  tracksSeen: number;
  wav: { file: string; sampleRate: number; durationSeconds: number; rms: number; peak: number; tone: number; tone660: number }[];
}

export async function runSelftest(opts: SelftestOptions = {}): Promise<SelftestResult> {
  const log = opts.log ?? (() => {});
  const seconds = opts.seconds ?? 5;
  const toneHz = opts.toneHz ?? 440;
  const outDir = opts.outDir ?? mkdtempSync(path.join(tmpdir(), "kimaru-meet-selftest-"));
  const server = await startFakeMeet({ mediaDir: opts.wavFile ? path.dirname(opts.wavFile) : undefined });
  const profileDir = mkdtempSync(path.join(tmpdir(), "kimaru-meet-selftest-profile-"));
  const params = new URLSearchParams({ autojoin: "1", tone: String(toneHz) });
  if (opts.wavFile) params.set("wav", `/media/${path.basename(opts.wavFile)}`);
  if (opts.lateMs) params.set("late", String(opts.lateMs));
  const url = `${server.url}?${params.toString()}`;

  const audio = new AudioCapture({ log });
  const tracks = new Set<string>();
  audio.onEvent((ev) => {
    if (ev.type === "track_added" && typeof ev.id === "string") tracks.add(ev.id);
  });
  const writer = new WavChunkWriter({ dir: outDir, meetingUrl: url, chunkSeconds: opts.chunkSeconds ?? 2 });
  audio.onPcm((pcm) => writer.write(pcm));

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: opts.headless ?? true,
    channel: opts.channel === "" ? undefined : (opts.channel ?? "chromium"),
    args: ["--autoplay-policy=no-user-gesture-required"],
    bypassCSP: true,
  });
  let audioMode: string | null = null;
  let ctxSampleRate: number | null = null;
  try {
    await audio.install(context);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (m) => log("page_console", { type: m.type(), text: m.text().slice(0, 300) }));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // ループバックが張られるのを少し待ってから取り込みを開始（実際の Bot では in_meeting 判定の後に呼ぶ）
    await page.waitForTimeout(500);
    const stats = await audio.start(page);
    audioMode = stats.mode;
    ctxSampleRate = stats.sampleRate;
    await page.waitForTimeout(seconds * 1000);
    const after = await audio.stats(page);
    log("selftest_stats", { ...after, tracks: after?.tracks.length ?? 0 });
    await audio.stop(page);
  } finally {
    await context.close().catch(() => {});
    await server.close();
  }
  const manifest = writer.close("selftest");
  const wav = manifest.chunks.map((c) => {
    const file = path.join(outDir, c.file);
    const info = readWav(file);
    return {
      file,
      sampleRate: info.sampleRate,
      durationSeconds: info.durationSeconds,
      rms: pcmRms(info.pcm),
      peak: Math.max(...Array.from(info.pcm.subarray(0, Math.min(info.pcm.length, 160000))).map((v) => Math.abs(v)), 0),
      tone: toneMagnitude(info.pcm, toneHz, info.sampleRate),
      tone660: toneMagnitude(info.pcm, 660, info.sampleRate),
    };
  });
  return {
    outDir,
    manifest,
    pcmBytes: audio.bytesReceived,
    chunksReceived: audio.chunksReceived,
    audioMode,
    ctxSampleRate,
    tracksSeen: tracks.size,
    wav,
  };
}
