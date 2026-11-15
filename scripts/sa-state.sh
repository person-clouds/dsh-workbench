#!/usr/bin/env bash
# sa-state.sh —— 读取 dsh-web 内嵌 superagent 的实时状态（只读）
#
# 背景（2026-11-15）：superagent 作为插件并入 dsh-web 的 web profile，不再有
# 独立的 dsh-superagent.service 与 3082 监听。运行态事实来源变成 dsh-web 上的
# GET /orchestrator/api/state（需要登录 cookie），见 task/dsh-workbench/STATUS.md。
#
# 用法：
#   sa-state.sh                  # 打印 /orchestrator/api/state 原始 JSON
#   sa-state.sh --summary        # 打印几行中文摘要
#   sa-state.sh api <path> [GET|POST]
#                                # 调用 /orchestrator/api/<path>，输出响应体
#
# 退出码：
#   0  成功
#   2  拿不到登录 token（journal 里没有 'dsh web:' 行；服务可能刚起还没打印）
#   3  登录失败（token 过期 / 地址不匹配）
#   4  状态接口无响应或返回非 200
#   5  api 子命令返回了非 200（响应体照样输出，便于看错误原因）
#
# 只读：不启动/停止任何服务；cookie 只在临时目录，退出即删；token 不打印不落盘。

set -uo pipefail

BASE="${DSH_BASE:-http://127.0.0.1:3080}"
UNIT="${DSH_WEB_UNIT:-dsh-web.service}"
TIMEOUT="${DSH_TIMEOUT:-10}"

TMP="$(mktemp -d)" || exit 4
trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/cookies.txt"

journal_text() {
    journalctl --user -u "$UNIT" --no-pager -o cat 2>/dev/null \
        || journalctl --user-unit "$UNIT" --no-pager -o cat 2>/dev/null \
        || true
}

# token 只在启动日志里打印一次，取最后一条（重启后以最新为准）。
token_url() {
    journal_text | grep -E '^dsh web: https?://' | tail -1 | sed 's/^dsh web: //'
}

rewrite_url() { # rewrite_url <raw-url> <base>：把日志里的 tailnet 地址换成本机回环
    node -e '
const raw = process.argv[1], base = new URL(process.argv[2])
const u = new URL(raw)
u.protocol = base.protocol
u.host = base.host
process.stdout.write(u.href)
' "$1" "$2" 2>/dev/null
}

# 登录：用 token 换 cookie（303 视为成功）。token 不输出。
login() {
    local raw local_url code
    raw="$(token_url)"
    if [[ -z "$raw" ]]; then
        echo "拿不到登录 token：journal 里没有 'dsh web:' 行" >&2
        return 2
    fi
    local_url="$(rewrite_url "$raw" "$BASE")"
    if [[ -z "$local_url" ]]; then
        echo "token URL 转换失败" >&2
        return 3
    fi
    code="$(curl -sS --noproxy '*' -m "$TIMEOUT" -o /dev/null -w '%{http_code}' \
        -c "$JAR" "$local_url" 2>/dev/null || echo 000)"
    case "$code" in
        303|200) return 0 ;;
        *) echo "登录失败：token 交换 HTTP $code" >&2; return 3 ;;
    esac
}

api_call() { # api_call <path> [method]：输出响应体，返回 HTTP 码
    local path="$1" method="${2:-GET}" body="$TMP/body.json" code
    local -a method_args=()
    [[ "$method" != "GET" ]] && method_args=(-X "$method")
    code="$(curl -sS --noproxy '*' -m "$TIMEOUT" -b "$JAR" \
        -H 'x-orchestrator-request: 1' "${method_args[@]}" \
        -o "$body" -w '%{http_code}' \
        "$BASE/orchestrator/api/$path" 2>/dev/null || echo 000)"
    cat "$body" 2>/dev/null
    printf '%s' "$code"
}

cmd="${1:---json}"
case "$cmd" in
    api)
        path="${2:?用法: sa-state.sh api <path> [GET|POST]}"
        method="${3:-GET}"
        login || exit $?
        out="$(api_call "$path" "$method")"
        code="${out: -3}"
        printf '%s' "${out%???}"
        [[ "$code" == "200" ]] || exit 5
        ;;
    --summary)
        login || exit $?
        out="$(api_call state)"
        code="${out: -3}"
        if [[ "$code" != "200" ]]; then
            echo "状态接口 HTTP $code" >&2
            exit 4
        fi
        printf '%s' "${out%???}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
h = d.get("health") or {}
print("runtime:", (h.get("runtime") or {}).get("state", "未知"))
p = (d.get("setup") or {}).get("problem")
print("setup:", "正常" if not p else "%s/%s: %s" % (p.get("place"), p.get("code"), p.get("detail")))
bad = {k: (v.get("state") if isinstance(v, dict) else v) for k, v in h.items()
       if (v.get("state") if isinstance(v, dict) else v) != "ready"}
print("未就绪部件:", "无" if not bad else bad)
' 2>/dev/null || exit 4
        ;;
    --json|"")
        login || exit $?
        out="$(api_call state)"
        code="${out: -3}"
        if [[ "$code" != "200" ]]; then
            echo "状态接口 HTTP $code" >&2
            exit 4
        fi
        printf '%s' "${out%???}"
        ;;
    -h|--help|help)
        sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
        ;;
    *)
        echo "未知参数: $cmd（试 --help）" >&2
        exit 4
        ;;
esac
