// 1 行 1 イベントの JSONL ログ。stderr にも同じ内容を出す。
// なぜ JSONL か: 実機（本物の Meet）での試験では「どの状態にいつ移ったか・Meet がどんな文言を出したか」を
// 後から突き合わせる必要がある。人が読むログと機械が読むログを分けると食い違うので 1 本にする。

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogFn = (event: string, data?: Record<string, unknown>) => void;

export interface Logger {
  log: LogFn;
  file: string | null;
}

export function createLogger(outDir: string | null, opts: { quiet?: boolean } = {}): Logger {
  let file: string | null = null;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    file = path.join(outDir, "events.jsonl");
  }
  const log: LogFn = (event, data = {}) => {
    const row = { at: new Date().toISOString(), event, ...data };
    const line = JSON.stringify(row);
    if (file) {
      try {
        appendFileSync(file, line + "\n");
      } catch {
        // ログが書けなくても録音は止めない
      }
    }
    if (!opts.quiet) process.stderr.write(line + "\n");
  };
  return { log, file };
}

export const nullLogger: Logger = { log: () => {}, file: null };
