// 会議の音声を「ページの中」で取り出す。
//
// 方式: ナビゲーション前に注入する初期化スクリプトが RTCPeerConnection と <audio>/<video>.srcObject をフックし、
// 受信した音声トラック（＝他の参加者の声）を 1 つの AudioContext（16 kHz）にまとめ、AudioWorklet で
// Int16 PCM に変換して page.exposeBinding 経由で Node に渡す。
//
// なぜページ内で取るか（PulseAudio 仮想シンク＋ffmpeg ではなく）:
//  - この PC（WSL2・sudo なし）には PulseAudio も ffmpeg も無い。本番の Fargate でも音声デバイスは無い
//  - 仮想シンクは「ブラウザが鳴らした音」を横から録るので、Bot を複数同時に走らせるとシンクを分けないと混ざる
//    （Recall.ai のブログが cross-session contamination と呼んでいる問題）。ページ内なら会議ごとに閉じている
//  - OSS の Meet Bot も主流はページ内方式（Vexa: <audio> 要素 → AudioContext 16 kHz → AudioWorklet、
//    Attendee: RTCPeerConnection の track イベント → MediaStreamTrackProcessor）。README の比較表を参照
// なぜ RTCPeerConnection と srcObject の両方をフックするか: Meet が受信トラックをどう扱うかは公開されていない。
//  PC の track イベントは「受信した瞬間」に全トラックを捕まえられ、srcObject は「Meet が実際に鳴らしているもの」だけを
//  捕まえられる。どちらかが UI 変更で外れても、もう一方が残る（同じ track.id は 1 度しか繋がない）。
// なぜ AudioContext を 16 kHz で作るか: Chromium は MediaStream の入力をコンテキストのレートへ変換するので、
//  ここで 16 kHz を指定すれば自前のリサンプラが要らない。要求と違うレートになったときだけ Node 側で直線補間する。
// なぜトラックが無くても無音を流すか: 「入室してから最初の相手の声まで」も時間軸として残さないと、
//  15 分チャンクの時刻範囲が実時間とずれ、manifest の連続性検証（spec 2.3.4 ④）が通らない。
//  AudioWorklet は入力が無いときも 128 フレームごとに呼ばれるので、そのときは 0 を書く。
// autoplay: AudioContext は本来ユーザー操作まで suspended になりうる。Chromium 起動時に
//  --autoplay-policy=no-user-gesture-required を渡し、さらに start() で resume() を呼ぶ。

import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "playwright";
import type { LogFn } from "./log.js";
import { LinearResampler } from "./resample.js";

/**
 * ページに注入するスクリプト本体（audio-capture.page.js）。文字列で読む。
 * なぜ関数を渡さないか: tsx が関数に `__name` 補助を差し込み、ページ側で未定義になって初期化が黙って失敗するため。
 */
const PAGE_SCRIPT_SOURCE = readFileSync(new URL("./audio-capture.page.js", import.meta.url), "utf8");

/** 注入用の文字列を作る（テストからも呼べるように公開） */
export function buildInitScript(cfg: PageScriptConfig): string {
  // 関数宣言をそのまま置くとページのグローバルに名前が漏れるので、即時関数で包む
  return `(() => {\n${PAGE_SCRIPT_SOURCE}\nkimaruAudioCapture(${JSON.stringify(cfg)});\n})();`;
}

export const PCM_BINDING = "__kimaruPcm";
export const EVENT_BINDING = "__kimaruAudioEvent";

export interface PageScriptConfig {
  sampleRate: number;
  /** 1 回に Node へ送るサンプル数（4096 @16 kHz = 256 ms） */
  chunkFrames: number;
  pcmBinding: string;
  eventBinding: string;
}

export interface TrackStat {
  id: string;
  origin: string;
  readyState: string;
  muted: boolean;
  connected: boolean;
}

export interface AudioStats {
  started: boolean;
  mode: "worklet" | "script_processor" | null;
  ctxState: string | null;
  sampleRate: number | null;
  tracks: TrackStat[];
  samplesOut: number;
  chunksOut: number;
  errors: string[];
}

interface KimaruAudioApi {
  start(): Promise<AudioStats>;
  stop(): Promise<void>;
  stats(): AudioStats;
}

declare global {
  interface Window {
    __kimaruAudio?: KimaruAudioApi;
  }
}

export interface AudioCaptureOptions {
  sampleRate?: number;
  chunkFrames?: number;
  /** この RMS（0〜32767）を超えたら「音がある」とみなす。既定 200 ≈ -44 dBFS */
  activeRmsThreshold?: number;
  log?: LogFn;
}

export type PcmListener = (pcm: Buffer) => void;
export type EventListener = (ev: Record<string, unknown>) => void;

/** Node 側の受け口。exposeBinding で PCM とイベントを受け、リスナーへ流す */
export class AudioCapture {
  readonly sampleRate: number;
  readonly chunkFrames: number;
  bytesReceived = 0;
  chunksReceived = 0;
  lastPcmAt: number | null = null;
  lastActiveAt: number | null = null;
  private readonly threshold: number;
  private readonly log: LogFn;
  private readonly pcmListeners: PcmListener[] = [];
  private readonly eventListeners: EventListener[] = [];
  private resampler: LinearResampler | null = null;

  constructor(opts: AudioCaptureOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 16000;
    this.chunkFrames = opts.chunkFrames ?? 4096;
    this.threshold = opts.activeRmsThreshold ?? 200;
    this.log = opts.log ?? (() => {});
  }

  onPcm(fn: PcmListener): void {
    this.pcmListeners.push(fn);
  }

  onEvent(fn: EventListener): void {
    this.eventListeners.push(fn);
  }

  /** 最近 windowMs の間に無音でない音が来たか（終了検知の inactivity 判定用） */
  audioActiveWithin(windowMs: number, nowMs = Date.now()): boolean {
    return this.lastActiveAt !== null && nowMs - this.lastActiveAt <= windowMs;
  }

  /** ナビゲーション前に呼ぶ。バインディングと初期化スクリプトをコンテキスト全体に仕込む */
  async install(context: BrowserContext): Promise<void> {
    await context.exposeBinding(PCM_BINDING, (_source, b64: string) => this.receive(b64));
    await context.exposeBinding(EVENT_BINDING, (source, json: string) => {
      let ev: Record<string, unknown> = { type: "unparsed", raw: json };
      try {
        ev = JSON.parse(json) as Record<string, unknown>;
      } catch {
        // そのまま
      }
      ev.frame = source.frame.url();
      this.log("audio_event", ev);
      for (const fn of this.eventListeners) fn(ev);
    });
    const cfg: PageScriptConfig = {
      sampleRate: this.sampleRate,
      chunkFrames: this.chunkFrames,
      pcmBinding: PCM_BINDING,
      eventBinding: EVENT_BINDING,
    };
    await context.addInitScript(buildInitScript(cfg));
  }

  async start(page: Page): Promise<AudioStats> {
    const stats = await page.evaluate(() => {
      if (!window.__kimaruAudio) throw new Error("初期化スクリプトが入っていない（install 前に開いたページ）");
      return window.__kimaruAudio.start();
    });
    if (stats.sampleRate !== null && stats.sampleRate !== this.sampleRate) {
      // ブラウザが 16 kHz を受け付けなかった。Node 側で揃える（詳細は resample.ts）
      this.resampler = new LinearResampler(stats.sampleRate, this.sampleRate);
      this.log("audio_resampler_enabled", { from: stats.sampleRate, to: this.sampleRate });
    }
    this.log("audio_started", { ...stats, tracks: stats.tracks.length });
    return stats;
  }

  async stop(page: Page): Promise<void> {
    try {
      await page.evaluate(() => window.__kimaruAudio?.stop());
    } catch {
      // ページが既に閉じている
    }
  }

  async stats(page: Page): Promise<AudioStats | null> {
    try {
      return await page.evaluate(() => window.__kimaruAudio?.stats() ?? null);
    } catch {
      return null;
    }
  }

  private receive(b64: string): void {
    let buf = Buffer.from(b64, "base64");
    if (this.resampler) {
      const int16 = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
      const out = this.resampler.process(int16);
      buf = Buffer.from(out.buffer as ArrayBuffer, out.byteOffset, out.byteLength);
    }
    this.bytesReceived += buf.length;
    this.chunksReceived += 1;
    const now = Date.now();
    this.lastPcmAt = now;
    if (this.rmsOf(buf) > this.threshold) this.lastActiveAt = now;
    for (const fn of this.pcmListeners) fn(buf);
  }

  private rmsOf(buf: Buffer): number {
    const n = Math.floor(buf.length / 2);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = buf.readInt16LE(i * 2);
      sum += v * v;
    }
    return Math.sqrt(sum / n);
  }
}
