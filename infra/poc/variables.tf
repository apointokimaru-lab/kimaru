variable "region" {
  description = "AWS リージョン。Bot は東京で動かす（利用者が日本・Zoom/Meet の往復遅延を小さく）"
  type        = string
  default     = "ap-northeast-1"
}

variable "github_repo" {
  description = "GitHub Actions から OIDC で AssumeRole してよいリポジトリ（owner/name）"
  type        = string
  default     = "apointokimaru-lab/kimaru"
}

variable "github_ref_pattern" {
  description = <<-EOT
    OIDC トークンの sub に対する条件の後半（repo:<github_repo>:<この値>）。
    今は "*"（どのブランチ・PR からでも push できる。画像を作る workflow がまだ無く、試す段階のため）。
    ビルド workflow を main_bot だけにしたら "ref:refs/heads/main_bot" に絞る（README「残る課題」）。
  EOT
  type        = string
  default     = "*"
}

variable "task_sizes" {
  description = <<-EOT
    タスク定義ごとの CPU（1024 = 1 vCPU）とメモリ（MiB）。計測しながら変える前提なので変数にしてある。
    Fargate は組み合わせが決まっている（256 → 512〜2048 / 512 → 1024〜4096 / 1024 → 2048〜8192 /
    2048 → 4096〜16384 / 4096 → 8192〜30720、メモリは 1024 刻み）。外れると RegisterTaskDefinition が失敗する。
  EOT
  type = map(object({
    cpu    = number
    memory = number
  }))
  default = {
    meet-bot = { cpu = 1024, memory = 2048 } # Chromium 1 本＋AudioWorklet（#478）。1 会議 1 タスク
    rtms     = { cpu = 256, memory = 512 }   # WebSocket 受信と WAV 書き出しだけ（#475）
    stt      = { cpu = 2048, memory = 4096 } # faster-whisper small/int8 のピーク RSS 1.3 GB（#393）。medium は 3 GB 要る
    smoke    = { cpu = 256, memory = 512 }   # 疎通確認（aws-cli 公式イメージ）
  }
}

variable "images" {
  description = <<-EOT
    タスク定義の画像 URI の上書き（key は meet-bot / rtms / stt）。未指定の key は ECR の :latest。
    例: digest 固定で試すとき { stt = "<registry>/kimaru-bot/stt@sha256:..." }
  EOT
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "CloudWatch Logs の保持日数（PoC のログは 2 週間で十分。長く残すほど保存料が積む）"
  type        = number
  default     = 14
}

variable "audio_expire_days" {
  description = "音声バケットのオブジェクトを自動削除するまでの日数（決定: 音声は 7 日で消す）"
  type        = number
  default     = 7
}

variable "rtms_port" {
  description = "rtms コンテナが Zoom の webhook を待ち受けるポート（poc/rtms の PORT）"
  type        = number
  default     = 3400
}

variable "rtms_ingress_cidrs" {
  description = <<-EOT
    rtms タスクへ webhook を届けるために開ける送信元 CIDR の一覧。既定は空＝インバウンドを一切開けない。
    Zoom の webhook を直接受けて試すときだけ、Zoom の送信元 IP（Zoom のドキュメント参照）を入れて apply する。
  EOT
  type        = list(string)
  default     = []
}
