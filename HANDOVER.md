# 本机切换手册（单 Host）

> 本文件中的命令都需要在真实主机执行。生成本文件的沙箱只能写
> `/home/zh/www/personalCloud`，无法改 `~/.dsh`、`~/.config/systemd` 或
> `/home/zh/src/dsh-superagent`。
>
> 目标：只保留 `dsh-web` 一个 DSH Host（3080 / Tailnet 8443），
> `dsh-superagent` 作为插件进入 `web` profile，停用 `superagent` profile
> 与 3082 监听。`superagent` profile 文件保留作回滚，不删除。

## 0. 备份

```bash
TS=$(date +%Y%m%d-%H%M%S)
B="$HOME/.dsh/backups/dsh-workbench-$TS"
install -d "$B/web" "$B/superagent" "$B/systemd"
cp -a "$HOME/.dsh/storages/workspace.json" "$B/workspace.json"
cp -a "$HOME/.dsh/profiles/web/package.json" "$HOME/.dsh/profiles/web/cordis.patch.yml" "$B/web/"
cp -a "$HOME/.dsh/profiles/superagent/package.json" "$HOME/.dsh/profiles/superagent/cordis.patch.yml" "$B/superagent/"
cp -a "$HOME/.dsh/state/superagent/orchestrator.sqlite" "$HOME/.dsh/state/superagent/orchestrator.sqlite-wal" "$HOME/.dsh/state/superagent/orchestrator.sqlite-shm" "$B/superagent/" 2>/dev/null || true
cp -a "$HOME/.config/systemd/user/dsh-web.service" "$HOME/.config/systemd/user/dsh-superagent.service" "$B/systemd/"
cp -a "$HOME/.config/systemd/user/dsh-web.service.d" "$HOME/.config/systemd/user/dsh-superagent.service.d" "$B/systemd/"
echo "$B" > /tmp/dsh-workbench-backup-path
```

记录基线：

```bash
systemctl --user status dsh-web.service dsh-superagent.service --no-pager > "$B/status-before.txt" || true
ss -ltnp 2>/dev/null | grep -E ':3080|:3082|:8443' > "$B/ports-before.txt" || true
```

## 1. 应用 dsh-superagent 补丁

补丁：`task/dsh-workbench/handover/dsh-superagent-single-host.patch`。它基于
`dsh-superagent` `d2a3b60`，内容包括：

- worker 环境改为显式 `env`，不再改 `process.env`；新增
  `dsh-superagent/worker-shell-env` 预设包装；
- `WORK_TOOLS` 移除 subagent / 跨 Session 工具；
- 新增 `src/app/session-policy.ts` 与启动时异常会话归档对账：合法集合为
  orchestrator + 每张已知工单的 `worker-<id>`，其余落在 SA 受管目录内的 session
  只归档不删除；
- `DSH_DISABLE_SUPERAGENT=1` 安全模式；
- SA 管理 API 改用 DSH Connection 的 Host/Origin/登录态校验；
- 对应测试与文档。

> 2026-11-15 补充：首次切换失败已定位为 SA `apply()` 等待
> `runtime.ready` 与 preset 诊断互锁，增量修复见
> `handover/dsh-superagent-defer-ready.patch`，必须在上面的补丁之后应用。
> 根因与验证记录见 [`STATUS.md`](STATUS.md)。

```bash
cd /home/zh/src/dsh-superagent
git status --short   # 注意：package.json、pnpm-lock.yaml、scripts/dsh-superagent
                     # 及 cordis.patch.yml.bak.* 是既有的并行改动，不要提交
git apply --check /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-single-host.patch
git apply       /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-single-host.patch

# 2026-11-15 追加：修复 Host 行激活期间 await runtime.ready 造成的 preset 死锁。
git apply --check /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-defer-ready.patch
git apply       /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-defer-ready.patch

# 2026-11-15 追加：修复 Feishu 事件消费的 health 状态竞争。
# stderr 的 [event] ready 与 stdout 的畸形事件行来自两个独立管道；
# ready 晚到时会覆盖已报告的 JSON 错误，导致测试偶发失败。保持本次进程的首个错误不降级。
git apply --check /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-feishu-health-race.patch
git apply       /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-feishu-health-race.patch

# 补丁不新增依赖，但保险起见：
pnpm install
pnpm typecheck
pnpm test
pnpm build

# 确认构建产物存在，并确认延迟启动修复真的进了源码与产物
test -f lib/worker-shell-env.js && echo 'worker-shell-env built'
grep -q 'void runtime.ready.then' src/index.ts && echo 'deferred startup in src'
grep -q 'runtime.ready.then' lib/index.js && echo 'deferred startup in lib'
# session-policy 会打进 lib/index.js，无需独立入口
```

若 `git apply --check` 因并行改动失败，先停下来，把冲突文件与补丁发回；
不要在未确认时 reset/checkout 掉既有改动。

## 2. 修改 web profile（推荐用脚本一次完成）

> 第 1 步必须**真的执行并构建**。先确认补丁已应用：
>
> ```bash
> cd /home/zh/src/dsh-superagent
> git apply --check -R /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-single-host.patch \
>   && echo 'SA 补丁已应用'
> test -f lib/worker-shell-env.js && echo 'worker-shell-env 已构建'
> ```
>
> 若没有输出「已应用 / 已构建」，不要进入第 2 步；先回到 §1。

先跑不碰宿主机的自检与 mock 全路径回归，再 dry-run，最后才 `--apply`：

```bash
cd /home/zh/www/personalCloud
bash task/dsh-workbench/handover/switch-single-host.sh --self-test   # 必须输出「自检通过」
bash task/dsh-workbench/handover/test-switch-single-host.sh          # 必须输出 PASS
bash task/dsh-workbench/handover/switch-single-host.sh --dry-run     # 只检查文件与打印计划
bash task/dsh-workbench/handover/switch-single-host.sh --apply

# 失败时保留新 Host/临时文件现场，不自动回滚（排障用）：
bash task/dsh-workbench/handover/switch-single-host.sh --apply --keep
# bash -x + 保留临时文件；trace 可能含登录 token：
bash task/dsh-workbench/handover/switch-single-host.sh --apply --debug
```

> 禁止跳过 `--self-test` 与 mock 回归直接 `--apply`。
> 若 `--apply` 失败：先看失败发生在备份/安装/启动/token/HTTP/WS/SSE 哪一阶段及耗时；
> diagnostics 里没有业务错误时，优先怀疑 `set -e`/`pipefail`/命令替换提前退出。
> 同一类失败第二次出现时停止逐行试补丁，先补 self-test/mock 覆盖再上机
> （规则见 `AGENTS.md` §6.9）。

脚本按以下顺序执行，任一步失败会**先打印完整 journal 与定向诊断**，再自动恢复
web profile 并启动旧的 dsh-superagent.service + dsh-web.service：

1. 预检 SA 源码/产物必须包含延迟启动修复
   （`void runtime.ready.then` / `runtime.ready.then`）；
2. 备份 `web`/`superagent` profile、SQLite、两个 systemd unit；
3. 停 `dsh-web`，再停 `dsh-superagent`，确认 3080/3082 已释放；
4. 从 `web/package.json` 删除悬空的 `dsh-superagent-workbench`，加入
   `dsh-workbench`、`dsh-superagent` 两个 `link:` 依赖与 bundle；
5. 向 `web/cordis.patch.yml` 幂等追加 SA 配置与 `retentionAutoCleanup: false`；
6. `dsh plugin --profile web install`，并在启动前用 `import.meta.resolve`
   证明两个 bundle 均可解析，防止再次出现 `skipping profile bundle`；
7. 启动 `dsh-web.service`，登录后用 HTTP 轮询
   `GET /dsh-workbench/api` 与 `GET /orchestrator/api/state`：
   `health.runtime.state == "ready"`，或 `setup.problem != null` 视为等待设置；
   不再 grep `dsh-superagent ready`（`ctx.logger.info` 不写 journal）；
8. 用本次启动打印的 token 在局域网入口验证登录、`/dsh-workbench/api`、
   `/api/remote.mux` WebSocket 101、`/plugins/events` SSE graph 四条链路；
9. 全部通过后 `systemctl --user disable dsh-superagent.service`，保留 unit 文件作回滚。
   回滚安装前会把从备份恢复的 `web/package.json` 中悬空的
   `dsh-superagent-workbench` 依赖与 bundle 清掉，避免 `cannot resolve profile bundle`。

手工操作时对应命令如下（不推荐；脚本已包含全部校验）：

```bash
systemctl --user stop dsh-web.service
systemctl --user stop dsh-superagent.service
ss -ltnp 2>/dev/null | grep -E ':3080|:3082' || echo '两个 Host 均已停止'

# 编辑 ~/.dsh/profiles/web/package.json：
#   dependencies 删除 dsh-superagent-workbench，
#   加入 dsh-workbench / dsh-superagent 两个 link: 依赖；
#   dsh.profile.bundles 删除 dsh-superagent-workbench，
#   在 @deepseek-ai/dsh-web-app 之后加入 dsh-superagent、dsh-workbench。

# ~/.dsh/profiles/web/cordis.patch.yml 末尾追加：
# - id: dsh-superagent
#   config:
#     stateDir: /home/zh/.dsh/state/superagent
# - id: dsh-superagent-feishu
#   disabled: false
# - id: dsh-workbench
#   config:
#     retentionAutoCleanup: false

cd "$HOME/.dsh/profiles/web"
dsh plugin --profile web install
# 必须能解析，否则启动后只会打印 skipping profile bundle：
node --input-type=module -e "console.log(import.meta.resolve('dsh-workbench')); console.log(import.meta.resolve('dsh-superagent'))"
systemctl --user start dsh-web.service
```

启动后先验证 HTTP，日志只用于诊断（`ctx.logger.info` 不写 journal）：

```bash
# 登录后必须 200；SA 正常态为 health.runtime.state == "ready"，
# 或 setup.problem != null 视为等待设置
curl -sS --noproxy '*' -b "$JAR" -o /dev/null -w 'workbench %{http_code}\n' \
  http://192.168.31.244:8080/dsh-workbench/api
curl -sS --noproxy '*' -b "$JAR" http://192.168.31.244:8080/orchestrator/api/state

journalctl --user -u dsh-web.service -n 200 --no-pager \
  | grep -E 'skipping profile bundle|requires a loopback Web server|Lock file is already being held|failed to import|dsh-workbench'
```

| HTTP / 日志 | 判定 |
|---|---|
| `/dsh-workbench/api` 200 | 工作台 Host 路由已注册 |
| `/orchestrator/api/state` 200 且 `health.runtime.state == "ready"`（或 `setup.problem != null`） | SA 插件已接管状态目录 |
| `skipping profile bundle "dsh-workbench"` / `"dsh-superagent"` | 失败：依赖没进 `node_modules`，重跑 `dsh plugin --profile web install` |
| `requires a loopback Web server` | 失败：SA 补丁没应用或构建产物未更新 |
| `Lock file is already being held` | 失败：旧 `dsh-superagent.service` 还在跑/未停干净 |
| `failed to import` / 对应插件 `did not activate` | 先看包名：`dsh-workbench` / `dsh-superagent` 的导入失败才是切换失败；profile 里其他插件（如既有的 `dsh-context-guard` 缺包）是独立警告，不回滚、不中止。脚本只匹配目标 bundle 的导入错误 |
| HTTP 就绪超时、journal 只有 inspector | 先确认已应用 `dsh-superagent-defer-ready.patch` 并重建；脚本会输出来自 `/orchestrator/api/state` 的 `health.runtime.state`。`ctx.logger.info` 不输出到 journal，不能用 `dsh-superagent ready` 字符串判断就绪 |
| 浏览器控制台反复报 `ws://127.0.0.1:9230/ingest failed` | 实验性 Inspector 的已知限制，不是 DSH 故障：客户端端点只允许 `127.0.0.1`，远端浏览器会把 `127.0.0.1` 指向自己。不需要 NodeJS 诊断面板时，从 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 删除 `@deepseek-ai/dsh-experimental-inspector-profile` 并重启 `dsh-web`；需要调试时再用本机浏览器打开 |
| 失败后回滚报 `cannot resolve profile bundle "dsh-superagent-workbench"` | 新版脚本已在回滚安装前清除悬空依赖与 bundle；若手工回滚，也必须先执行同样清理，或从旧提交恢复 `task/superagent-workbench/` |
| 切换超时 | 脚本会把完整 journal、端口、HTTP 探测、profile 与 bundle 解析结果写入 `~/.dsh/backups/dsh-workbench-*/diagnostics-*.log` 并打印；`--keep` 可跳过自动回滚保留现场 |

浏览器侧若报：

```text
dsh-workbench: Error: client-modules: could not load "dsh-workbench":
plugins/??dsh-workbench/client.js&rev=...: loaded without registering
```

按顺序检查：新标签页 `Ctrl+Shift+R`；DevTools 是否有 `Uncaught SyntaxError`；
`task/dsh-workbench/client.js` 顶层是否只有 `window.__ModuleLoader__.load({...})`
（`zh`/`en` 必须在 `factory` 内）；`web` profile 是否同时列了两个 workbench bundle。

## 3. 确认停用第二个 Host 与 3082

```bash
systemctl --user disable dsh-superagent.service
mv "$HOME/.config/systemd/user/dsh-superagent.service" "$(cat /tmp/dsh-workbench-backup-path)/systemd/dsh-superagent.service.disabled"
systemctl --user daemon-reload
ss -ltnp 2>/dev/null | grep ':3082' && echo '仍有 3082 监听，停止切换' || echo '3082 已释放'
```

`superagent` profile 文件保留；以后要回滚可直接恢复 unit。

## 4. 验证与访问地址

> **事实校正**：
>
> - `http://192.168.31.244:8080` **就是 DSH 局域网入口**：
>   `dsh-lan.socket` 在 `192.168.31.244:8080` 监听，经 `socket-proxyd` 转到
>   `127.0.0.1:3080`。它不是 Nextcloud。
> - `https://zh-gem-r7.tailb6e152.ts.net:8443/` 是同一个 DSH Host 的 Tailscale
>   Serve 入口，只有 tailnet 设备可访问。当前用户设备访问不了时，请用局域网入口。
> - DSH 登录 cookie 的名字由 **协议 + authority** 决定。`https://…:8443` 换到的
>   cookie 不能用于 `http://192.168.31.244:8080`，反之亦然。拿到 journal 打印的
>   `https://…:8443/?token=…` 后，若要在局域网入口登录，必须把 origin 换成
>   `http://192.168.31.244:8080` 再打开。
> - Nextcloud 只占 `127.0.0.1:8080` 和 `100.84.98.28:8080`；局域网 DSH 入口是
>   `192.168.31.244:8080`，两者不是同一个监听地址。

取当前登录 URL 并自动换成局域网 origin：

```bash
TOKEN_URL=$(journalctl --user -u dsh-web.service -o cat --since '10 min ago' \
  | grep -E '^dsh web: https?://' | tail -1 | sed 's/^dsh web: //')
LAN_URL=$(node -e '
const u = new URL(process.argv[1]); u.protocol = "http:"; u.host = "192.168.31.244:8080";
process.stdout.write(u.href)' "$TOKEN_URL")
echo "$LAN_URL"
```

把 `$LAN_URL` 在局域网浏览器打开。命令行自检：

```bash
BASE=http://192.168.31.244:8080
JAR=$(mktemp)
# 1) 无登录态：401（路由已注册且鉴权生效）
curl -sS --noproxy '*' -o /dev/null -w 'anon root: %{http_code}\n' "$BASE/"
# 2) token 交换：303 并写 cookie
curl -sS --noproxy '*' -o /dev/null -c "$JAR" -w 'token exchange: %{http_code}\n' "$LAN_URL"
# 3) 登录后：200
curl -sS --noproxy '*' -b "$JAR" -o /dev/null -w 'logged-in root: %{http_code}\n' "$BASE/"
# 4) 工作台路由：200
curl -sS --noproxy '*' -b "$JAR" -o /dev/null -w 'workbench api: %{http_code}\n' "$BASE/dsh-workbench/api"
# 5) WebSocket Upgrade：应看到 101 Switching Protocols（随后 curl 超时属正常）
curl -sS --noproxy '*' --http1.1 --max-time 5 -D - -o /dev/null -b "$JAR" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG9Xb3JsZDEyMzQ1Ng==' "$BASE/api/remote.mux" 2>&1 \
  | grep -E 'HTTP/1.1 101|Upgrade: websocket'
# 6) SSE 插件图：应出现 : connected 与 "type":"graph"
timeout 8 curl -sS --noproxy '*' -b "$JAR" -N "$BASE/plugins/events" | head -c 1200
```

浏览器登录后逐项核对：

- 侧栏出现「DSH 工作台」，5 个标签页可切换；
- [工作区] 能看到当前 DSH 工作区与会话；
- [工单] 能读 SA 工单；
- [SA 控制] 能读 state/settings/prompts，保存一个无副作用设置后能恢复；
- [保留策略] dry-run 返回候选与逐项检查；
- `ss -ltnp | grep :3082` 无输出。

确认 dry-run 结果符合预期后，再把 `web/cordis.patch.yml` 的
`retentionAutoCleanup` 改为 `true` 并重启 `dsh-web`；自动清理每 24 小时最多一次。

若页面仍表现为「一直连接中、工作区空了、插件空了」，先抓这两条客户端通道，
不要只看静态首页：

```bash
# WebSocket 必须 101；401/404/连接重置都说明登录 origin 或代理有问题
curl -sS --noproxy '*' --http1.1 --max-time 5 -D - -o /dev/null -b "$JAR" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG9Xb3JsZDEyMzQ1Ng==' "$BASE/api/remote.mux"
# SSE 必须持续输出；若 404/断开，检查 dsh-lan.socket -> 127.0.0.1:3080
timeout 8 curl -sS --noproxy '*' -b "$JAR" -N "$BASE/plugins/events"
```

## 5. 回滚

```bash
B=$(cat /tmp/dsh-workbench-backup-path)
systemctl --user stop dsh-web.service
cp -a "$B/web/package.json" "$B/web/cordis.patch.yml" "$HOME/.dsh/profiles/web/"
# 旧 backup 可能仍引用已不存在的 task/superagent-workbench；安装前先清掉：
node - "$HOME/.dsh/profiles/web/package.json" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
delete pkg.dependencies?.['dsh-superagent-workbench']
if (Array.isArray(pkg.dsh?.profile?.bundles)) {
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(id => id !== 'dsh-superagent-workbench')
}
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
NODE
rm -f "$HOME/.dsh/profiles/web/node_modules/dsh-superagent-workbench"
cp -a "$B/superagent/package.json" "$B/superagent/cordis.patch.yml" "$HOME/.dsh/profiles/superagent/"
cp -a "$B/systemd/dsh-superagent.service" "$HOME/.config/systemd/user/"
cp -a "$B/systemd/dsh-superagent.service.d" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user start dsh-superagent.service
systemctl --user start dsh-web.service

# 回退 SA 源码补丁；不要 reset 其他并行改动
cd /home/zh/src/dsh-superagent
git apply -R /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-single-host.patch
pnpm install
pnpm build
```

若新 `dsh-web` 启动失败：按上面命令恢复 `web` profile 与旧 unit，先启动
`dsh-superagent.service`，确认 3082 恢复，再启动 `dsh-web.service`。SA 数据库若在
切换中异常，先用备份目录中的 `orchestrator.sqlite*` 恢复再启动；不要直接删库。

注意：`58a06a1` 已把 `task/superagent-workbench/` 改名为 `task/dsh-workbench/`。
仅恢复 `web/package.json` 时，旧依赖
`dsh-superagent-workbench -> task/superagent-workbench` 会悬空，旧面板不会出现。
若要连旧面板一起回滚，先从旧提交导出目录再启动：

```bash
cd /home/zh/www/personalCloud
git archive 58a06a1^ task/superagent-workbench | tar -x -C .
```

## 6. 提交与发布

`dsh-workbench` 本体已在本仓库内；SA 补丁文件在 `handover/` 中作为交付物。
发布 npm 前先确认登录：

```bash
cd /home/zh/www/personalCloud/task/dsh-workbench
npm whoami --registry=https://registry.npmjs.org
npm_config_cache=/tmp/npm-cache npm pack --pack-destination release
npm publish --registry=https://registry.npmjs.org --access public
```

市场 PR 见 `PUBLISHING.md`；仓库创建满 1 天后再提交。
