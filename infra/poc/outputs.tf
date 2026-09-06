output "region" {
  value = data.aws_region.current.region
}

output "ecr_registry" {
  description = "GitHub の ECR_REGISTRY 変数に入れる値（docker login / 画像タグの前半）"
  value       = local.ecr_registry
}

output "ecr_repository_urls" {
  value = { for s, r in aws_ecr_repository.poc : s => r.repository_url }
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.poc.name
}

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.poc.arn
}

output "task_definition_families" {
  description = "run-task.sh の第 1 引数（key）と family 名の対応"
  value = merge(
    { for s, t in aws_ecs_task_definition.poc : s => t.family },
    { smoke = aws_ecs_task_definition.smoke.family },
  )
}

output "task_definition_arns" {
  value = merge(
    { for s, t in aws_ecs_task_definition.poc : s => t.arn },
    { smoke = aws_ecs_task_definition.smoke.arn },
  )
}

output "audio_bucket" {
  value = aws_s3_bucket.audio.bucket
}

output "log_group" {
  value = aws_cloudwatch_log_group.poc.name
}

output "subnet_ids" {
  description = "タスクを置く公開サブネット（既定 VPC の AZ ごとの既定サブネット）"
  value       = data.aws_subnets.default_public.ids
}

output "security_group_id" {
  value = aws_security_group.tasks.id
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "github_actions_role_arn" {
  description = "GitHub の AWS_ROLE_ARN 変数に入れる値"
  value       = aws_iam_role.github_actions.arn
}

output "ssm_parameter_names" {
  description = "秘密を置く SSM Parameter Store の名前（SecureString で手で put してから task definition の secrets に載せる）"
  value       = local.ssm_parameter_names
}
