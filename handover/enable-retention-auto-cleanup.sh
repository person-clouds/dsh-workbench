#!/usr/bin/env bash
# 开启或预览工作台自动保留清理。默认只预览；--apply 才修改并备份配置。
# 每次 --apply 都会写审计记录，便于追溯。
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
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 64 ;;
  esac
done
[[ -f "$CONFIG" ]] || { echo "失败：配置文件不存在：$CONFIG" >&2; exit 1; }

BACKUP_DIR="$DSH_HOME_DIR/backups/dsh-workbench"
AUDIT_LOG="$DSH_HOME_DIR/state/workbench/retention-audit.log"
BACKUP="$BACKUP_DIR/retention-config-$(date +%Y%m%d-%H%M%S).yml"
mkdir -p "$BACKUP_DIR" "$(dirname "$AUDIT_LOG")"

RESULT="$(python3 - "$CONFIG" "$BACKUP" "$APPLY" <<'PY'
import pathlib, shutil, sys
config, backup, apply = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3] == '1'
text = config.read_text()
if 'retentionAutoCleanup: true' in text:
    print('already')
    raise SystemExit(0)
if 'retentionAutoCleanup: false' not in text:
    print('missing')
    raise SystemExit(2)
if not apply:
    print('would-change')
    raise SystemExit(0)
shutil.copy2(config, backup)
config.write_text(text.replace('retentionAutoCleanup: false', 'retentionAutoCleanup: true', 1))
print('changed')
PY
)"
case "$RESULT" in
  already)
    echo "已经开启，无需修改：$CONFIG"
    exit 0
    ;;
  would-change)
    echo "预览：将把 retentionAutoCleanup 从 false 改为 true"
    echo "配置文件：$CONFIG"
    echo "确认后执行：bash $0 --apply"
    exit 0
    ;;
  changed)
    printf '%s action=enable-auto-cleanup user=%s host=%s config=%s backup=%s\n' \
      "$(date -Is)" "$(id -un)" "$(hostname)" "$CONFIG" "$BACKUP" >>"$AUDIT_LOG"
    echo "已开启：retentionAutoCleanup: true"
    echo "备份：$BACKUP"
    echo "审计记录：$AUDIT_LOG"
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
