# タスクに付けるセキュリティグループ。外向き（ECR/S3/CloudWatch・Zoom・Google Meet）だけを許し、
# 内向きは既定で何も開けない。パブリック IP を付けて公開サブネットに置くので、ここが唯一の壁になる。
resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "kimaru-bot PoC Fargate tasks: egress only (rtms webhook ingress is opt-in)"
  vpc_id      = data.aws_vpc.default.id

  tags = {
    Name = "${local.name}-tasks"
  }
}

resource "aws_vpc_security_group_egress_rule" "all_ipv4" {
  security_group_id = aws_security_group.tasks.id
  description       = "all outbound (ECR/S3/CloudWatch/Zoom/Meet)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# rtms は Zoom からの webhook（POST）を受ける必要があるので、送信元を限って開けられるようにしておく。
# 変数が空（既定）なら 1 つも作られない
resource "aws_vpc_security_group_ingress_rule" "rtms_webhook" {
  for_each = toset(var.rtms_ingress_cidrs)

  security_group_id = aws_security_group.tasks.id
  description       = "Zoom webhook -> rtms"
  ip_protocol       = "tcp"
  from_port         = var.rtms_port
  to_port           = var.rtms_port
  cidr_ipv4         = each.value
}
