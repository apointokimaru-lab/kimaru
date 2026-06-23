#!/usr/bin/env bash
# 本番デプロイ後のスモークテスト（読み取り中心・無害）。
# 使い方:  DOMAIN=https://your-site bash scripts/prod-smoke.sh
#    または bash scripts/prod-smoke.sh https://your-site
# データ作成・メール送信はしません（予約作成/決済は手動確認の項を参照）。
set -u
B="${DOMAIN:-${1:-}}"
B="${B%/}"
if [ -z "$B" ]; then echo "DOMAIN を指定してください: DOMAIN=https://your-site bash scripts/prod-smoke.sh"; exit 2; fi
echo "=== smoke against: $B ==="
sc(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
hdr(){ curl -s -D - -o /dev/null "$@"; }
pass=0; info=0
P(){ pass=$((pass+1)); echo "  ✓ $1"; }
I(){ info=$((info+1)); echo "  • $1"; }

echo "-- Edge / ページ --"
rc=$(sc "$B/index.html"); [ "$rc" = "200" ] && P "GET /index.html = 200" || I "GET /index.html = $rc (期待 200)"
curl -s "$B/index.html" | grep -q 'class="site-header"' && P "edge ヘッダー注入あり" || I "site-header 未注入（edge未稼働？）"
dc=$(sc "$B/dashboard.html")
[ "$dc" = "302" ] && P "GET /dashboard.html(未ログイン) = 302→/login" || I "GET /dashboard.html = $dc（期待 302。200なら保護が効いていない）"

echo "-- セキュリティヘッダ --"
H=$(hdr "$B/index.html")
echo "$H" | grep -qi 'strict-transport-security' && P "HSTS あり" || I "HSTS 無し（HTTPS/設定確認）"
echo "$H" | grep -qi 'content-security-policy'   && P "CSP あり"  || I "CSP 無し"
echo "$H" | grep -qi 'x-content-type-options: *nosniff' && P "nosniff あり" || I "nosniff 無し"
echo "$H" | grep -qi 'permissions-policy' && P "Permissions-Policy あり" || I "Permissions-Policy 無し"

echo "-- API（ゲスト） --"
me=$(curl -s "$B/api/me")
echo "$me" | grep -q '"owner":null' && P "/api/me ゲスト owner=null" || I "/api/me = $me"

echo "-- OAuth（H1: state / CSRF） --"
oh=$(hdr "$B/api/google-auth-start")
echo "$oh" | grep -qi 'location:.*accounts.google.com.*state=' && P "google-auth-start → Google(state付き)" || I "google-auth-start に state 無し（GOOGLE_CLIENT_ID未設定だと500）"
echo "$oh" | grep -qi 'set-cookie:.*kimaru_oauth_state=' && P "state cookie 発行あり" || I "state cookie 無し"
cb=$(curl -s -o /dev/null -w "%{redirect_url}" "$B/api/google-auth-callback?code=smoke-fake")
echo "$cb" | grep -q 'error=state' && P "callback(stateなし) → CSRF拒否" || I "callback redirect = $cb（期待 error=state）"

echo "-- Webhook / cron（fail-closed） --"
I "resend-webhook(秘密なし) = $(sc -X POST "$B/api/resend-webhook" -d '{}')  （期待 503=未設定 / 401=不一致）"
I "meeting-notes(秘密なし)  = $(sc -X POST "$B/api/meeting-notes-webhook" -d '{}')  （期待 503）"
I "square-webhook(秘密なし) = $(sc -X POST "$B/api/square-webhook" -d '{}')  （期待 401=共有秘密設定済 / 503=未設定）"
I "reminder dry_run(秘密なし)= $(sc "$B/api/reminder-mails?dry_run=1")  （期待 401）"

echo ""
echo "=== 自動: $pass PASS / $info INFO（INFOは本番設定により期待値が変わる項目） ==="
echo ""
echo "=== 手動確認（ブラウザ・dev で検証不可だった項目） ==="
cat <<'MAN'
  1) Googleログイン: $B/login.html →「Googleでログイン」→ 同意 → /dashboard に着地（state検証込み）。
  2) 予約: 自分の予約ページ($B/b/<slug>)で予約 → 予約確認メール＋ホスト通知メールが届く。
  3) リマインダー: 22分後開始の予約を作る or $B/api/reminder-mails?dry_run=1&secret=<CRON> で対象確認。
  4) Pro課金: Square決済 → /api/square-webhook → /api/me の plan が 'pro' に。
  5) premium=coming soon: 料金/AIアシスト画面が「近日公開（フェーズ2）」表示・premiumが買えない。
  6) 相手管理/AIアシスト: Pro でルールベース提案が出る（OPENAI未設定でも動く）。
MAN
