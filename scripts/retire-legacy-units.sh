#!/usr/bin/env bash
# retire-legacy-units.sh —— 单 Host 切换后收尾退役旧 systemd 单元（幂等）
#
# 背景（2026-11-15）：
#   - superagent 已并入 dsh-web 的 web profile（插件），宿主是 dsh-web.service；
#     旧的 dsh-superagent.service 若被手工 start，会拉起第二个 Host 抢 3082 与状态锁，
#     所以这里 stop + disable。单元文件留在原处作为回滚资产，所以**不 mask**
#     （systemd 不允许在单元文件同目录下再建 mask 链接）。
#   - superagent-console（8099）功能已被 dsh-workbench 的「工单 / SA 控制」覆盖，
#     按用户决定退役：stop + disable（不 mask，便于随时用 install.sh 装回）。
#
# 用法：
#   bash task/dsh-workbench/scripts/retire-legacy-units.sh            # 预览（不改动）
#   bash task/dsh-workbench/scripts/retire-legacy-units.sh --apply    # 执行
#   bash task/dsh-workbench/scripts/retire-legacy-units.sh --apply dsh-superagent.service
#
# tailnet 8448 → 8099 的旧映射已关闭（2026-11-15 执行）：
#   tailscale serve --https=8448 off
# dsh 远程入口只保留 tailnet 8443；本脚本不碰 Tailscale。
#
# 回滚：
#   # dsh-superagent（先按 HANDOVER.md 恢复 profile 与单元文件；单元文件未删）
#   systemctl --user enable --now dsh-superagent.service
#   # superagent-console
#   bash task/superagent-console/scripts/install.sh install

set -uo pipefail

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; shift; fi
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0; fi

UNITS=("${@:-}")
[[ -z "${UNITS[*]:-}" ]] && UNITS=(dsh-superagent.service superagent-console.service)
# 这两个单元的文件都留在 ~/.config/systemd/user/ 下（回滚/装回资产），
# 所以统一只 stop + disable，不做 mask。

# bwrap/容器里没有用户总线时回退到宿主机用户管理器。
USERCTL=(systemctl --user)
if ! "${USERCTL[@]}" show -p Version --value >/dev/null 2>&1; then
    USERCTL=(systemctl --user --machine="$(id -un)@.host")
fi

run() {
    if (( APPLY )); then
        printf '  $ %s\n' "$*"
        "${USERCTL[@]}" "$@"
    else
        printf '  [预览] %s\n' "${USERCTL[*]} $*"
        return 0
    fi
}

fail=0
for unit in "${UNITS[@]}"; do
    echo "== $unit"
    state="$("${USERCTL[@]}" is-active "$unit" 2>/dev/null || true)"
    enabled="$("${USERCTL[@]}" is-enabled "$unit" 2>/dev/null || true)"
    echo "  当前：active=${state:-unknown} enabled=${enabled:-unknown}"

    if [[ "$state" == "active" ]]; then
        run stop "$unit" || { echo "  停止失败" >&2; fail=1; continue; }
    fi
    if [[ "$enabled" != "disabled" && "$enabled" != "masked" ]]; then
        run disable "$unit" || { echo "  disable 失败" >&2; fail=1; continue; }
    fi
    printf '  结果：active=%s enabled=%s\n' \
        "$("${USERCTL[@]}" is-active "$unit" 2>/dev/null || true)" \
        "$("${USERCTL[@]}" is-enabled "$unit" 2>/dev/null || true)"
done

echo
echo "端口核对（单 Host 下不应有 3082 / 8099 监听）："
for port in 3082 8099; do
    if ss -ltn 2>/dev/null | grep -q ":${port} "; then
        echo "  $port : 仍在监听"
    else
        echo "  $port : 未监听（符合预期）"
    fi
done
echo
(( fail )) && echo "有失败项，见上面的错误" >&2
(( APPLY )) || echo "（以上仅为预览，加 --apply 才会真正执行）"
(( fail )) && exit 1 || exit 0
