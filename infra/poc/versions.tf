# Terraform 本体・プロバイダ・state の置き場所（#483）。
#
# state は S3 に置く。バケットは Terraform 管理外（鶏と卵）なので scripts/bootstrap-state.sh で 1 回だけ作る。
# ロックは Terraform 1.10 以降の S3 ネイティブロック（use_lockfile）を使い、DynamoDB のテーブルは置かない
# （固定費をゼロに寄せる方針。ロック用テーブルは無料枠に収まるが「置かない」のが一番安い）。
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # 6 系に固定（7 で resource の引数が変わっても勝手に上がらない）。細かい版は .terraform.lock.hcl が持つ
      version = "~> 6.63"
    }
  }

  backend "s3" {
    # backend ブロックは変数を参照できないため、バケット名だけはここに直書きする。
    # 名前の末尾はアカウント ID の下 6 桁（scripts/bootstrap-state.sh と同じ規則。別アカウントで使うときはここも直す）
    bucket       = "kimaru-bot-tfstate-003994"
    key          = "poc/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
