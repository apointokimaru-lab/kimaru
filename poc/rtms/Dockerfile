# Zoom RTMS 受信 PoC の Fargate 用画像（#485）。arm64（Graviton）でビルドする。
#
# 2 段ビルド。1 段目で devDependencies（tsx・typescript・esbuild）を入れて TypeScript を 2 本の ESM に束ね、
# 2 段目は本番依存（ws・@aws-sdk/client-s3）だけを入れる。なぜ tsx を実行時に使わないか: 実行時の依存は
# 少ないほど画像が小さく、脆弱性スキャンの対象も減る。esbuild で束ねるのは、Node の型剥がし（--experimental-strip-types）
# では拡張子無しの import（"./config"）が解決できないため。ws は外部のまま（省略可能なネイティブ拡張を持つので束ねない）。

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run bundle

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# fake-zoom が読む webhook の見本（POC_ROOT = /app 直下）と、S3 の読み書き
COPY fixtures ./fixtures
COPY scripts/s3.mjs ./scripts/s3.mjs
COPY entrypoint.sh ./entrypoint.sh

# 非 root（node 画像に最初からある uid 1000 の node ユーザー）。/data はタスク定義が bind mount する
RUN chmod +x /app/entrypoint.sh && mkdir -p /data/out && chown -R node:node /data /app
USER node

# rtms の webhook 待ち受け（タスク定義の PORT と同じ既定値）。fake-zoom モードでは外から使わない
EXPOSE 3400
ENTRYPOINT ["/app/entrypoint.sh"]
