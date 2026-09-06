locals {
  # 資源名の共通接頭辞（クラスター名でもある）
  name = "kimaru-bot-poc"

  account_id = data.aws_caller_identity.current.account_id
  # S3 バケット名は全世界で一意なので、アカウント ID の下 6 桁を付ける（state バケットと同じ規則）
  account_suffix = substr(local.account_id, length(local.account_id) - 6, 6)
  audio_bucket   = "kimaru-bot-audio-${local.account_suffix}"

  # 秘密（Zoom の client secret 等）を後で置く SSM Parameter Store の接頭辞。
  # 実行ロールの読み取り許可はこの下だけに絞る（iam.tf）
  ssm_prefix = "/kimaru-bot/poc"

  # PoC のサービス名 = ECR リポジトリ名の後半 = タスク定義名の後半
  poc_services = ["meet-bot", "rtms", "stt"]

  ecr_registry = "${local.account_id}.dkr.ecr.${data.aws_region.current.region}.amazonaws.com"

  # 画像 URI: 変数で上書きが無ければ自分の ECR の :latest（画像はまだ無い。GitHub Actions が後で push する）
  images = {
    for s in local.poc_services :
    s => lookup(var.images, s, "${aws_ecr_repository.poc[s].repository_url}:latest")
  }
}
