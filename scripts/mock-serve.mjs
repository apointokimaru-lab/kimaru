// mock/ をブラウザで確認するためのローカルサーバ（常駐）。
// 起動: npm run mock  → http://localhost:8889/  （例: /index.html, /plan.html …）
// mock/ を優先配信し、無いファイル（フォント以外の共有資産）は public/ にフォールバック。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [path.join(repo, "mock"), path.join(repo, "public")];
const PORT = Number(process.env.MOCK_PORT || 8889);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webp": "image/webp" };

function resolveFile(urlPath) {
  for (const root of roots) {
    const file = path.join(root, urlPath);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const file = resolveFile(urlPath);
  if (!file) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("not found: " + urlPath); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`mock server: http://localhost:${PORT}/  (mock/ 優先・public/ フォールバック)`);
  const pages = fs.readdirSync(roots[0]).filter((f) => f.endsWith(".html")).sort();
  if (pages.length) console.log("pages:", pages.map((p) => `http://localhost:${PORT}/${p}`).join("\n       "));
});
