#!/usr/bin/env bash
# 离线回归：dry-run 脚本的登录/代理/落盘链路，以及自动清理开关的预览/备份/审计。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d /tmp/dsh-retention-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/.dsh/profiles/web"

cat >"$TMP/bin/journalctl" <<'MOCK'
#!/usr/bin/env bash
echo 'dsh web: https://zh-gem-r7.tailb6e152.ts.net:8443/?token=test-token'
MOCK
cat >"$TMP/bin/curl" <<'MOCK'
#!/usr/bin/env bash
out=/dev/null
url=""
while (($#)); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w|-H|-b|-c|-X|--data) shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  *token=test-token*) code=303 ;;
  *dsh-workbench/api/sa*) code=200; [[ "$out" == /dev/null ]] || printf '{"health":{"runtime":{"state":"ready"}}}' >"$out" ;;
  *dsh-workbench/api) code=200
    printf '{"settings":{"days":60,"autoCleanup":false},"candidates":[{"id":"t1"}],"eligible":[],"manifestPath":"/tmp/retention.json"}' >"$out" ;;
  *) code=500 ;;
esac
printf '%s' "$code"
MOCK
chmod +x "$TMP/bin/journalctl" "$TMP/bin/curl"

export HOME="$TMP"
export DSH_HOME="$TMP/.dsh"
export PATH="$TMP/bin:$PATH"

bash "$ROOT/retention-dry-run.sh" --base http://192.168.31.244:8080 \
  --out "$TMP/dry-run.json" >"$TMP/dry-run.out"
grep -q '可清理工单: 0' "$TMP/dry-run.out"
grep -q 'action=dry-run' "$TMP/.dsh/state/workbench/retention-audit.log"
test -s "$TMP/dry-run.json"

CONFIG="$TMP/.dsh/profiles/web/cordis.patch.yml"
MANIFEST="$TMP/.dsh/state/workbench/retention.json"
mkdir -p "$(dirname "$MANIFEST")"
printf -- '- id: dsh-workbench\n  config:\n    retentionAutoCleanup: false\n' >"$CONFIG"
printf '{"version":1,"settings":{"days":60,"autoCleanup":false}}\n' >"$MANIFEST"
bash "$ROOT/enable-retention-auto-cleanup.sh" --no-restart >"$TMP/preview.out"
grep -q 'retentionAutoCleanup: false' "$CONFIG"
grep -q '预览' "$TMP/preview.out"
bash "$ROOT/enable-retention-auto-cleanup.sh" --apply --no-restart >"$TMP/apply.out"
grep -q 'retentionAutoCleanup: true' "$CONFIG"
grep -q '"autoCleanup": true' "$MANIFEST"
grep -q 'action=enable-auto-cleanup' "$TMP/.dsh/state/workbench/retention-audit.log"
ls "$TMP/.dsh/backups/dsh-workbench"/retention-config-*.yml >/dev/null
ls "$TMP/.dsh/backups/dsh-workbench"/retention-manifest-*.json >/dev/null
bash "$ROOT/enable-retention-auto-cleanup.sh" --no-restart >"$TMP/again.out"
grep -q '都已开启' "$TMP/again.out"

# 配置已是 true、运行台账仍是 false：--apply 必须补正台账
CONFIG2="$TMP/second/cordis.patch.yml"
MANIFEST2="$TMP/.dsh2/state/workbench/retention.json"
mkdir -p "$(dirname "$CONFIG2")" "$(dirname "$MANIFEST2")"
printf -- '- id: dsh-workbench\n  config:\n    retentionAutoCleanup: true\n' >"$CONFIG2"
printf '{"version":1,"settings":{"days":60,"autoCleanup":false}}\n' >"$MANIFEST2"
DSH_HOME="$TMP/.dsh2" bash "$ROOT/enable-retention-auto-cleanup.sh"   --config "$CONFIG2" --apply --no-restart >"$TMP/align.out"
grep -q '"autoCleanup": true' "$MANIFEST2"
grep -q 'action=enable-auto-cleanup' "$TMP/.dsh2/state/workbench/retention-audit.log"

echo 'PASS: retention dry-run 与自动清理开关脚本（含台账同步、备份和审计）'
