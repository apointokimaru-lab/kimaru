# ECS タスクの 2 つのロール。
#  - 実行ロール: ECS エージェントが画像を引き、ログを書き、（後で）SSM から秘密を読むために使う
#  - タスクロール: コンテナの中のコードが S3 に音声を書くために使う（バケット 1 つだけ）
# 2 つを分けるのは、コンテナの中のコードに ECR/SSM の権限を持たせないため。

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # confused deputy 対策: 自分のアカウントの ECS からしか引き受けさせない
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

# --- 実行ロール ---------------------------------------------------------------------------------
resource "aws_iam_role" "task_execution" {
  name               = "${local.name}-task-execution"
  description        = "kimaru-bot PoC: ECS task execution (pull from ECR, write logs, read SSM under ${local.ssm_prefix})"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task_execution" {
  # ECR のログイン。この API だけは資源を指定できない
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # 画像の pull は自分の 3 リポジトリだけ（AWS 管理ポリシー AmazonECSTaskExecutionRolePolicy は "*" なので使わない）
  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [for r in aws_ecr_repository.poc : r.arn]
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.poc.arn}:*"]
  }

  # 秘密は SSM Parameter Store（SecureString）に置く予定。読めるのはこの接頭辞の下だけ。
  # 既定の AWS 管理鍵（aws/ssm）で暗号化するなら kms:Decrypt は要らない（鍵ポリシー側で許されている）。
  # 自前の KMS 鍵にしたときだけ kms:Decrypt を足す
  statement {
    sid = "SsmSecrets"
    actions = [
      "ssm:GetParameters",
      "ssm:GetParameter",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.region}:${local.account_id}:parameter${local.ssm_prefix}/*",
    ]
  }
}

resource "aws_iam_role_policy" "task_execution" {
  name   = "task-execution"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution.json
}

# --- タスクロール -------------------------------------------------------------------------------
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  description        = "kimaru-bot PoC: what the containers themselves may do (S3 audio bucket only)"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "AudioBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.audio.arn]
  }

  # Put/Get に加えてマルチパートの中断・一覧を許す（大きい WAV の put は内部でマルチパートになり、
  # 失敗時に Abort できないと「見えないパーツ」に課金され続ける）。Delete は許さない（削除はライフサイクル任せ）
  statement {
    sid = "AudioBucketObjects"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.audio.arn}/*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
