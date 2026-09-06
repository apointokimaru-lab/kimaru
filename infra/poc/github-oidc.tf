# GitHub Actions が長期のアクセスキー無しで AWS に入るための OIDC 連携。
# 使い方（後で作るビルド workflow 側）:
#   permissions: { id-token: write, contents: read }
#   - uses: aws-actions/configure-aws-credentials@v4
#     with: { role-to-assume: ${{ vars.AWS_ROLE_ARN }}, aws-region: ${{ vars.AWS_REGION }} }
#
# 既にアカウントに同じ provider がある場合（1 アカウントに 1 つしか作れない）は作らずに取り込む:
#   terraform import aws_iam_openid_connect_provider.github \
#     arn:aws:iam::<account id>:oidc-provider/token.actions.githubusercontent.com
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # sub は "repo:<owner>/<repo>:ref:refs/heads/<branch>" や "repo:...:pull_request" の形。
    # 今は末尾 "*" で全 ref を許す（variables.tf の github_ref_pattern）
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:${var.github_ref_pattern}"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name                 = "kimaru-bot-github-actions"
  description          = "GitHub Actions (${var.github_repo}): push images to ECR and register task definitions"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_actions" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # push と pull（キャッシュ用）を 3 リポジトリだけに
  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:ListImages",
    ]
    resources = [for r in aws_ecr_repository.poc : r.arn]
  }

  # 新しい画像でタスク定義を更新する。この 2 つは API の仕様上、資源を絞れない（"*" 必須）。
  # RunTask や Update は含めない（実行は人が run-task.sh で行う）
  statement {
    sid = "TaskDefinition"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
    ]
    resources = ["*"]
  }

  # タスク定義に実行ロール・タスクロールを載せるための PassRole。ECS タスクに渡すときだけ
  statement {
    sid     = "PassTaskRoles"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task_execution.arn,
      aws_iam_role.task.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_actions" {
  name   = "github-actions"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions.json
}
