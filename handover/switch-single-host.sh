#!/usr/bin/env bash
# 单 Host 切换第 2 步：把 dsh-superagent 与 dsh-workbench 装入 web profile。
#
# 默认 dry-run，只检查并打印计划；真正修改宿主机必须显式传 --apply。
# 失败会自动恢复 web profile 并重启旧的 dsh-superagent.service + dsh-web.service。
set -euo pipefail

REPO=/home/zh/www/personalCloud
WORKBENCH="$REPO/task/dsh-workbench"
SA_REPO=/home/zh/src/dsh-superagent
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="$DSH_HOME/profiles/web"
STATE_DIR="$DSH_HOME/state/superagent"
LAN_BASE="http://192.168.31.244:8080"
TAIL_BASE="https://zh-gem-r7.tailb6e152.ts.net:8443"

MODE=dry-run
for arg in "$@"; do
  case "$arg" in
    --apply) MODE=apply ;;
    --dry-run) MODE=dry-run ;;
    -h|--help)
      sed -n '2,8p' "$0"
      echo
      echo "用法: bash $0 [--dry-run|--apply]"
      exit 0
      ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }
plan() { printf '  [计划] %s\n' "$*"; }
run() {
  if [[ "$MODE" == apply ]]; then
    printf '  [执行] %s\n' "$*"
    "$@"
  else
    plan "$*"
  fi
}

say "=== dsh-workbench 单 Host 切换（模式：$MODE）==="
say "web profile: $PROFILE"
say "SA 源码:    $SA_REPO"
say "SA 状态:    $STATE_DIR"

# 预检：源码补丁与构建产物必须先就绪（HANDOVER §1）。
test -f "$SA_REPO/lib/worker-shell-env.js" || die "缺少 $SA_REPO/lib/worker-shell-env.js；请先按 HANDOVER §1 应用 SA 补丁并 pnpm build"
test -f "$SA_REPO/lib/client.js" || die "缺少 $SA_REPO/lib/client.js；请先按 HANDOVER §1 构建"
test -f "$WORKBENCH/client.js" || die "缺少 $WORKBENCH/client.js"
test -f "$PROFILE/package.json" || die "缺少 $PROFILE/package.json"
test -f "$PROFILE/cordis.patch.yml" || die "缺少 $PROFILE/cordis.patch.yml"
test -d "$STATE_DIR" || die "缺少 SA 状态目录 $STATE_DIR"
for cmd in node dsh curl journalctl systemctl ss; do
  command -v "$cmd" >/dev/null 2>&1 || die "找不到命令 $cmd"
done

# 同状态目录只能有一个写者：切换前必须停掉旧 Host。
say
say "将停止（会断开当前 DSH 会话）：dsh-web.service、dsh-superagent.service"
say "备份目录：$HOME/.dsh/backups/dsh-workbench-$(date +%Y%m%d-%H%M%S)"

if [[ "$MODE" != apply ]]; then
  say
  say "dry-run 结束；确认后执行：bash $0 --apply"
  exit 0
fi

B="$HOME/.dsh/backups/dsh-workbench-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B/web" "$B/superagent" "$B/systemd"
cp -a "$DSH_HOME/storages/workspace.json" "$B/workspace.json"
cp -a "$PROFILE/package.json" "$PROFILE/cordis.patch.yml" "$B/web/"
cp -a "$DSH_HOME/profiles/superagent/package.json" "$DSH_HOME/profiles/superagent/cordis.patch.yml" "$B/superagent/" 2>/dev/null || true
cp -a "$STATE_DIR/orchestrator.sqlite" "$STATE_DIR/orchestrator.sqlite-wal" "$STATE_DIR/orchestrator.sqlite-shm" "$B/superagent/" 2>/dev/null || true
cp -a "$HOME/.config/systemd/user/dsh-web.service" "$B/systemd/" 2>/dev/null || true
cp -a "$HOME/.config/systemd/user/dsh-superagent.service" "$B/systemd/" 2>/dev/null || true
echo "$B" > /tmp/dsh-workbench-backup-path
say "备份完成：$B"

ROLLBACK_NEEDED=0
rollback() {
  local rc=$?
  trap - EXIT
  set +e
  if [[ "$ROLLBACK_NEEDED" == 1 ]]; then
    say
    say "!!! 切换失败，开始回滚（退出码 $rc） !!!"
    systemctl --user stop dsh-web.service 2>/dev/null
    cp -a "$B/web/package.json" "$B/web/cordis.patch.yml" "$PROFILE/"
    systemctl --user enable dsh-superagent.service 2>/dev/null
    systemctl --user start dsh-superagent.service 2>/dev/null
    ( cd "$PROFILE" && dsh plugin --profile web install ) 2>&1 | tail -20
    systemctl --user start dsh-web.service 2>/dev/null
    say "已恢复 web profile 并启动旧 Host。备份：$B"
  fi
  exit "$rc"
}
trap rollback EXIT

systemctl --user stop dsh-web.service 2>/dev/null || true
systemctl --user stop dsh-superagent.service 2>/dev/null || true
for i in $(seq 1 20); do
  if ! ss -ltnp 2>/dev/null | grep -Eq ':(3080|3082)[[:space:]]'; then break; fi
  sleep 1
done
ss -ltnp 2>/dev/null | grep -Eq ':(3080|3082)[[:space:]]' && die "3080/3082 仍有监听，停止切换"

ROLLBACK_NEEDED=1

# 只用 Node 修改 JSON，避免 jq 依赖与手写 JSON 语法错误。
node - "$PROFILE/package.json" "$WORKBENCH" "$SA_REPO" <<'NODE'
const fs = require('node:fs')
const [file, workbench, sa] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
pkg.dependencies ??= {}
delete pkg.dependencies['dsh-superagent-workbench']
pkg.dependencies['dsh-workbench'] = `link:${workbench}`
pkg.dependencies['dsh-superagent'] = `link:${sa}`
pkg.dsh ??= {}
pkg.dsh.profile ??= {}
const bundles = (pkg.dsh.profile.bundles ?? []).filter((id) => id !== 'dsh-superagent-workbench' && id !== 'dsh-superagent' && id !== 'dsh-workbench')
const web = bundles.indexOf('@deepseek-ai/dsh-web-app')
if (web < 0) throw new Error('web profile bundles 缺少 @deepseek-ai/dsh-web-app')
bundles.splice(web + 1, 0, 'dsh-superagent', 'dsh-workbench')
pkg.dsh.profile.bundles = bundles
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
NODE

# 幂等追加 SA / workbench 的机器配置行。
PATCH="$PROFILE/cordis.patch.yml"
if ! grep -q '^[[:space:]]*- id: dsh-superagent$' "$PATCH"; then
  cat >> "$PATCH" <<'YAML'

# dsh-superagent：单 Host 运行；与旧 superagent profile 使用同一状态目录。
- id: dsh-superagent
  config:
    stateDir: /home/zh/.dsh/state/superagent
- id: dsh-superagent-feishu
  disabled: false
YAML
fi
if ! grep -q '^[[:space:]]*- id: dsh-workbench$' "$PATCH"; then
  cat >> "$PATCH" <<'YAML'
# dsh-workbench：首次切换先关闭自动清理，人工 dry-run 后再启用。
- id: dsh-workbench
  config:
    retentionAutoCleanup: false
YAML
fi

say
say "=== 安装 web profile 依赖 ==="
( cd "$PROFILE" && dsh plugin --profile web install )

# 启动前证明两个 bundle 在 profile 内可解析，避免“skipping profile bundle”。
for p in dsh-workbench dsh-superagent; do
  test -f "$PROFILE/node_modules/$p/package.json" || die "安装后仍缺少 $PROFILE/node_modules/$p/package.json"
done
( cd "$PROFILE" && node --input-type=module -e "console.log(import.meta.resolve('dsh-workbench')); console.log(import.meta.resolve('dsh-superagent'))" ) >/tmp/dsh-workbench-resolve.txt \
  || die "dsh-workbench / dsh-superagent 无法在 web profile 内解析"
say "bundle 解析通过："
sed 's/^/  /' /tmp/dsh-workbench-resolve.txt

START=$(date '+%Y-%m-%d %H:%M:%S')
say
say "=== 启动 dsh-web.service（$START） ==="
systemctl --user start dsh-web.service
systemctl --user reset-failed dsh-web.service 2>/dev/null || true

# 等待 Host 注册路由（无登录态应为 401）。
ROOT_CODE=000
for i in $(seq 1 60); do
  ROOT_CODE=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:3080/" 2>/dev/null || true)
  [[ "$ROOT_CODE" == 401 ]] && break
  sleep 1
done
[[ "$ROOT_CODE" == 401 ]] || die "dsh-web 未就绪：127.0.0.1:3080/ 返回 $ROOT_CODE（应为 401）"

# 等待插件日志出现；SA setup 可能比 Host 路由慢。
LOG=""
READY=0
for i in $(seq 1 120); do
  LOG=$(journalctl --user -u dsh-web.service --since "$START" --no-pager 2>/dev/null || true)
  if grep -q 'dsh-workbench ready:' <<<"$LOG" && grep -Eq 'dsh-superagent (ready|is waiting for setup)' <<<"$LOG"; then
    READY=1
    break
  fi
  sleep 1
done
[[ "$READY" == 1 ]] || {
  echo "--- 启动日志（最后 80 行）---" >&2
  tail -80 <<<"$LOG" >&2
  die "等待 dsh-workbench ready / dsh-superagent ready 超时"
}
if grep -Eq 'skipping profile bundle "(dsh-workbench|dsh-superagent)"|requires a loopback Web server|Lock file is already being held' <<<"$LOG"; then
  echo "--- 启动日志（最后 80 行）---" >&2
  tail -80 <<<"$LOG" >&2
  die "启动日志出现 bundle/loopback/lock 错误"
fi
say "插件启动日志通过：dsh-workbench ready + dsh-superagent ready"

# 用 Host 本次打印的 token 验证登录与 WebSocket/SSE 两条客户端通道。
TOKEN_URL=$(grep -E '^dsh web: https?://' <<<"$LOG" | tail -1 | sed 's/^dsh web: //')
[[ -n "$TOKEN_URL" ]] || die "启动日志里没有 dsh web 登录 URL"
LAN_URL=$(node -e '
const raw = process.argv[1]
const u = new URL(raw)
u.protocol = "http:"
u.host = "192.168.31.244:8080"
process.stdout.write(u.href)
' "$TOKEN_URL")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; rollback' EXIT

COOKIE_JAR="$TMP/cookies.txt"
HDR="$TMP/exchange.headers"
CODE=$(curl -sS --noproxy '*' -o /dev/null -D "$HDR" -c "$COOKIE_JAR" -w '%{http_code}' "$LAN_URL" || true)
[[ "$CODE" == 303 ]] || die "局域网 token 交换返回 $CODE（应为 303）：$LAN_BASE"
CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' "$LAN_BASE/" || true)
[[ "$CODE" == 200 ]] || die "局域网登录后首页返回 $CODE（应为 200）"
CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' "$LAN_BASE/dsh-workbench/api" || true)
[[ "$CODE" == 200 ]] || die "dsh-workbench 路由返回 $CODE（应为 200）"

# WebSocket Upgrade：101 即成功；连接保持到 curl 超时是正常的。
WS_HDR="$TMP/ws.headers"
curl -sS --noproxy '*' --http1.1 --max-time 5 -D "$WS_HDR" -o /dev/null -b "$COOKIE_JAR" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG9Xb3JsZDEyMzQ1Ng==' "$LAN_BASE/api/remote.mux" >/dev/null 2>&1 || true
grep -q '101 Switching Protocols' "$WS_HDR" || die "局域网 /api/remote.mux 未返回 101（WebSocket 通道不通）"

SSE="$TMP/sse.txt"
timeout 8 curl -sS --noproxy '*' -b "$COOKIE_JAR" -N "$LAN_BASE/plugins/events" >"$SSE" 2>/dev/null || true
grep -q ': connected' "$SSE" || die "/plugins/events 未返回 SSE connected"
grep -q '"type":"graph"' "$SSE" || die "/plugins/events 未返回插件图"

ROLLBACK_NEEDED=0
systemctl --user disable dsh-superagent.service >/dev/null 2>&1 || true
trap - EXIT
rm -rf "$TMP"

say
say "=== 切换成功 ==="
say "局域网入口：$LAN_BASE"
say "本次登录 URL（局域网；Token 敏感，勿外传）："
say "  $LAN_URL"
say "Tailnet 入口（仅 tailnet 设备）：$TAIL_BASE"
say "若之后重启 dsh-web，用 journalctl 取新 token 后把 origin 换成 $LAN_BASE："
say "  journalctl --user -u dsh-web.service -o cat --since '10 min ago' | grep '^dsh web:' | tail -1"
say "自动清理已关闭；确认 dry-run 后把 cordis.patch.yml 的 retentionAutoCleanup 改为 true。"
