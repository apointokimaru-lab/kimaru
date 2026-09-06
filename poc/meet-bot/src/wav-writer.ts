// 受け取った PCM を 15 分ごとの WAV に切って保存し、manifest.json に台帳を書く。
//
// なぜ 16 kHz モノラル 16 bit か: 文字起こし（faster-whisper）が内部で 16 kHz モノラルに変換して読むので、
// それ以上の情報を持っても精度は上がらず、容量だけ 3 倍（48 kHz）・6 倍（ステレオ）になる。
// 1 時間で 115 MB（16 kHz）と 345 MB（48 kHz）の差は、アップロードと保持のコストにそのまま出る。
// なぜ 15 分か: 本番設計（docs/ai-bot/system-spec.md の T-209・FR-2.5）が「15 分セグメント単位で保存・アップロード・
// 文字起こしし、失敗したセグメントだけやり直す」なので、PoC の出力もこの単位にしておくと後工程（#393 の
// transcribe.py・check_complete.py）にそのまま流せる。1 時間を 1 本にすると、途中で落ちたとき全部失い、
// 文字起こしも会議が終わるまで始められない。
// なぜ manifest に SHA-256 と bytes を持つか: 本番ではサーバが「欠番なし・サイズ一致・ハッシュ一致・時刻連続」を
// 検証してから文字起こしに回す（spec 2.3.4）。ここで計算した値は Bot の「申告」に過ぎず、サーバ側で必ず
// 再計算して照合する。壊れた Bot が嘘の manifest を出しても、音声を消す判断（completed）に進ませないため。
// seq は 0 から（spec 2.3.4 ①「seq が 0..expected-1」に合わせる。poc/rtms の 1 始まりとは違うので注意）。
// capture_generation は再入室のたびに +1 する録音世代（FR-2.8）。この PoC は再入室を実装していないので常に 0 だが、
// 列は最初から持たせて後工程の形を揃える。

import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export const DEFAULT_WAV_FORMAT: WavFormat = { sampleRate: 16000, channels: 1, bitsPerSample: 16 };

export interface TranscriptRecord {
  status: "done" | "skipped" | "failed";
  text_file?: string;
  segments_file?: string;
  reason?: string;
  /** transcribe.py の処理時間（秒） */
  seconds?: number;
  finished_at: string;
}

export interface ChunkRecord {
  /** 0 から連番。欠番があれば取りこぼし */
  seq: number;
  /** manifest からの相対ファイル名（0000.wav） */
  file: string;
  started_at: string;
  ended_at: string | null;
  /** WAV ヘッダを除いた PCM のバイト数 */
  pcm_bytes: number;
  /** ファイル全体（ヘッダ込み）のバイト数。閉じるまで null */
  file_bytes: number | null;
  duration_seconds: number;
  /** ファイル全体（ヘッダ込み）の SHA-256 hex。閉じるまで null */
  sha256: string | null;
  transcript?: TranscriptRecord;
}

export interface Manifest {
  version: 1;
  meeting_url: string;
  meeting_code: string;
  capture_generation: number;
  created_at: string;
  ended_at: string | null;
  status: "recording" | "closed";
  end_reason?: string;
  format: { container: "wav"; codec: "pcm_s16le"; sample_rate: number; channels: number; bits_per_sample: number };
  chunk_seconds: number;
  /** 閉じた後に確定する総チャンク数（= chunks.length）。録音中は null */
  expected_chunks: number | null;
  /** 保存できた PCM の合計秒数（= check_complete.py の --expected-duration に渡す値） */
  total_seconds: number;
  chunks: ChunkRecord[];
}

export interface WavChunkWriterOptions {
  /** この会議の保存先ディレクトリ（無ければ作る） */
  dir: string;
  meetingUrl: string;
  captureGeneration?: number;
  format?: WavFormat;
  chunkSeconds?: number;
  /** テスト用に時計を差し替える */
  now?: () => Date;
  /** チャンクが閉じるたびに呼ぶ（文字起こしへの受け渡し口） */
  onChunkClosed?: (chunk: ChunkRecord, wavPath: string, manifest: Manifest) => void;
}

interface OpenChunk {
  record: ChunkRecord;
  fd: number;
  partPath: string;
  finalPath: string;
}

/** 44 byte の RIFF/WAVE ヘッダ（PCM）。dataBytes は PCM のバイト数 */
export function buildWavHeader(dataBytes: number, fmt: WavFormat = DEFAULT_WAV_FORMAT): Buffer {
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8;
  const byteRate = fmt.sampleRate * blockAlign;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); // fmt チャンクの長さ
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(fmt.channels, 22);
  h.writeUInt32LE(fmt.sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(fmt.bitsPerSample, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Meet の URL から会議コード（abc-defg-hij）を取り出す。取れなければディレクトリ名に使える形に潰す */
export function meetingCodeFromUrl(url: string): string {
  const m = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i.exec(url);
  if (m?.[1]) return m[1].toLowerCase();
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return (tail || "meeting").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "meeting";
  } catch {
    return "meeting";
  }
}

export class WavChunkWriter {
  readonly dir: string;
  readonly format: WavFormat;
  readonly chunkSeconds: number;
  private readonly chunkBytes: number;
  private readonly blockAlign: number;
  private readonly now: () => Date;
  private readonly onChunkClosed?: WavChunkWriterOptions["onChunkClosed"];
  private readonly manifestData: Manifest;
  private open: OpenChunk | null = null;
  private closed = false;

  constructor(opts: WavChunkWriterOptions) {
    this.dir = opts.dir;
    this.format = opts.format ?? DEFAULT_WAV_FORMAT;
    this.chunkSeconds = opts.chunkSeconds ?? 15 * 60;
    this.blockAlign = (this.format.channels * this.format.bitsPerSample) / 8;
    this.chunkBytes = this.chunkSeconds * this.format.sampleRate * this.blockAlign;
    this.now = opts.now ?? (() => new Date());
    this.onChunkClosed = opts.onChunkClosed;
    mkdirSync(this.dir, { recursive: true });
    this.manifestData = {
      version: 1,
      meeting_url: opts.meetingUrl,
      meeting_code: meetingCodeFromUrl(opts.meetingUrl),
      capture_generation: opts.captureGeneration ?? 0,
      created_at: this.now().toISOString(),
      ended_at: null,
      status: "recording",
      format: {
        container: "wav",
        codec: "pcm_s16le",
        sample_rate: this.format.sampleRate,
        channels: this.format.channels,
        bits_per_sample: this.format.bitsPerSample,
      },
      chunk_seconds: this.chunkSeconds,
      expected_chunks: null,
      total_seconds: 0,
      chunks: [],
    };
    this.saveManifest();
  }

  get manifest(): Manifest {
    return this.manifestData;
  }

  get manifestPath(): string {
    return path.join(this.dir, "manifest.json");
  }

  chunkPath(seq: number): string {
    return path.join(this.dir, `${String(seq).padStart(4, "0")}.wav`);
  }

  /** PCM（s16le・モノラル）を追記する。チャンク境界をまたぐぶんは次のファイルへ */
  write(pcm: Buffer): void {
    if (this.closed) throw new Error("writer は閉じている");
    let offset = 0;
    // blockAlign の端数（奇数バイト）が来たら落とす。次のチャンクの先頭が半サンプルずれると全体が雑音になる
    const usable = pcm.length - (pcm.length % this.blockAlign);
    while (offset < usable) {
      const chunk = this.open ?? this.openChunk();
      const room = this.chunkBytes - chunk.record.pcm_bytes;
      const n = Math.min(room, usable - offset);
      // 位置を明示して書く。先頭のヘッダを位置指定で書いた後はファイルポインタが進んでいないので、
      // 位置を省くと PCM がヘッダの上に書かれてしまう（テストで見つかった）
      writeSync(chunk.fd, pcm, offset, n, 44 + chunk.record.pcm_bytes);
      chunk.record.pcm_bytes += n;
      chunk.record.duration_seconds = chunk.record.pcm_bytes / (this.format.sampleRate * this.blockAlign);
      offset += n;
      if (chunk.record.pcm_bytes >= this.chunkBytes) this.closeChunk();
    }
  }

  /** 録音を終える。開いているチャンクを閉じ、manifest を確定する */
  close(endReason?: string): Manifest {
    if (this.closed) return this.manifestData;
    if (this.open) this.closeChunk();
    this.closed = true;
    this.manifestData.status = "closed";
    this.manifestData.ended_at = this.now().toISOString();
    this.manifestData.expected_chunks = this.manifestData.chunks.length;
    if (endReason) this.manifestData.end_reason = endReason;
    this.saveManifest();
    return this.manifestData;
  }

  /** 文字起こしの結果を該当チャンクに載せる（閉じた後でも呼べる） */
  setTranscript(seq: number, record: TranscriptRecord): void {
    const chunk = this.manifestData.chunks.find((c) => c.seq === seq);
    if (!chunk) return;
    chunk.transcript = record;
    this.saveManifest();
  }

  private openChunk(): OpenChunk {
    const seq = this.manifestData.chunks.length;
    const finalPath = this.chunkPath(seq);
    const partPath = `${finalPath}.part`;
    const fd = openSync(partPath, "w");
    // 先にダミーのヘッダを置いておき、閉じるときに正しい長さで上書きする（PCM の長さは閉じるまで分からない）
    writeSync(fd, buildWavHeader(0, this.format), 0, 44, 0);
    const record: ChunkRecord = {
      seq,
      file: path.basename(finalPath),
      started_at: this.now().toISOString(),
      ended_at: null,
      pcm_bytes: 0,
      file_bytes: null,
      duration_seconds: 0,
      sha256: null,
    };
    this.manifestData.chunks.push(record);
    this.open = { record, fd, partPath, finalPath };
    this.saveManifest();
    return this.open;
  }

  private closeChunk(): void {
    const chunk = this.open;
    if (!chunk) return;
    this.open = null;
    // ヘッダを本当の長さで書き直し → fsync → .part を外す。途中で落ちた .part は「不完全」と分かる
    writeSync(chunk.fd, buildWavHeader(chunk.record.pcm_bytes, this.format), 0, 44, 0);
    fsyncSync(chunk.fd);
    closeSync(chunk.fd);
    renameSync(chunk.partPath, chunk.finalPath);
    chunk.record.ended_at = this.now().toISOString();
    chunk.record.file_bytes = statSync(chunk.finalPath).size;
    chunk.record.sha256 = sha256File(chunk.finalPath);
    this.manifestData.total_seconds = this.manifestData.chunks.reduce((s, c) => s + c.duration_seconds, 0);
    this.saveManifest();
    this.onChunkClosed?.(chunk.record, chunk.finalPath, this.manifestData);
  }

  private saveManifest(): void {
    // tmp に書いて rename する。書きかけの manifest を後工程が読まないように
    const tmp = `${this.manifestPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.manifestData, null, 2) + "\n");
    renameSync(tmp, this.manifestPath);
  }
}
