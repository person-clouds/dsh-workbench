#!/usr/bin/env bash
# 离线回归：用假 systemctl/journalctl/curl/dsh 跑完 switch-single-host.sh --apply 全路径。
# 不读也不改宿主机服务/profile；用于在真正切换前发现 shell 控制流、参数拼装和就绪判断问题。
set -euo pipefail

REPO=/home/zh/www/personalCloud
TARGET="$REPO/task/dsh-workbench/handover/switch-single-host.sh"
ROOT=$(mktemp -d /tmp/dsh-switch-test.XXXXXX)
trap 'rm -rf "$ROOT"' EXIT

BIN="$ROOT/bin"
DSH="$ROOT/dsh"
HOMEM="$ROOT/home"
mkdir -p "$BIN" "$DSH/profiles/web" "$DSH/state/superagent" \
  "$HOMEM/.config/systemd/user" "$DSH/storages"
printf '{}\n' > "$DSH/storages/workspace.json"
cat > "$DSH/profiles/web/package.json" <<'JSON'
{"name":"dsh-profile-web","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}
JSON
: > "$DSH/profiles/web/cordis.patch.yml"

cat > "$BIN/dsh" <<'SH'
#!/usr/bin/env bash
set -e
mkdir -p node_modules/dsh-workbench node_modules/dsh-superagent
printf '{"name":"dsh-workbench","version":"0.0.0","type":"module","exports":"./index.js"}\n' > node_modules/dsh-workbench/package.json
printf 'export default {}\n' > node_modules/dsh-workbench/index.js
printf '{"name":"dsh-superagent","version":"0.0.0","type":"module","exports":"./index.js"}\n' > node_modules/dsh-superagent/package.json
printf 'export default {}\n' > node_modules/dsh-superagent/index.js
SH

cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$BIN/ss" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$BIN/journalctl" <<'SH'
#!/usr/bin/env bash
set -e
count_file="$MOCK_ROOT/journal.count"
n=0
[[ -f "$count_file" ]] && n=$(cat "$count_file")
n=$((n + 1)); printf '%s\n' "$n" > "$count_file"
# 第一轮模拟“journal 还没有 token”，验证轮询不会因 pipefail/set -e 提前退出。
if (( n < 2 )); then
  echo 'Started dsh-web.service'
else
  echo 'dsh web: http://127.0.0.1:3080/?token=test-token'
fi
SH

cat > "$BIN/curl" <<'PY'
#!/usr/bin/env python3
import sys
args = sys.argv[1:]
out = None; hdr = None; writefmt = None; url = None; has_cookie = False
has_orch_header = 'x-orchestrator-request: 1' in args
i = 0
while i < len(args):
    a = args[i]
    if a == '-o': out = args[i + 1]; i += 2; continue
    if a == '-D': hdr = args[i + 1]; i += 2; continue
    if a == '-w': writefmt = args[i + 1]; i += 2; continue
    if a == '-b': has_cookie = True; i += 2; continue
    if a == '-c': i += 2; continue
    if a.startswith('-'): i += 1; continue
    url = a; i += 1

if url and 'api/remote.mux' in url:
    if hdr:
        open(hdr, 'w').write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n')
    sys.exit(0)
if url and 'plugins/events' in url:
    sys.stdout.write(': connected\n\ndata: {"type":"graph"}\n\n')
    sys.exit(0)

if url and 'token=' in url:
    code = '303'
elif url and 'orchestrator/api/state' in url:
    if not has_orch_header:
        code = '403'
    else:
        code = '200'
        if out and out != '/dev/null':
            open(out, 'w').write('{"health":{"runtime":{"state":"ready"}}}\n')
elif url and 'dsh-workbench/api' in url:
    code = '200'
elif url and url.rstrip('/').endswith(':3080'):
    code = '200' if has_cookie else '401'
else:
    code = '200'

if writefmt:
    sys.stdout.write(code)
sys.exit(0)
PY
chmod +x "$BIN"/*

echo '--- self-test ---'
bash "$TARGET" --self-test

echo '--- mock apply ---'
export MOCK_ROOT="$ROOT" HOME="$HOMEM" DSH_HOME="$DSH" PATH="$BIN:$PATH"
output=$(bash "$TARGET" --apply 2>&1) || {
  printf '%s\n' "$output"
  echo 'FAIL: mock apply 退出码非 0' >&2
  exit 1
}
grep -q '=== 切换成功 ===' <<<"$output" || {
  printf '%s\n' "$output"
  echo 'FAIL: mock apply 未输出切换成功' >&2
  exit 1
}
grep -q 'HTTP 就绪：workbench API=200，SA runtime=ready' <<<"$output" \
  || { echo 'FAIL: 未验证到 HTTP 就绪' >&2; exit 1; }
echo 'PASS: switch-single-host.sh 的 self-test 与 mock apply 全路径通过'
