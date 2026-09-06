// テスト用の偽 transcribe.py。本物（poc/stt/transcribe.py）と同じ呼び方・同じ出力の形で、
//   node fake-transcribe.mjs <wav> --json-summary [--model x]
// stderr に経過を出し、<name>.txt を書き、stdout の最後に 1 行 JSON を出す。
// 環境変数 FAKE_STT_EXIT を非 0 にすると失敗を再現する。
import { writeFileSync } from "node:fs";

const wav = process.argv[2];
if (!wav) {
  console.error("usage: fake-transcribe.mjs <wav>");
  process.exit(2);
}
const exitCode = Number(process.env.FAKE_STT_EXIT ?? "0");
if (exitCode !== 0) {
  console.error("わざと失敗");
  process.exit(exitCode);
}
console.error("モデル        : fake");
const stem = wav.replace(/\.wav$/i, "");
writeFileSync(`${stem}.txt`, "これはテストです\n");
writeFileSync(`${stem}.segments.json`, JSON.stringify({ segments: [{ start: 0, end: 1, text: "これはテストです" }] }));
console.log(
  JSON.stringify({
    audio: wav,
    model: "fake",
    duration_s: 1.0,
    rtf: 0.1,
    segments_path: `${stem}.segments.json`,
    text: "これはテストです",
  }),
);
