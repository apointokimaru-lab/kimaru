#!/usr/bin/env bash
# Terraform state 用の S3 バケットを 1 回だけ作る（#483）。
#
# なぜ Terraform で作らないか: state を置く先を Terraform 自身が管理すると鶏と卵になる（最初の apply の
# state をどこに置くか）。なので state バケットだけは CLI で作り、`terraform destroy` の対象にもしない。
# 何度実行しても同じ結果になる（既にあれば設定を上書きして揃えるだけ）。
#
# 使い方:  scripts/bootstrap-state.sh            （AWS_PROFILE / AWS_REGION は環境に従う）
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
# バケット名は全世界で一意なので、アカウント ID の下 6 桁を付ける（versions.tf の backend と同じ規則）
SUFFIX="${ACCOUNT_ID: -6}"
BUCKET="kimaru-bot-tfstate-${SUFFIX}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "state bucket already exists: s3://$BUCKET"
else
  echo "creating state bucket: s3://$BUCKET ($REGION)"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi

# 公開遮断（state には資源の ARN や設定値が全部入る）
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

# バージョニング: 壊れた state を 1 つ前に戻せるように
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled

# SSE-S3（新規バケットの既定でもあるが、明示しておく）
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# 古い版は 90 日で消す（apply のたびに 1 版増える。残し続けると保存料が積む）。途中で止まった
# マルチパートも 7 日で破棄
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [
    {
      "ID": "expire-old-state-versions",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}' >/dev/null

# Terraform 管理外なので、providers.tf の default_tags と同じタグを手で付ける（費用のタグ集計に載せる）
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging \
  'TagSet=[{Key=Project,Value=kimaru-bot},{Key=Env,Value=poc},{Key=ManagedBy,Value=bootstrap-state.sh}]'

echo "ok: s3://$BUCKET (versioning on, public access blocked, SSE-S3)"

# versions.tf の backend と食い違っていたら知らせる（別アカウントで使うときの事故防止）
if ! grep -qE "bucket[[:space:]]*=[[:space:]]*\"$BUCKET\"" "$HERE/../versions.tf"; then
  echo "WARN: versions.tf の backend \"s3\" の bucket を \"$BUCKET\" に直してください" >&2
fi

# GitHub の OIDC provider は 1 アカウントに 1 つ。既にあるなら作らずに取り込む
if aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text \
  | grep -q 'oidc-provider/token.actions.githubusercontent.com'; then
  echo "NOTE: GitHub の OIDC provider が既にあります。apply の前に取り込んでください:" >&2
  echo "  terraform import aws_iam_openid_connect_provider.github arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" >&2
fi
