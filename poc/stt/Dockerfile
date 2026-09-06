# 文字起こし PoC（faster-whisper・CPU int8）の Fargate 用画像（#485）。arm64（Graviton）でビルドする。
#
# なぜ python:3.12-slim か: 手元の PoC が Python 3.12 で、依存（ctranslate2・onnxruntime・av・tokenizers・numpy）は
# すべて manylinux aarch64 の wheel があるのでコンパイラが要らない（ビルドログで「Building wheel」が出ないことを見る）。
# なぜモデルを画像に入れるか: 実行のたびに Hugging Face から 460 MB 落とすと、起動が 1 分以上遅れ、
# HF 側の障害で文字起こしが止まる（本番設計 T-302「イメージ同梱・起動時 DL しない」）。
# HF_HUB_OFFLINE=1 で実行時は一切ネットに出ない（同梱した snapshot だけを見る）。

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # 実行時は同梱モデルだけを使う（transcribe.py の download_root=STT_MODEL_DIR）
    HF_HUB_OFFLINE=1 \
    STT_MODEL_DIR=/opt/models \
    STT_OUT_DIR=/data/out

# libgomp1: ctranslate2 / onnxruntime の OpenMP。wheel に同梱されない版があるので入れておく（数百 KB）
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存は requirements.txt の固定版をそのまま使う。pyopenjtalk（テスト音声の合成・要コンパイル）だけ外す
# ——音声は手元で作って S3 に置くので、コンテナには要らない。boto3 は S3 の読み書き用（AWS CLI v2 は 200 MB 級なので入れない）
COPY requirements.txt ./
RUN grep -v -i 'pyopenjtalk' requirements.txt > /tmp/requirements-container.txt \
    && pip install -r /tmp/requirements-container.txt boto3

# モデルの同梱（ビルド時だけ HF に出る）。small は int8 に変換する前の float16 で約 460 MB。
# 画像の大きさの内訳を README に書くため、落とした後にサイズを出す
RUN HF_HUB_OFFLINE=0 python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8', download_root='/opt/models')" \
    && du -sh /opt/models \
    && chmod -R a+rX /opt/models

COPY transcribe.py check_complete.py entrypoint.py ./

# 非 root。/data はタスク定義が bind mount する（root 所有で書けない場合は entrypoint が /tmp/data へ退避する）
RUN useradd --system --uid 10001 --create-home stt \
    && mkdir -p /data/out \
    && chown -R stt:stt /data /app
USER stt

ENTRYPOINT ["python", "/app/entrypoint.py"]
