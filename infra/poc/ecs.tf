# ECS のサービスリンクロール。新規アカウントには無く、クラスター作成時に ECS が自動で作るが、
# 自動作成とキャパシティプロバイダの登録が競合して「Unable to assume the service linked role」で落ちることがある。
# Terraform で先に作っておけば順序が固定され、destroy で消える（手で作った資源を残さない・#483）
resource "aws_iam_service_linked_role" "ecs" {
  aws_service_name = "ecs.amazonaws.com"
  description      = "kimaru-bot PoC: created by Terraform so that cluster creation does not race the auto-creation"
}

# アプリのログ（awslogs ドライバの送り先）。ストリーム名は <タスク定義の後半>/<コンテナ名>/<タスク ID>
resource "aws_cloudwatch_log_group" "poc" {
  name              = "/kimaru-bot/poc"
  retention_in_days = var.log_retention_days
}

# Container Insights の性能ログ。ECS が自動で作ると保持が「無期限」になり、放っておくと保存料が積むので
# 先に保持日数付きで作っておく（同名があれば ECS はそれを使う）。destroy で一緒に消える
resource "aws_cloudwatch_log_group" "container_insights" {
  name              = "/aws/ecs/containerinsights/${local.name}/performance"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "poc" {
  name = local.name

  # 標準の Container Insights（enhanced ではない）。タスクの CPU/メモリ使用量を
  # ECS/ContainerInsights 名前空間に出す。何も動いていなければ指標も出ず、費用もかからない
  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  depends_on = [
    aws_iam_service_linked_role.ecs,
    aws_cloudwatch_log_group.container_insights,
  ]
}

# FARGATE（オンデマンド）と FARGATE_SPOT の両方を使えるようにする。どちらで動かすかは run-task 時に選ぶ
# （scripts/run-task.sh の第 2 引数）。既定はオンデマンド（Spot は中断され得るので、既定にはしない）
resource "aws_ecs_cluster_capacity_providers" "poc" {
  cluster_name = aws_ecs_cluster.poc.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 0
  }
}
