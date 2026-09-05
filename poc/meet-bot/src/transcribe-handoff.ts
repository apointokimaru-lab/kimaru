// 閉じた WAV チャンクを #393 の文字起こし PoC（poc/stt/transcribe.py）へ渡す。
//
// なぜ別プロセスで、1 本ずつか: faster-whisper（small・int8）はピーク 1.3 GB を使う（PR #474 の計測）。
// Chromium と同居するこの PC では並列にすると足りないので、キューに積んで直列に回す。
// なぜチャンク単位か: 本番設計（FR-3.2）が「15 分セグメントごとに文字起こしし、失敗したものだけやり直す」ため。
// 会議が終わる前から文字起こしが始まるので、終了後の待ち時間も短くなる。
// Python や transcribe.py が無ければ黙って skipped にする（録音は文字起こしの有無と無関係に成立させる）。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { LogFn } from "./log.js";
import type { ChunkRecord, TranscriptRecord } from "./wav-writer.js";

export interface TranscribeHandoffOptions {
  /** Python の実行ファイル。空なら文字起こしを飛ばす */
  python: string;
  /** transcribe.py の絶対パス */
  script: string;
  /** transcribe.py に足す引数（--model small など） */
  extraArgs?: string[];
  /** 1 本あたりの上限（ms）。15 分の音声を small で回すと 3〜4 分なので余裕を見て 30 分 */
  timeoutMs?: number;
  log?: LogFn;
  /** 結果を manifest に書く口 */
  onResult?: (seq: number, record: TranscriptRecord) => void;
  /**
   * true なら enqueue しても走らせず、drain() が呼ばれてから順に回す（退出後にまとめて文字起こし）。
   * 同じ機械でブラウザと faster-whisper を同時に動かすと録音が途切れたため、手元では既定 true（config の sttWhen）
   */
  deferUntilDrain?: boolean;
}

export interface Availability {
  ok: boolean;
  reason?: string;
}

export class TranscribeHandoff {
  private readonly opts: TranscribeHandoffOptions;
  private readonly log: LogFn;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private gateOpen: boolean;
  private waiting: { chunk: ChunkRecord; wavPath: string }[] = [];

  constructor(opts: TranscribeHandoffOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => {});
    this.gateOpen = !opts.deferUntilDrain;
  }

  availability(): Availability {
    if (!this.opts.python) return { ok: false, reason: "STT_PYTHON 未設定" };
    if (!existsSync(this.opts.python)) return { ok: false, reason: `Python が無い: ${this.opts.python}` };
    if (!existsSync(this.opts.script)) return { ok: false, reason: `transcribe.py が無い: ${this.opts.script}` };
    return { ok: true };
  }

  /** チャンクが閉じたら呼ぶ。直列キューに積む（呼び出し側は待たない） */
  enqueue(chunk: ChunkRecord, wavPath: string): void {
    const avail = this.availability();
    if (!avail.ok) {
      this.opts.onResult?.(chunk.seq, {
        status: "skipped",
        reason: avail.reason,
        finished_at: new Date().toISOString(),
      });
      this.log("stt_skipped", { seq: chunk.seq, reason: avail.reason });
      return;
    }
    this.pending += 1;
    this.waiting.push({ chunk, wavPath });
    if (this.gateOpen) this.pump();
    else this.log("stt_deferred", { seq: chunk.seq });
  }

  /** 待ち行列を直列の Promise チェーンに流す */
  private pump(): void {
    while (this.waiting.length > 0) {
      const item = this.waiting.shift();
      if (!item) break;
      this.queue = this.queue
        .then(() => this.run(item.chunk, item.wavPath))
        .catch((e: unknown) => {
          this.log("stt_queue_error", { seq: item.chunk.seq, error: String(e) });
        })
        .finally(() => {
          this.pending -= 1;
        });
    }
  }

  get pendingCount(): number {
    return this.pending;
  }

  /** 保留していたものも含めて全部回し、キューが空になるまで待つ（退出処理の最後で呼ぶ） */
  async drain(): Promise<void> {
    this.gateOpen = true;
    this.pump();
    await this.queue;
  }

  private run(chunk: ChunkRecord, wavPath: string): Promise<void> {
    const outDir = path.dirname(wavPath);
    const args = [this.opts.script, wavPath, "--out-dir", outDir, ...(this.opts.extraArgs ?? [])];
    const startedAt = Date.now();
    this.log("stt_start", { seq: chunk.seq, python: this.opts.python, args });
    return new Promise<void>((resolve) => {
      const child = spawn(this.opts.python, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // 他ブランチの venv を借りて動かすときに、その木にキャッシュや .pyc を書き足さない
          PYTHONDONTWRITEBYTECODE: "1",
          HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? "1",
        },
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
        if (stderr.length > 20000) stderr = stderr.slice(-20000);
      });
      child.stdout.on("data", () => {});
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, this.opts.timeoutMs ?? 30 * 60 * 1000);
      child.on("close", (code) => {
        clearTimeout(timer);
        const seconds = (Date.now() - startedAt) / 1000;
        const stem = path.basename(wavPath, path.extname(wavPath));
        const textFile = path.join(outDir, `${stem}.txt`);
        const segFile = path.join(outDir, `${stem}.segments.json`);
        let record: TranscriptRecord;
        if (code === 0 && existsSync(textFile)) {
          record = {
            status: "done",
            text_file: path.basename(textFile),
            segments_file: existsSync(segFile) ? path.basename(segFile) : undefined,
            seconds,
            finished_at: new Date().toISOString(),
          };
        } else {
          record = {
            status: "failed",
            reason: `exit=${code} ${stderr.trim().split("\n").slice(-3).join(" | ")}`.slice(0, 500),
            seconds,
            finished_at: new Date().toISOString(),
          };
        }
        this.log("stt_done", { seq: chunk.seq, ...record });
        this.opts.onResult?.(chunk.seq, record);
        resolve();
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        const record: TranscriptRecord = {
          status: "failed",
          reason: `spawn: ${String(e)}`,
          finished_at: new Date().toISOString(),
        };
        this.log("stt_done", { seq: chunk.seq, ...record });
        this.opts.onResult?.(chunk.seq, record);
        resolve();
      });
    });
  }
}
