# コンテナ画像の置き場。3 つの PoC に 1 つずつ（画像は GitHub Actions が OIDC で push する。README「残る課題」）
resource "aws_ecr_repository" "poc" {
  for_each = toset(local.poc_services)

  name = "kimaru-bot/${each.key}"
  # :latest を上書きしていく PoC 運用。本番（#382）は IMMUTABLE ＋ digest 固定にする
  image_tag_mutability = "MUTABLE"
  # destroy で画像ごと消す。画像が残ると destroy が失敗し、保存料（$0.10/GB 月）も残る
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# 保存料を抑えるための自動削除。
#  1. タグ無し（:latest を上書きしたときの古い層）は 1 日で消す
#  2. タグ付きは新しい 5 枚だけ残す（ロールバックできる程度）
resource "aws_ecr_lifecycle_policy" "poc" {
  for_each = aws_ecr_repository.poc

  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "untagged images: expire after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "tagged images: keep the newest 5"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 5
        }
        action = { type = "expire" }
      },
    ]
  })
}
