#!/usr/bin/env bash
# 单 Host 切换第 2 步：把 dsh-superagent 与 dsh-workbench 装入 web profile。
#
# 默认 dry-run，只检查并打印计划；真正修改宿主机必须显式传 --apply。
# 失败会自动恢复 web profile 并重启旧的 dsh-superagent.service + dsh-web.service。
#
# 用法：
#   bash switch-single-host.sh --dry-run
#   bash switch-single-host.sh --apply
#   bash switch-single-host.sh --apply --keep   # 失败不回滚，保留服务与临时文件现场
#   bash switch-single-host.sh --apply --debug  # bash -x；诊断更详细，临时文件保留
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
KEEP=0
DEBUG=0
for arg in "$@"; do
  case "$arg" in
    --apply) MODE=apply ;;
    --dry-run) MODE=dry-run ;;
    --keep) KEEP=1 ;;
    --debug) DEBUG=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      echo
      echo "用法: bash $0 [--dry-run|--apply] [--keep] [--debug]"
      echo "  --keep   失败时不自动回滚，保留服务、备份与临时诊断文件"
      echo "  --debug  输出 bash 执行 trace；失败时保留临时文件（可能含 token，勿外传）"
      exit 0
      ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done
if [[ "$DEBUG" == 1 ]]; then
  PS4='+ [${BASH_SOURCE##*/}:${LINENO}] '
  set -x
fi

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

say "=== dsh-workbench 单 Host 切换（模式：$MODE，keep=$KEEP，debug=$DEBUG）==="
say "web profile: $PROFILE"
say "SA 源码:    $SA_REPO"
say "SA 状态:    $STATE_DIR"

# 预检：源码补丁、延迟启动修复与构建产物必须先就绪（HANDOVER §1）。
test -f "$SA_REPO/lib/worker-shell-env.js" || die "缺少 $SA_REPO/lib/worker-shell-env.js；请先按 HANDOVER §1 应用 SA 补丁并 pnpm build"
test -f "$SA_REPO/lib/client.js" || die "缺少 $SA_REPO/lib/client.js；请先按 HANDOVER §1 构建"
test -f "$SA_REPO/src/index.ts" || die "缺少 $SA_REPO/src/index.ts"
test -f "$SA_REPO/lib/index.js" || die "缺少 $SA_REPO/lib/index.js；请先按 HANDOVER §1 构建"
grep -Fq 'void runtime.ready.then' "$SA_REPO/src/index.ts" \
  || die "SA 源码未包含延迟启动修复（src/index.ts 缺少 'void runtime.ready.then'）；请先应用 dsh-superagent-defer-ready.patch"
grep -Fq 'runtime.ready.then' "$SA_REPO/lib/index.js" \
  || die "SA 构建产物未包含延迟启动修复（lib/index.js 缺少 'runtime.ready.then'）；请重新 pnpm build"
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
cp -a "$HOME/.config/systemd/user/dsh-web.service.d" "$B/systemd/" 2>/dev/null || true
cp -a "$HOME/.config/systemd/user/dsh-superagent.service.d" "$B/systemd/" 2>/dev/null || true
systemctl --user status dsh-web.service dsh-superagent.service --no-pager > "$B/status-before.txt" 2>&1 || true
ss -ltnp 2>/dev/null | grep -E ':(3080|3082|8443)[[:space:]]' > "$B/ports-before.txt" 2>&1 || true
echo "$B" > /tmp/dsh-workbench-backup-path
say "备份完成：$B"

TMP=$(mktemp -d /tmp/dsh-workbench-switch.XXXXXX)
LOG=""
START=""
STATE_FILE="$TMP/sa-state.json"
COOKIE_JAR="$TMP/cookies.txt"
ROLLBACK_NEEDED=0

# 回滚安装前清掉旧备份里可能仍悬空的 dsh-superagent-workbench：
# 它的源码目录 task/superagent-workbench 已不存在，不清理会让
# `dsh plugin --profile web install` 再次报 cannot resolve profile bundle。
sanitize_web_package() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  node - "$file" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
if (pkg.dependencies) delete pkg.dependencies['dsh-superagent-workbench']
const bundles = pkg.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  pkg.dsh.profile.bundles = bundles.filter((id) => id !== 'dsh-superagent-workbench')
}
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
NODE
  if [[ -L "$PROFILE/node_modules/dsh-superagent-workbench" ]]; then
    rm -f "$PROFILE/node_modules/dsh-superagent-workbench"
  fi
}

# 只把影响 dsh-workbench / dsh-superagent 的启动错误视为致命。
# profile 里其他插件的 failed to import（如既有的 dsh-context-guard 缺包）是独立警告，
# 不能因为一条泛化的 "failed to import" 就中止切换。
fatal_log() {
  # 必须始终返回 0：调用方在 set -e 下用 FATAL=$(fatal_log ...) 取值，
  # grep 无匹配返回 1 会让脚本在“没有致命错误”时直接退出。
  grep -E 'skipping profile bundle "(dsh-workbench|dsh-superagent)"|requires a loopback Web server|Lock file is already being held|dsh-superagent failed to start|(dsh-workbench|dsh-superagent).*failed to import|failed to import.*(dsh-workbench|dsh-superagent)' <<<"$1" || true
}

collect_diagnostics() {
  local reason="$1"
  local out="$B/diagnostics-$(date +%Y%m%d-%H%M%S).log"
  set +e
  {
    echo "=== dsh-workbench 切换诊断 ==="
    echo "时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "原因：$reason"
    echo "模式：apply；keep=$KEEP；debug=$DEBUG"
    echo "备份：$B"
    echo "启动时间：${START:-<尚未启动>}"
    echo
    echo "=== systemctl status ==="
    systemctl --user status dsh-web.service dsh-superagent.service --no-pager 2>&1
    echo
    echo "=== 端口监听 ==="
    ss -ltnp 2>&1 | grep -E ':(3080|3082|8443)[[:space:]]' || true
    echo
    echo "=== dsh-web 完整 journal（since ${START:-all}）==="
    if [[ -n "$START" ]]; then
      journalctl --user -u dsh-web.service --since "$START" --no-pager 2>&1
    else
      journalctl --user -u dsh-web.service -n 500 --no-pager 2>&1
    fi
    echo
    echo "=== 定向日志（关键字）==="
    if [[ -n "$START" ]]; then
      journalctl --user -u dsh-web.service --since "$START" --no-pager 2>&1 \
        | grep -nE 'dsh web:|dsh-workbench|dsh-superagent|skipping profile bundle|failed to import|did not activate|Lock file|loopback|EADDRINUSE|ERR_MODULE_NOT_FOUND|Cannot find|error' || true
    fi
    echo
    echo "=== HTTP 探测（无/有登录态）==="
    printf '127.0.0.1:3080/ = '
    curl -sS --noproxy '*' -o /dev/null -w '%{http_code}\n' --max-time 3 http://127.0.0.1:3080/ 2>&1 || true
    printf '127.0.0.1:3082/ = '
    curl -sS --noproxy '*' -o /dev/null -w '%{http_code}\n' --max-time 3 http://127.0.0.1:3082/ 2>&1 || true
    if [[ -f "$COOKIE_JAR" ]]; then
      printf 'workbench/api = '
      curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}\n' --max-time 3 "$LAN_BASE/dsh-workbench/api" 2>&1 || true
      printf 'orchestrator/api/state = '
      curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}\n' --max-time 3 "$LAN_BASE/orchestrator/api/state" 2>&1 || true
    fi
    echo
    echo "=== SA /state 最近响应 ==="
    if [[ -f "$STATE_FILE" ]]; then cat "$STATE_FILE"; else echo '<无>'; fi
    echo
    echo "=== web profile package.json ==="
    cat "$PROFILE/package.json" 2>&1
    echo
    echo "=== bundle 解析 ==="
    ( cd "$PROFILE" && node --input-type=module -e "console.log(import.meta.resolve('dsh-workbench')); console.log(import.meta.resolve('dsh-superagent'))" ) 2>&1
    echo
    echo "=== 悬空 dsh-superagent-workbench 检查 ==="
    if [[ -e "$PROFILE/node_modules/dsh-superagent-workbench" ]]; then
      ls -ld "$PROFILE/node_modules/dsh-superagent-workbench" 2>&1
    else
      echo 'node_modules 中无 dsh-superagent-workbench'
    fi
    grep -n 'dsh-superagent-workbench' "$PROFILE/package.json" "$PROFILE/cordis.patch.yml" 2>/dev/null || true
  } >"$out" 2>&1
  cat "$out" >&2
  say "完整诊断已保存：$out"
  set -e
}

rollback() {
  local rc="${1:-$?}"
  set +e
  say
  say "!!! 切换失败，开始回滚（退出码 $rc） !!!"
  systemctl --user stop dsh-web.service 2>/dev/null
  if [[ -f "$B/web/package.json" ]]; then
    cp -a "$B/web/package.json" "$B/web/cordis.patch.yml" "$PROFILE/"
    sanitize_web_package "$PROFILE/package.json"
  fi
  if [[ -f "$B/systemd/dsh-web.service" ]]; then cp -a "$B/systemd/dsh-web.service" "$HOME/.config/systemd/user/"; fi
  if [[ -f "$B/systemd/dsh-superagent.service" ]]; then cp -a "$B/systemd/dsh-superagent.service" "$HOME/.config/systemd/user/"; fi
  if [[ -d "$B/systemd/dsh-web.service.d" ]]; then cp -a "$B/systemd/dsh-web.service.d" "$HOME/.config/systemd/user/"; fi
  if [[ -d "$B/systemd/dsh-superagent.service.d" ]]; then cp -a "$B/systemd/dsh-superagent.service.d" "$HOME/.config/systemd/user/"; fi
  systemctl --user daemon-reload 2>/dev/null
  systemctl --user enable dsh-superagent.service 2>/dev/null
  systemctl --user start dsh-superagent.service 2>/dev/null
  ( cd "$PROFILE" && dsh plugin --profile web install ) 2>&1 | tail -20
  systemctl --user reset-failed dsh-web.service 2>/dev/null
  systemctl --user start dsh-web.service 2>/dev/null
  local old_3082=0 old_3080=0
  for _ in $(seq 1 30); do
    curl -sS --noproxy '*' -o /dev/null --max-time 1 http://127.0.0.1:3082/ 2>/dev/null && old_3082=1
    [[ "$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 1 http://127.0.0.1:3080/ 2>/dev/null || true)" == 401 ]] && old_3080=1
    [[ "$old_3082" == 1 && "$old_3080" == 1 ]] && break
    sleep 1
  done
  say "回滚完成：3082=$old_3082，3080(401)=$old_3080；备份：$B"
  set -e
}

on_exit() {
  local rc=$?
  trap - EXIT
  set +e
  if [[ "$rc" -ne 0 ]]; then
    collect_diagnostics "切换失败（退出码 $rc）"
    if [[ "$ROLLBACK_NEEDED" == 1 ]]; then
      if [[ "$KEEP" == 1 ]]; then
        say "!!! --keep：跳过自动回滚，保留失败现场 !!!"
        say "备份：$B"
        say "确认现场后可用备份手动恢复：$B/web/package.json、$B/web/cordis.patch.yml"
      else
        rollback "$rc"
      fi
    fi
    if [[ "$KEEP" == 1 || "$DEBUG" == 1 ]]; then
      say "临时文件保留：$TMP"
    else
      rm -rf "$TMP"
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT

ROLLBACK_NEEDED=1
systemctl --user stop dsh-web.service 2>/dev/null || true
systemctl --user stop dsh-superagent.service 2>/dev/null || true
for i in $(seq 1 20); do
  if ! ss -ltnp 2>/dev/null | grep -Eq ':(3080|3082)[[:space:]]'; then break; fi
  sleep 1
done
ss -ltnp 2>/dev/null | grep -Eq ':(3080|3082)[[:space:]]' && die "3080/3082 仍有监听，停止切换"

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
if [[ -L "$PROFILE/node_modules/dsh-superagent-workbench" ]]; then
  rm -f "$PROFILE/node_modules/dsh-superagent-workbench"
fi

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
if ! ( cd "$PROFILE" && dsh plugin --profile web install ); then
  die "dsh plugin --profile web install 失败"
fi

# 启动前证明两个 bundle 在 profile 内可解析，避免“skipping profile bundle”。
for p in dsh-workbench dsh-superagent; do
  test -f "$PROFILE/node_modules/$p/package.json" || die "安装后仍缺少 $PROFILE/node_modules/$p/package.json"
done
( cd "$PROFILE" && node --input-type=module -e "console.log(import.meta.resolve('dsh-workbench')); console.log(import.meta.resolve('dsh-superagent'))" ) >"$TMP/resolve.txt" \
  || die "dsh-workbench / dsh-superagent 无法在 web profile 内解析"
say "bundle 解析通过："
sed 's/^/  /' "$TMP/resolve.txt"

START=$(date '+%Y-%m-%d %H:%M:%S')
say
say "=== 启动 dsh-web.service（$START） ==="
systemctl --user reset-failed dsh-web.service 2>/dev/null || true
systemctl --user start dsh-web.service

# 等待 Host 注册路由（无登录态应为 401）。
ROOT_CODE=000
for i in $(seq 1 60); do
  ROOT_CODE=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:3080/" 2>/dev/null || true)
  [[ "$ROOT_CODE" == 401 ]] && break
  sleep 1
done
[[ "$ROOT_CODE" == 401 ]] || die "dsh-web 未就绪：127.0.0.1:3080/ 返回 $ROOT_CODE（应为 401）"

# 从 journal 取本次登录 URL；登录后所有就绪判断都走 HTTP，不依赖 ctx.logger.info。
TOKEN_URL=""
for i in $(seq 1 60); do
  # -o cat 去掉 journal 的时间/进程前缀，才能用 ^dsh web: 提取 token URL。
  LOG=$(journalctl --user -u dsh-web.service --since "$START" -o cat --no-pager 2>/dev/null || true)
  FATAL=$(fatal_log "$LOG")
  if [[ -n "$FATAL" ]]; then
    say "$FATAL" >&2
    die "启动日志出现致命错误（见上方匹配行与下方完整诊断）"
  fi
  TOKEN_URL=$(grep -E '^dsh web: https?://' <<<"$LOG" | tail -1 | sed 's/^dsh web: //')
  [[ -n "$TOKEN_URL" ]] && break
  sleep 1
done
[[ -n "$TOKEN_URL" ]] || die "启动日志里没有 dsh web 登录 URL"

LAN_URL=$(node -e '
const raw = process.argv[1]
const u = new URL(raw)
u.protocol = "http:"
u.host = "192.168.31.244:8080"
process.stdout.write(u.href)
' "$TOKEN_URL")

CODE=$(curl -sS --noproxy '*' -o /dev/null -D "$TMP/exchange.headers" -c "$COOKIE_JAR" -w '%{http_code}' --max-time 10 "$LAN_URL" || true)
[[ "$CODE" == 303 ]] || die "局域网 token 交换返回 $CODE（应为 303）：$LAN_BASE"
CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 10 "$LAN_BASE/" || true)
[[ "$CODE" == 200 ]] || die "局域网登录后首页返回 $CODE（应为 200）"

# HTTP 就绪：workbench 路由 + SA /orchestrator/api/state。
# SA 正常态：health.runtime.state == "ready"；未完成设置：setup.problem != null。
SA_HTTP_READY=0
WB_CODE=000
SA_CODE=000
for i in $(seq 1 120); do
  WB_CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 3 "$LAN_BASE/dsh-workbench/api" 2>/dev/null || true)
  SA_CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o "$STATE_FILE" -w '%{http_code}' --max-time 3 "$LAN_BASE/orchestrator/api/state" 2>/dev/null || true)
  if [[ "$WB_CODE" == 200 && "$SA_CODE" == 200 && -s "$STATE_FILE" ]]; then
    SA_KIND=$(node -e '
      const d = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
      const state = d?.health?.runtime?.state
      if (state === "ready") process.stdout.write("ready")
      else if (d?.setup?.problem) process.stdout.write("setup")
      else process.stdout.write(`waiting:${state ?? "unknown"}`)
    ' "$STATE_FILE" 2>/dev/null || echo parse-error)
    if [[ "$SA_KIND" == ready || "$SA_KIND" == setup ]]; then
      SA_HTTP_READY=1
      say "HTTP 就绪：workbench API=200，SA runtime=$SA_KIND"
      break
    fi
  fi
  # -o cat 去掉 journal 的时间/进程前缀，才能用 ^dsh web: 提取 token URL。
  LOG=$(journalctl --user -u dsh-web.service --since "$START" -o cat --no-pager 2>/dev/null || true)
  FATAL=$(fatal_log "$LOG")
  if [[ -n "$FATAL" ]]; then
    say "$FATAL" >&2
    die "启动日志出现致命错误（见上方匹配行与下方完整诊断）"
  fi
  sleep 1
done
if [[ "$SA_HTTP_READY" != 1 ]]; then
  die "HTTP 就绪超时：workbench/api=$WB_CODE，orchestrator/api/state=$SA_CODE，SA runtime=$(node -e 'try{process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))?.health?.runtime?.state ?? "unknown")}catch{process.stdout.write("no-state")}' "$STATE_FILE" 2>/dev/null || echo no-state)"
fi

# 最终复核：登录、workbench 路由、SA 状态、WebSocket、SSE。
CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 10 "$LAN_BASE/" || true)
[[ "$CODE" == 200 ]] || die "局域网登录后首页返回 $CODE（应为 200）"
CODE=$(curl -sS --noproxy '*' -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 10 "$LAN_BASE/dsh-workbench/api" || true)
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
