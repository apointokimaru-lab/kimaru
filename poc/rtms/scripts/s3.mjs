// コンテナから S3 へ出力を上げる／S3 から 1 ファイル落とす最小のツール（#485）。
//   node scripts/s3.mjs upload <dir> s3://bucket/prefix/     dir 以下の全ファイルを prefix の下へ（相対パスを保つ）
//   node scripts/s3.mjs download s3://bucket/key <file>      1 オブジェクトをファイルへ
//
// なぜ AWS CLI ではないか: aws-cli v2（aarch64）は 200 MB 級で、ws だけの小さな受信機の画像を 3 倍にする。
// @aws-sdk/client-s3 なら 30 MB 程度で、資格情報は SDK が Fargate のタスクロール（コンテナの資格情報エンドポイント）から
// 自動で取る。poc/meet-bot/scripts/s3.mjs と同じ内容（PoC はそれぞれ自己完結・使い捨てなので共有モジュールにしない）。

import { createReadStream, createWriteStream, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function parseS3(uri) {
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(uri);
  if (!m) throw new Error(`s3://bucket/key の形にする: ${uri}`);
  return { bucket: m[1], key: m[2] };
}

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, acc);
    else if (st.isFile()) acc.push({ file: p, rel: path.relative(base, p).split(path.sep).join("/"), size: st.size });
  }
  return acc;
}

const CONTENT_TYPES = { ".wav": "audio/wav", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".jsonl": "application/x-ndjson", ".png": "image/png" };

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const s3 = new S3Client({ region: process.env.AWS_REGION || undefined });
  if (cmd === "upload") {
    const { bucket, key } = parseS3(b);
    const prefix = key.endsWith("/") || key === "" ? key : key + "/";
    const files = walk(a);
    let bytes = 0;
    for (const f of files) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: prefix + f.rel,
          Body: createReadStream(f.file),
          ContentLength: f.size,
          ContentType: CONTENT_TYPES[path.extname(f.file)] ?? "application/octet-stream",
        }),
      );
      bytes += f.size;
    }
    console.log(`[s3] uploaded ${files.length} files (${(bytes / 1e6).toFixed(1)} MB) → s3://${bucket}/${prefix}`);
    return 0;
  }
  if (cmd === "download") {
    const { bucket, key } = parseS3(a);
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await pipeline(res.Body, createWriteStream(b));
    console.log(`[s3] downloaded s3://${bucket}/${key} → ${b} (${res.ContentLength ?? "?"} bytes)`);
    return 0;
  }
  console.error("usage: s3.mjs upload <dir> <s3://bucket/prefix/> | download <s3://bucket/key> <file>");
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[s3] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
