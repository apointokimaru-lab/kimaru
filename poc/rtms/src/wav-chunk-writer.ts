// 受け取った PCM を 15 分ごとの WAV に切って保存し、manifest.json に台帳を書く。
//
// なぜ 15 分か: 本番設計（docs/ai-bot/system-spec.md の T-209・FR-2.5）が「15 分セグメント単位で保存・アップロード・
// 文字起こしし、失敗したセグメントだけやり直す」なので、PoC の出力もその単位にしておくと後工程（#393 の
// transcribe.py・check_complete.py）にそのまま流せる。1 時間の会議を 1 本にすると、途中で落ちたときに全部失ううえ、
// 文字起こしも会議が終わるまで始められない。
// なぜ manifest に SHA-256 を持つか: 後でサーバーへ上げるときに欠番と改ざん・転送破損を見分けるため（T-209 の
// 「manifest（欠番・ハッシュ）の検証は上流のサーバが行う」）。ここで計算した値は「送る側の申告」に過ぎないので、
// 受け取るサーバー側で必ず再計算して照合する（受信機が壊れていても嘘の manifest で通ってしまわないように）。
// なぜ WAV か: 生 PCM に 44 byte のヘッダを足すだけで、faster-whisper（PyAV）がそのまま読める。圧縮しない。

import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
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
  rtf?: number;
  reason?: string;
  finished_at: string;
}

export interface ChunkRecord {
  /** 1 から連番。欠番があれば取りこぼし */
  seq: number;
  /** manifest からの相対ファイル名（0001.wav） */
  file: string;
  started_at: string;
  ended_at: string | null;
  /** WAV ヘッダを除いた PCM のバイト数 */
  pcm_bytes: number;
  duration_seconds: number | null;
  /** ファイル全体（ヘッダ込み）の SHA-256 hex。閉じるまで null */
  sha256: string | null;
  /** RTMS の音声メッセージに載っていた Unix ms。無ければ null */
  first_packet_ts: number | null;
  last_packet_ts: number | null;
  transcript?: TranscriptRecord;
}

export interface Manifest {
  version: 1;
  meeting_uuid: string;
  rtms_stream_id: string;
  created_at: string;
  ended_at: string | null;
  status: "recording" | "closed";
  end_reason?: string;
  format: { container: "wav"; codec: "pcm_s16le"; sample_rate: number; channels: number; bits_per_sample: number };
  chunk_seconds: number;
  /** 保存できた PCM の合計秒数（= check_complete.py の --expected-duration に渡す値） */
  total_seconds: number;
  chunks: ChunkRecord[];
}

export interface WavChunkWriterOptions {
  /** この会議の保存先ディレクトリ（無ければ作る） */
  dir: string;
  meetingUuid: string;
  streamId: string;
  format?: WavFormat;
  chunkSeconds?: number;
  /** テスト用に時計を差し替える */
  now?: () => Date;
  /** チャンクが閉じるたびに呼ぶ（文字起こしへの受け渡し口） */
  onChunkClosed?: (chunk: ChunkRecord, manifest: Manifest) => void;
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

/**
 * meeting_uuid / rtms_stream_id をディレクトリ名にできる形にする。
 * Zoom の UUID は base64 で `/` `+` `=` を含みうる（`/` はパス区切りになって危ない）。
 * 使える文字だけ残し、元の値の短いハッシュを添えて衝突を避ける。
 */
export function safeDirName(meetingUuid: string, streamId: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  const tag = createHash("sha256").update(`${meetingUuid}\n${streamId}`).digest("hex").slice(0, 8);
  return `${clean(meetingUuid)}__${clean(streamId)}__${tag}`;
}

export class WavChunkWriter {
  readonly dir: string;
  readonly format: WavFormat;
  readonly chunkSeconds: number;
  private readonly chunkBytes: number;
  private readonly frameBytes: number;
  private readonly now: () => Date;
  private readonly onChunkClosed?: (chunk: ChunkRecord, manifest: Manifest) => void;
  private readonly manifestPath: string;
  private manifestState: Manifest;
  private open: OpenChunk | null = null;
  /** フレーム（1 サンプル × ch）に満たない端数。次の write の先頭に付ける */
  private leftover: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(opts: WavChunkWriterOptions) {
    this.dir = opts.dir;
    this.format = opts.format ?? DEFAULT_WAV_FORMAT;
    this.chunkSeconds = opts.chunkSeconds ?? 900;
    this.frameBytes = (this.format.channels * this.format.bitsPerSample) / 8;
    // チャンクの境界がサンプルの途中に来ないよう、フレーム単位に丸める
    this.chunkBytes = Math.max(this.frameBytes, Math.floor(this.format.sampleRate * this.chunkSeconds) * this.frameBytes);
    this.now = opts.now ?? (() => new Date());
    this.onChunkClosed = opts.onChunkClosed;
    mkdirSync(this.dir, { recursive: true });
    this.manifestPath = path.join(this.dir, "manifest.json");
    this.manifestState = {
      version: 1,
      meeting_uuid: opts.meetingUuid,
      rtms_stream_id: opts.streamId,
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
      total_seconds: 0,
      chunks: [],
    };
    this.writeManifest();
  }

  get manifest(): Manifest {
    return this.manifestState;
  }

  /** PCM を追記する。チャンクの境界をまたぐバッファは分けて書く */
  write(pcm: Buffer, packetTs?: number): void {
    if (this.closed) throw new Error("閉じた writer に書こうとした");
    let buf = this.leftover.length > 0 ? Buffer.concat([this.leftover, pcm]) : pcm;
    // フレームに満たない末尾は次回へ（書くとサンプルがずれて以降が雑音になる）
    const usable = buf.length - (buf.length % this.frameBytes);
    this.leftover = buf.subarray(usable);
    buf = buf.subarray(0, usable);

    let offset = 0;
    while (offset < buf.length) {
      const chunk = this.open ?? this.openChunk();
      const remaining = this.chunkBytes - chunk.record.pcm_bytes;
      const take = Math.min(remaining, buf.length - offset);
      writeSync(chunk.fd, buf, offset, take);
      chunk.record.pcm_bytes += take;
      if (packetTs !== undefined) {
        chunk.record.first_packet_ts ??= packetTs;
        chunk.record.last_packet_ts = packetTs;
      }
      offset += take;
      if (chunk.record.pcm_bytes >= this.chunkBytes) this.closeChunk();
    }
  }

  /** 途中のチャンクを閉じ、manifest を確定する。2 回呼んでも安全 */
  close(reason = "closed"): Manifest {
    if (this.closed) return this.manifestState;
    this.closed = true;
    if (this.open) {
      if (this.open.record.pcm_bytes > 0) {
        this.closeChunk();
      } else {
        // 開いただけで音が来なかったチャンクは台帳から外す（欠番を作らないため、末尾なので seq はそのまま減らせる）
        closeSync(this.open.fd);
        try {
          unlinkSync(this.open.partPath);
        } catch {
          /* 無ければよい */
        }
        this.manifestState.chunks = this.manifestState.chunks.filter((c) => c.seq !== this.open?.record.seq);
        this.open = null;
      }
    }
    this.manifestState.status = "closed";
    this.manifestState.ended_at = this.now().toISOString();
    this.manifestState.end_reason = reason;
    this.writeManifest();
    return this.manifestState;
  }

  /** 文字起こし結果などをチャンクの台帳に足す */
  updateChunk(seq: number, patch: Partial<Pick<ChunkRecord, "transcript">>): void {
    const rec = this.manifestState.chunks.find((c) => c.seq === seq);
    if (!rec) return;
    Object.assign(rec, patch);
    this.writeManifest();
  }

  private openChunk(): OpenChunk {
    const seq = this.manifestState.chunks.length + 1;
    const file = `${String(seq).padStart(4, "0")}.wav`;
    const finalPath = path.join(this.dir, file);
    // 書き途中は .part にして、閉じるときに rename する。途中で落ちたら .part が残り「未完のチャンク」と分かる
    const partPath = `${finalPath}.part`;
    const fd = openSync(partPath, "w");
    writeSync(fd, buildWavHeader(0, this.format)); // サイズ 0 の仮ヘッダ。閉じるときに書き直す
    const record: ChunkRecord = {
      seq,
      file,
      started_at: this.now().toISOString(),
      ended_at: null,
      pcm_bytes: 0,
      duration_seconds: null,
      sha256: null,
      first_packet_ts: null,
      last_packet_ts: null,
    };
    this.manifestState.chunks.push(record);
    this.open = { record, fd, partPath, finalPath };
    this.writeManifest();
    return this.open;
  }

  private closeChunk(): void {
    const chunk = this.open;
    if (!chunk) return;
    this.open = null;
    const { record, fd, partPath, finalPath } = chunk;
    // ヘッダの 2 か所のサイズを実際の値で上書きしてから閉じる
    writeSync(fd, buildWavHeader(record.pcm_bytes, this.format), 0, 44, 0);
    fsyncSync(fd);
    closeSync(fd);
    renameSync(partPath, finalPath);
    record.ended_at = this.now().toISOString();
    record.duration_seconds = record.pcm_bytes / (this.format.sampleRate * this.frameBytes);
    record.sha256 = sha256File(finalPath);
    this.manifestState.total_seconds = this.manifestState.chunks.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
    this.writeManifest();
    this.onChunkClosed?.(record, this.manifestState);
  }

  /** manifest は tmp に書いて rename（読む側が書き途中の JSON を見ないように） */
  private writeManifest(): void {
    const tmp = `${this.manifestPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.manifestState, null, 2) + "\n");
    renameSync(tmp, this.manifestPath);
  }
}
