// 閉じたチャンク（WAV）を #393 の文字起こし PoC（poc/stt/transcribe.py・PR #474）に渡す。
//
// なぜ子プロセスか: transcribe.py は Python（faster-whisper）で、この PoC は Node。HTTP を立てるほどでもないので
// `python transcribe.py <wav> --json-summary` を spawn し、stdout 最終行の JSON（text / segments_path / rtf）を拾う。
// transcribe.py は音声と同じ場所に `<name>.txt` と `<name>.segments.json` を書くので、0001.wav の隣に 0001.txt ができる。
// なぜ 1 本ずつか: モデルは 1 プロセス 1.3 GB（small）読む。チャンクが閉じるたびに並列で起こすとメモリが足りない。
// STT PoC が入っていない（STT_PYTHON 未設定・スクリプトが無い）ときは黙って skipped にして保存だけ続ける。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type HandoffResult =
  | { status: "done"; text: string; textPath: string; segmentsPath: string; rtf?: number; durationS?: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; stderr?: string };

export interface TranscribeHandoffOptions {
  /** Python 実行ファイル。空なら受け渡しをしない */
  python: string;
  /** transcribe.py の絶対パス */
  scriptPath: string;
  model?: string;
  extraArgs?: string[];
  /** 1 チャンクの上限時間（ms）。15 分の音声を small/CPU で回すと 3〜4 分（RTF 0.2）なので余裕を見て 30 分 */
  timeoutMs?: number;
  log?: (message: string, data?: unknown) => void;
}

export interface TranscribeHandoff {
  isAvailable(): boolean;
  /** 直列に実行する。戻りは Promise なので待たなくてもよい */
  enqueue(wavPath: string): Promise<HandoffResult>;
  /** 進行中・待ちの件数 */
  pending(): number;
}

export function createTranscribeHandoff(opts: TranscribeHandoffOptions): TranscribeHandoff {
  const log = opts.log ?? (() => {});
  const available = Boolean(opts.python) && existsSync(opts.scriptPath);
  let tail: Promise<unknown> = Promise.resolve();
  let pendingCount = 0;

  const runOne = (wavPath: string): Promise<HandoffResult> =>
    new Promise((resolve) => {
      if (!opts.python) return resolve({ status: "skipped", reason: "STT_PYTHON が未設定" });
      if (!existsSync(opts.scriptPath)) return resolve({ status: "skipped", reason: `transcribe.py が無い: ${opts.scriptPath}` });
      if (!existsSync(wavPath)) return resolve({ status: "failed", reason: `WAV が無い: ${wavPath}` });

      const args = [opts.scriptPath, wavPath, "--json-summary", ...(opts.model ? ["--model", opts.model] : []), ...(opts.extraArgs ?? [])];
      log("stt: spawn", { python: opts.python, args });
      const child = spawn(opts.python, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
        if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, opts.timeoutMs ?? 30 * 60_000);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ status: "failed", reason: `spawn 失敗: ${err.message}` });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (signal) return resolve({ status: "failed", reason: `signal ${signal}（timeout?）`, stderr });
        if (code !== 0) return resolve({ status: "failed", reason: `exit ${code}`, stderr });
        // --json-summary は最後に 1 行 JSON を出す。それより前に他の出力があっても最後の JSON 行だけ見る
        const line = stdout
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.startsWith("{"))
          .pop();
        if (!line) return resolve({ status: "failed", reason: "stdout に JSON サマリーが無い", stderr });
        try {
          const summary = JSON.parse(line) as Record<string, unknown>;
          const text = typeof summary["text"] === "string" ? summary["text"] : "";
          const segmentsPath = typeof summary["segments_path"] === "string" ? summary["segments_path"] : wavPath.replace(/\.wav$/i, ".segments.json");
          resolve({
            status: "done",
            text,
            textPath: wavPath.replace(/\.wav$/i, ".txt"),
            segmentsPath,
            rtf: typeof summary["rtf"] === "number" ? summary["rtf"] : undefined,
            durationS: typeof summary["duration_s"] === "number" ? summary["duration_s"] : undefined,
          });
        } catch (err) {
          resolve({ status: "failed", reason: `JSON サマリーを読めない: ${(err as Error).message}`, stderr });
        }
      });
    });

  return {
    isAvailable: () => available,
    pending: () => pendingCount,
    enqueue(wavPath) {
      pendingCount += 1;
      const p = tail.then(() => runOne(wavPath)).finally(() => {
        pendingCount -= 1;
      });
      tail = p.catch(() => undefined);
      return p;
    },
  };
}
