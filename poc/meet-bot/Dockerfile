# Google Meet Bot PoC の Fargate 用画像（#485）。arm64（Graviton）でビルドする。
#
# なぜ Playwright 公式画像か: Chromium（arm64）と、その実行に要る OS のライブラリ・フォントが揃っていて、
# 版が npm の playwright と一致していないと Chromium を見つけられない（PLAYWRIGHT_BROWSERS_PATH=/ms-playwright）。
# 画像のタグ v1.62.1 は package.json の playwright（固定 1.62.1）と必ず揃える（片方だけ上げると起動時に
# "Executable doesn't exist" で落ちる）。noble = Ubuntu 24.04・Node 22 系。
# 実行は tsx（ビルド無し。手元の PoC と同じ）。画像は Chromium で 1 GB 超なので tsx の数 MB は誤差。

FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production
WORKDIR /app

# 本番依存だけ（playwright・tsx・@aws-sdk/client-s3）。playwright の npm はブラウザを落とさない（画像に同梱済み）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json entrypoint.sh ./
COPY src ./src
# 擬似 Meet ページ（MODE=fake-meet で同じコンテナの 127.0.0.1 に配る）
COPY test/fake-meet ./test/fake-meet
COPY scripts ./scripts

# 非 root。pwuser（uid 1000）は公式画像に最初からある。/data はタスク定義が bind mount する
# （root 所有で書けない場合は entrypoint が /tmp/data へ退避する）
RUN chmod +x /app/entrypoint.sh && mkdir -p /data/out && chown -R pwuser:pwuser /data /app
USER pwuser

ENTRYPOINT ["/app/entrypoint.sh"]
