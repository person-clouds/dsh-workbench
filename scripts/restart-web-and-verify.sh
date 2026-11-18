#!/usr/bin/env bash
# 重启 dsh-web.service，并复验 dsh-workbench 的 docRepos 接口。
#
# ⚠ 重启会中断当前 dsh GUI 会话。不要在 dsh 自带终端里直接前台运行；
#   交给 systemd user timer / SSH 等独立进程执行。
#
# 用法：
#   bash dsh-workbench/scripts/restart-web-and-verify.sh
# 验证日志默认写到 /tmp/dsh-workbench-restart-verify.log。
set -uo pipefail

UNIT="${DSH_WEB_UNIT:-dsh-web.service}"
ORIGIN="${DSH_WEB_ORIGIN:-http://192.168.31.244:8080}"
LOG="${DSH_RESTART_LOG:-/tmp/dsh-workbench-restart-verify.log}"

mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "=== $(date -Is) restart ${UNIT} ==="

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

if ! busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
  org.freedesktop.systemd1.Manager RestartUnit ss "$UNIT" replace >/dev/null; then
  echo "restart=FAILED"
  exit 1
fi
echo "restart=ok"

code="000"
for _ in $(seq 1 60); do
  code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' --noproxy '*' "$ORIGIN/" 2>/dev/null || true)"
  if [[ "$code" == "401" || "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done
echo "health_http=${code}"
if [[ "$code" == "000" ]]; then
  exit 1
fi

token="$(journalctl --user -u "$UNIT" -o cat --since '3 min ago' 2>/dev/null \
  | sed -n 's/.*[?&]token=\([A-Za-z0-9_-]*\).*/\1/p' | tail -1)"
if [[ -z "$token" ]]; then
  echo "token=NOT_FOUND"
  exit 1
fi

jar="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$jar" "$body"' EXIT

login_code="$(curl -sS --noproxy '*' -m 10 -c "$jar" -b "$jar" \
  -o /dev/null -w '%{http_code}' "$ORIGIN/?token=$token" || true)"
api_code="$(curl -sS --noproxy '*' -m 20 -b "$jar" -o "$body" \
  -w '%{http_code}' "$ORIGIN/dsh-workbench/api?view=docRepos" || true)"
echo "login_http=${login_code} docRepos_http=${api_code}"

python3 - "$body" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception as exc:
    print(f'docRepos_body=INVALID_JSON ({exc})')
    sys.exit(0)
repos = data.get('repos')
if isinstance(repos, list):
    print(f'docRepos_repos={len(repos)}')
else:
    print(f'docRepos_body={str(data)[:300]}')
PY
