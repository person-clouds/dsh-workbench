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

```bash
cd /home/zh/src/dsh-superagent
git status --short   # 注意：package.json、pnpm-lock.yaml、scripts/dsh-superagent
                     # 及 cordis.patch.yml.bak.* 是既有的并行改动，不要提交
git apply --check /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-single-host.patch
git apply       /home/zh/www/personalCloud/task/dsh-workbench/handover/dsh-superagent-single-host.patch

# 补丁不新增依赖，但保险起见：
pnpm install
pnpm typecheck
pnpm test
pnpm build

# 确认构建产物存在
test -f lib/worker-shell-env.js && echo 'worker-shell-env built'
# session-policy 会打进 lib/index.js，无需独立入口
```

若 `git apply --check` 因并行改动失败，先停下来，把冲突文件与补丁发回；
不要在未确认时 reset/checkout 掉既有改动。

## 2. 修改 web profile

先停两个 Host。顺序重要：旧 `dsh-superagent.service` 持有
`~/.dsh/state/superagent` 的进程锁，必须先停它，否则 `web` 里的 SA 插件会启动失败：

```bash
systemctl --user stop dsh-web.service
systemctl --user stop dsh-superagent.service
ss -ltnp 2>/dev/null | grep -E ':3080|:3082' || echo '两个 Host 均已停止'
```

编辑 `~/.dsh/profiles/web/package.json`：

```json
{
  "dependencies": {
    "dsh-workbench": "link:/home/zh/www/personalCloud/task/dsh-workbench",
    "dsh-superagent": "link:/home/zh/src/dsh-superagent"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-superagent",
        "dsh-workbench"
      ]
    }
  }
}
```

保留其他依赖与 bundle；只把旧的 `dsh-superagent-workbench` 替换为
`dsh-workbench`，并在它前面加 `dsh-superagent`。

在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
# dsh-superagent 机器配置：与旧 superagent profile 保持一致。
- id: dsh-superagent
  config:
    stateDir: /home/zh/.dsh/state/superagent
- id: dsh-superagent-feishu
  disabled: false
```

首次切换建议先关闭自动清理，人工 dry-run 确认后再启用。在
`~/.dsh/profiles/web/cordis.patch.yml` 的 `dsh-workbench` 行下加：

```yaml
- id: dsh-workbench
  config:
    retentionAutoCleanup: false
```

然后安装依赖并启动：

```bash
cd "$HOME/.dsh/profiles/web"
dsh plugin --profile web install   # 或 pnpm install；让 link: 依赖进入 node_modules
systemctl --user start dsh-web.service
journalctl --user -u dsh-web.service -n 120 --no-pager
```

预期日志出现 `dsh-workbench ready:` 与 `dsh-superagent ready`（或
`dsh-superagent is waiting for setup`）。若出现 `import failed` / `did not activate`，
先查该插件目录的 `node_modules/@deepseek-ai/schemastery` 是否存在。

## 3. 确认停用第二个 Host 与 3082

```bash
systemctl --user disable dsh-superagent.service
mv "$HOME/.config/systemd/user/dsh-superagent.service" "$(cat /tmp/dsh-workbench-backup-path)/systemd/dsh-superagent.service.disabled"
systemctl --user daemon-reload
ss -ltnp 2>/dev/null | grep ':3082' && echo '仍有 3082 监听，停止切换' || echo '3082 已释放'
```

`superagent` profile 文件保留；以后要回滚可直接恢复 unit。

## 4. 验证

```bash
# 无登录态应为 401；说明路由已注册且鉴权生效
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-workbench/api

# 浏览器登录后：
#   - 侧栏出现「DSH 工作台」；
#   - [工作区] 能看到当前 DSH 工作区与会话；
#   - [工单] 能读 SA 工单；
#   - [SA 控制] 能读 state/settings/prompts，保存一个无副作用设置后能恢复；
#   - [保留策略] dry-run 返回候选与逐项检查；
#   - 不再访问 3082。

确认 dry-run 结果符合预期后，再把 `retentionAutoCleanup` 改回 `true` 并重启
`dsh-web`；自动清理每 24 小时最多一次，且只处理通过全部检查的候选。
```

服务端还应确认：

```bash
journalctl --user -u dsh-web.service -n 300 --no-pager | grep -E 'dsh-workbench|dsh-superagent|did not activate|import failed'
```

## 5. 回滚

```bash
B=$(cat /tmp/dsh-workbench-backup-path)
systemctl --user stop dsh-web.service
cp -a "$B/web/package.json" "$B/web/cordis.patch.yml" "$HOME/.dsh/profiles/web/"
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
