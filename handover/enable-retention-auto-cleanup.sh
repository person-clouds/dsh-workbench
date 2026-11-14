#!/usr/bin/env bash
# 开启或预览工作台自动保留清理。默认只预览；--apply 才修改配置和运行台账。
# 每次修改都会备份并写审计记录，便于追溯。
#
# 用法:
#   bash enable-retention-auto-cleanup.sh                 # 预览，不修改
#   bash enable-retention-auto-cleanup.sh --apply         # 修改并重启 dsh-web
#   bash enable-retention-auto-cleanup.sh --apply --no-restart
set -euo pipefail

APPLY=0
NO_RESTART=0
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
CONFIG="$DSH_HOME_DIR/profiles/web/cordis.patch.yml"
while (($#)); do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    --config) CONFIG="${2:?--config 需要文件路径}"; shift 2 ;;
    --config=*) CONFIG="${1#*=}"; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 64 ;;
  esac
done
[[ -f "$CONFIG" ]] || { echo "失败：配置文件不存在：$CONFIG" >&2; exit 1; }

BACKUP_DIR="$DSH_HOME_DIR/backups/dsh-workbench"
AUDIT_LOG="$DSH_HOME_DIR/state/workbench/retention-audit.log"
MANIFEST="$DSH_HOME_DIR/state/workbench/retention.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_DIR/retention-config-$STAMP.yml"
MANIFEST_BACKUP="$BACKUP_DIR/retention-manifest-$STAMP.json"
mkdir -p "$BACKUP_DIR" "$(dirname "$AUDIT_LOG")"

RESULT="$(python3 - "$CONFIG" "$BACKUP" "$MANIFEST" "$MANIFEST_BACKUP" "$APPLY" <<'PY'
import json, pathlib, shutil, sys
config, backup, manifest, manifest_backup = map(pathlib.Path, sys.argv[1:5])
apply = sys.argv[5] == '1'
text = config.read_text()
if 'retentionAutoCleanup: true' in text:
    config_state = 'true'
elif 'retentionAutoCleanup: false' in text:
    config_state = 'false'
else:
    print('missing')
    raise SystemExit(2)

manifest_state = 'none'
data = None
if manifest.exists():
    try:
        data = json.loads(manifest.read_text())
    except Exception as error:
        print(f'manifest-invalid:{error}')
        raise SystemExit(2)
    manifest_state = 'true' if data.get('settings', {}).get('autoCleanup') is True else 'false'

if not apply:
    if config_state == 'true' and manifest_state in ('true', 'none'):
        print('already')
    else:
        print(f'preview config={config_state} manifest={manifest_state}')
    raise SystemExit(0)

changed = []
if config_state == 'false':
    shutil.copy2(config, backup)
    config.write_text(text.replace('retentionAutoCleanup: false', 'retentionAutoCleanup: true', 1))
    changed.append('config')

if data is not None and manifest_state != 'true':
    shutil.copy2(manifest, manifest_backup)
    data.setdefault('settings', {})['autoCleanup'] = True
    manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    changed.append('manifest')

if changed:
    print('changed:' + ','.join(changed))
else:
    print('already')
PY
)"

case "$RESULT" in
  already)
    echo "配置和运行台账都已开启，无需修改：$CONFIG"
    exit 0
    ;;
  preview*)
    echo "预览：$RESULT"
    echo "配置文件：$CONFIG"
    echo "运行台账：$MANIFEST"
    echo "确认后执行：bash $0 --apply"
    exit 0
    ;;
  changed:*)
    CONFIG_BACKUP_FIELD="$BACKUP"
    MANIFEST_BACKUP_FIELD="$MANIFEST_BACKUP"
    [[ -f "$BACKUP" ]] || CONFIG_BACKUP_FIELD="-"
    [[ -f "$MANIFEST_BACKUP" ]] || MANIFEST_BACKUP_FIELD="-"
    printf '%s action=enable-auto-cleanup user=%s host=%s config=%s backup=%s manifest=%s manifest_backup=%s\n' \
      "$(date -Is)" "$(id -un)" "$(hostname)" "$CONFIG" "$CONFIG_BACKUP_FIELD" "$MANIFEST" "$MANIFEST_BACKUP_FIELD" >>"$AUDIT_LOG"
    echo "已开启：retentionAutoCleanup: true"
    [[ -f "$BACKUP" ]] && echo "配置备份：$BACKUP"
    [[ -f "$MANIFEST_BACKUP" ]] && echo "台账备份：$MANIFEST_BACKUP"
    echo "审计记录：$AUDIT_LOG"
    ;;
  manifest-invalid:*)
    echo "失败：运行台账不是合法 JSON：${RESULT#manifest-invalid:}" >&2
    exit 1
    ;;
  *)
    echo "失败：$CONFIG 中没有找到 retentionAutoCleanup: false 或 true" >&2
    exit 1
    ;;
esac

if (( APPLY && ! NO_RESTART )); then
  systemctl --user restart dsh-web.service
  systemctl --user is-active dsh-web.service
fi
