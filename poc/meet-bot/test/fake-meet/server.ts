// 擬似 Meet ページを配る最小の HTTP サーバ。127.0.0.1 の空きポート（既定 0 = OS が選ぶ）で立つ。
// なぜ file:// ではないか: file:// のページでは RTCPeerConnection や AudioWorklet の挙動が https/http と違うことが
// あり、本物の Meet（https）に近い条件で試したい。8888/3000/3123 はこのリポジトリの他の用途で使うので避ける。

import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};

export interface FakeMeetServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface FakeMeetOptions {
  /** /media/* で配るディレクトリ（WAV を流す試験用）。省略時は /media/ を 404 にする */
  mediaDir?: string;
  port?: number;
}

export function startFakeMeet(opts: FakeMeetOptions = {}): Promise<FakeMeetServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let file: string | null = null;
    if (url.pathname === "/favicon.ico") {
      // ブラウザが勝手に取りに来る。404 のコンソールエラーでログを汚さない
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      file = path.join(HERE, "index.html");
    } else if (url.pathname.startsWith("/media/")) {
      if (opts.mediaDir) {
        const rel = path.normalize(decodeURIComponent(url.pathname.slice("/media/".length)));
        // ディレクトリ外へ出る参照は拒む
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) file = path.join(opts.mediaDir, rel);
      }
    }
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
