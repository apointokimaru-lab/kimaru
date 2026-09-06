data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_partition" "current" {}

# 既定 VPC を使う（NAT も ALB も置かないので、専用 VPC を切る理由がまだ無い。本番 #382 で切り直す）。
# ID を直書きせず data で引くのは、別アカウント／リージョンでも同じコードが通るようにするため
data "aws_vpc" "default" {
  default = true
}

# 既定 VPC の「AZ ごとの既定サブネット」＝ IGW にルートがありパブリック IP が自動で付く公開サブネット
data "aws_subnets" "default_public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}
