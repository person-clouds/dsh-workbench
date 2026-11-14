#!/usr/bin/env bash
# 登录当前 DSH，检查工作台到 SA 的代理，然后执行保留清理 dry-run。
# 只报告，不删除；结果和审计记录落盘，便于事后追溯。
#
# 用法:
#   bash retention-dry-run.sh
#   bash retention-dry-run.sh --base http://192.168.31.244:8080
#   bash retention-dry-run.sh --out /tmp/workbench-dry-run.json
set -euo pipefail

BASE="${DSH_BASE:-http://192.168.31.244:8080}"
OUT=""
while (($#)); do
  case "$1" in
    --base) BASE="${2:?--base 需要 URL}"; shift 2 ;;
    --base=*) BASE="${1#*=}"; shift ;;
    --out) OUT="${2:?--out 需要文件路径}"; shift 2 ;;
    --out=*) OUT="${1#*=}"; shift ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 64 ;;
  esac
done
BASE="${BASE%/}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
AUDIT_LOG="$DSH_HOME_DIR/state/workbench/retention-audit.log"
[[ -n "$OUT" ]] || OUT="$DSH_HOME_DIR/state/workbench/dry-run-$(date +%Y%m%d-%H%M%S).json"

TMP="$(mktemp -d /tmp/dsh-retention-dry-run.XXXXXX)"
JAR="$TMP/cookies.txt"
trap 'rm -rf "$TMP"' EXIT

discover_token_url() {
  local log=""
  log="$(journalctl --user -u dsh-web.service --no-pager -o cat 2>/dev/null || true)"
  if [[ -z "$log" ]]; then
    local machine_id user_journal
    machine_id="$(cat /etc/machine-id 2>/dev/null || true)"
    user_journal="/var/log/journal/${machine_id}/user-$(id -u).journal"
    if [[ -n "$machine_id" && -r "$user_journal" ]]; then
      log="$(journalctl --file "$user_journal" --no-pager -o cat 2>/dev/null || true)"
    fi
  fi
  grep -E '^dsh web: https?://' <<<"$log" | tail -1 | sed 's/^dsh web: //' || true
}

rewrite_token_url() {
  node -e '
    const raw = process.argv[1]
    const base = new URL(process.argv[2])
    const u = new URL(raw)
    u.protocol = base.protocol
    u.host = base.host
    process.stdout.write(u.href)
  ' "$1" "$2"
}

TOKEN_URL="$(discover_token_url)"
if [[ -z "$TOKEN_URL" ]]; then
  echo "失败：journal 里找不到 dsh web 登录地址；先确认 dsh-web.service 已启动" >&2
  exit 1
fi
LOCAL_TOKEN_URL="$(rewrite_token_url "$TOKEN_URL" "$BASE")"

CODE="$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' -c "$JAR" "$LOCAL_TOKEN_URL" || true)"
if [[ "$CODE" != "303" ]]; then
  echo "失败：登录返回 HTTP $CODE，应为 303；token 可能已过期，先重启 dsh-web 再试" >&2
  exit 1
fi
echo "登录成功：$BASE"

SA_CODE="$(curl -sS --noproxy '*' -b "$JAR" -o "$TMP/sa.json" -w '%{http_code}' \
  "$BASE/dsh-workbench/api/sa?path=state" || true)"
if [[ "$SA_CODE" != "200" ]]; then
  echo "失败：工作台到 SA 的代理返回 HTTP $SA_CODE" >&2
  cat "$TMP/sa.json" >&2 || true
  exit 1
fi
node - "$TMP/sa.json" <<'NODE'
const fs = require('node:fs')
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
console.log('SA 代理正常，runtime =', d?.health?.runtime?.state ?? 'unknown')
NODE

mkdir -p "$(dirname "$OUT")" "$(dirname "$AUDIT_LOG")"
DRY_CODE="$(curl -sS --noproxy '*' -b "$JAR" -X POST \
  -H 'content-type: application/json' \
  --data '{"action":"dry-run"}' \
  -o "$OUT" -w '%{http_code}' "$BASE/dsh-workbench/api" || true)"
if [[ "$DRY_CODE" != "200" ]]; then
  echo "失败：dry-run 返回 HTTP $DRY_CODE" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs = require('node:fs')
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const eligible = d.eligible ?? []
console.log('保留天数:', d.settings?.days ?? 'unknown')
console.log('自动清理:', d.settings?.autoCleanup ? '已开启' : '关闭')
console.log('候选工单:', d.candidates?.length ?? 0)
console.log('可清理工单:', eligible.length)
for (const x of eligible) console.log(`- ${x.shortId || x.id} ${x.title || ''} -> ${x.execDir || ''}`)
console.log('台账:', d.manifestPath || '')
NODE

printf '%s action=dry-run user=%s host=%s base=%s eligible=%s result=%s\n' \
  "$(date -Is)" "$(id -un)" "$(hostname)" "$BASE" \
  "$(node -e 'const d=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String((d.eligible??[]).length))' "$OUT")" \
  "$OUT" >>"$AUDIT_LOG"

echo "dry-run 通过。完整结果：$OUT"
echo "审计记录：$AUDIT_LOG"
