# タスク定義（arm64 = Graviton・awsvpc・Fargate）。
# 3 つの PoC は「登録だけ」で、画像が ECR に入るまで起動できない。smoke は公開画像だけで動く疎通確認。
#
# 環境変数の名前は各 PoC の .env.example に合わせてある（poc/meet-bot・poc/rtms）。S3 まわり
# （S3_BUCKET / S3_PREFIX）は PoC 側にまだ無く、コンテナ化するときに「終了時に out/ を S3 へ同期する」
# 入口スクリプトで使う想定の名前。秘密（Zoom の client secret 等）はここに書かない。
# SSM Parameter Store に置いてから container_definitions の "secrets" で参照する（名前は outputs の ssm_parameter_names）。

locals {
  common_env = {
    AWS_REGION         = data.aws_region.current.region
    AWS_DEFAULT_REGION = data.aws_region.current.region
    S3_BUCKET          = aws_s3_bucket.audio.bucket
  }

  poc_containers = {
    meet-bot = {
      env = {
        MEET_OUT_DIR       = "/data/out"
        MEET_PROFILE_DIR   = "/data/profile" # ログイン済み Chromium プロファイル。起動時に S3 から展開する想定（README）
        MEET_HEADLESS      = "1"
        MEET_CHUNK_SECONDS = "900"
        STT_WHEN           = "after"
        S3_PREFIX          = "meet/"
      }
      port    = null
      secrets = [] # Google の秘密は env ではなくプロファイル（ディレクトリ）なので SSM には置かない
    }
    rtms = {
      env = {
        PORT               = tostring(var.rtms_port)
        WEBHOOK_PATH       = "/webhook"
        RTMS_OUT_DIR       = "/data/out"
        RTMS_CHUNK_SECONDS = "900"
        RTMS_BUFFER_DATA   = "true"
        S3_PREFIX          = "rtms/"
      }
      port    = var.rtms_port
      secrets = ["ZOOM_RTMS_CLIENT_ID", "ZOOM_RTMS_CLIENT_SECRET", "ZOOM_WEBHOOK_SECRET_TOKEN"]
    }
    stt = {
      env = {
        STT_MODEL     = "small"       # #393 の計測: CPU では small だけが RTF ≤ 0.25 を満たす
        STT_THREADS   = "2"           # task_sizes.stt.cpu / 1024 に合わせる
        STT_MODEL_DIR = "/opt/models" # 画像に同梱する場所（実行時に Hugging Face から落とさない）
        STT_OUT_DIR   = "/data/out"
        S3_PREFIX     = "stt/"
      }
      port    = null
      secrets = []
    }
  }

  # 後で SSM に置く秘密のパラメータ名（今は名前だけ。outputs で見せる）
  ssm_parameter_names = {
    for s, c in local.poc_containers :
    s => [for k in c.secrets : "${local.ssm_prefix}/${s}/${k}"]
  }

  log_configuration = {
    for s in concat(local.poc_services, ["smoke"]) :
    s => {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.poc.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = s
      }
    }
  }
}

resource "aws_ecs_task_definition" "poc" {
  for_each = local.poc_containers

  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_sizes[each.key].cpu
  memory                   = var.task_sizes[each.key].memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  # Graviton（arm64）。x86 より vCPU 単価が 20% 安い。画像も arm64 でビルドすること
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  # /data はタスクの一時ストレージ（20 GB まで無料枠）に置く。画像に /data が無くても作られる
  volume {
    name = "data"
  }

  container_definitions = jsonencode([
    merge(
      {
        name      = each.key
        image     = local.images[each.key]
        essential = true
        # キーを sort して並びを固定する（並びが変わるだけで差分が出るのを避ける）
        environment = [
          for k in sort(keys(merge(local.common_env, each.value.env))) :
          { name = k, value = merge(local.common_env, each.value.env)[k] }
        ]
        mountPoints = [
          { sourceVolume = "data", containerPath = "/data", readOnly = false }
        ]
        logConfiguration = local.log_configuration[each.key]
      },
      each.value.port == null ? {} : {
        portMappings = [
          { containerPort = each.value.port, hostPort = each.value.port, protocol = "tcp" }
        ]
      },
    )
  ])
}

# 疎通確認。自前の画像無しで「公開サブネットから外に出られる」「ログが CloudWatch に出る」
# 「タスクロールで S3 に書ける」「arm64 で動く」を一度に確かめる。aws-cli 公式画像は arm64 の manifest を持つ
locals {
  smoke_command = <<-EOT
    set -e
    echo "smoke start arch=$(uname -m) host=$(cat /etc/hostname)"
    echo "task role: $(aws sts get-caller-identity --query Arn --output text)"
    KEY="smoke/$(date +%s).txt"
    aws s3 cp --no-progress /etc/hostname "s3://$S3_BUCKET/$KEY"
    echo "smoke ok s3://$S3_BUCKET/$KEY"
  EOT
}

resource "aws_ecs_task_definition" "smoke" {
  family                   = "${local.name}-smoke"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_sizes["smoke"].cpu
  memory                   = var.task_sizes["smoke"].memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name       = "smoke"
      image      = "public.ecr.aws/aws-cli/aws-cli:latest"
      essential  = true
      entryPoint = ["/bin/sh", "-c"] # 画像の entrypoint は aws なので sh に差し替える
      command    = [local.smoke_command]
      environment = [
        for k in sort(keys(local.common_env)) : { name = k, value = local.common_env[k] }
      ]
      logConfiguration = local.log_configuration["smoke"]
    }
  ])
}
