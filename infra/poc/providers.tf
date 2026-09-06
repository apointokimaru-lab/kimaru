provider "aws" {
  region = var.region

  # 作る資源すべてに同じタグを付ける。Cost Explorer で「PoC の費用」だけをタグ集計できるようにするため。
  # （state 用バケットは Terraform 管理外なので scripts/bootstrap-state.sh が同じタグを付ける）
  default_tags {
    tags = {
      Project   = "kimaru-bot"
      Env       = "poc"
      ManagedBy = "terraform"
    }
  }
}
