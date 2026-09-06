# 音声（WAV）と manifest の一時置き場。Bot が書き、STT が読む。
# 決定: 音声は 7 日で自動削除・SSE-S3・パブリック遮断・バージョニング無し（消したものを残さない）
resource "aws_s3_bucket" "audio" {
  bucket = local.audio_bucket
  # destroy 時に中身ごと消す（音声は使い捨て。残っていると destroy が失敗する）
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket = aws_s3_bucket.audio.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3。KMS にすると鍵の呼び出し料が乗る
    }
  }
}

# バージョニングは有効にしない（新規バケットの既定 = 無効）。aws_s3_bucket_versioning を
# "Disabled" で置いても API 呼び出しが増えるだけなので資源を作らない。

# filter を書かない rule はバケット全体に効く（プロバイダ 6 系の仕様）。
#  - 7 日で全オブジェクト削除（音声は文字起こしが終われば要らない）
#  - 途中で止まったマルチパートアップロード（大きい WAV）は 1 日で破棄（見えないのに課金される）
resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "expire-all-objects"
    status = "Enabled"

    expiration {
      days = var.audio_expire_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
