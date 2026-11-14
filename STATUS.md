# STATUS — DSH 工作台

- 更新时间：2026-11-14
- 一句话：DSH 单 Host 下的统一工作台。面板覆盖工作区、仓库、文档、工单和 SA 控制；
  SA 管理写操作统一走 `/orchestrator/api/*` 代理，60 天保留与清理有 dry-run 和逐项安全检查。
- 位置：`task/dsh-workbench/`；包名 `dsh-workbench@0.2.0`。
- 计划：[`PLAN-dsh-workbench.md`](PLAN-dsh-workbench.md)。

## 已完成（代码侧）

- [x] 改名：目录、包名、插件 id、路由 `/dsh-workbench/api`、侧栏 id `dsh-workbench`、
      市场条目与语言元信息全部切换；不保留旧包名兼容。
- [x] Host：`GET /dsh-workbench/api` 支持工单快照、`view=workspaces|repos|docs|tree|blob|retention`；
      `POST` 支持 `dry-run`、`cleanup`、`settings`。
- [x] Host：读取 DSH `workspaceRegistry`，不再读第二份 `workspace.json`；仓库来源改为
      `config.repos` + DSH 工作区路径。
- [x] Host：SA 管理 API 白名单代理 `/dsh-workbench/api/sa`，带
      `x-orchestrator-request: 1`，透传 DSH cookie。
- [x] Host：60 天保留、多重安全检查、台账 `~/.dsh/state/workbench/retention.json`、
      手动 dry-run/cleanup 与每天最多一次自动清理；不删 DSH session 日志。
- [x] Client：5 个标签页 `[工作区] [仓库] [文档] [工单] [SA 控制]`；工作区/保留策略/Settings
      与提示词编辑；工单重试/停止。
- [x] 语法与打包自检：`node --check index.js`、`client.js` 的 `vm.Script` 解析、
      `npm pack --dry-run` 通过。
- [x] SA 侧配套补丁：worker 环境改为显式 `env`（不再改 `process.env`）、`WORK_TOOLS` 移除
      subagent/跨 Session 工具、启动时异常会话归档对账（只归档不删除）、
      `DSH_DISABLE_SUPERAGENT=1` 安全模式、SA 管理 API 使用 DSH Connection 鉴权。该补丁在 `/tmp/dsh-sa-patch` 草案中通过
      `tsc --noEmit`、`vitest`（60 文件 / 1203 用例）与 `tsdown` 构建。

## 待本机执行（沙箱只读，无法代做）

1. 备份 `~/.dsh/storages/workspace.json`、两个 profile 的 `package.json`/`cordis.patch.yml`
   与两个 systemd unit；
2. `web` profile 移除旧 `dsh-superagent-workbench` 链接，添加 `dsh-workbench` 与 `dsh-superagent`；
3. 把 `superagent` profile 的 SA 配置迁到 `web` 的 `cordis.patch.yml`，停止并禁用
   `dsh-superagent.service`，去掉 3082；
4. 应用 SA 源码补丁，执行 `pnpm typecheck && pnpm test && pnpm build`，再重启 `dsh-web.service`；
5. 用浏览器核对 5 个标签页、SA 写操作、归档/清理 dry-run。

## 关键验证记录

| 时间 | 项 | 结果 |
|---|---|---|
| 2026-11-14 | `node --check index.js` / `lib/*.js` | 通过 |
| 2026-11-14 | `client.js` `vm.Script` 解析 | 通过 |
| 2026-11-14 | `npm pack --dry-run` | `dsh-workbench@0.2.0`，15 文件 |
| 2026-11-14 | SA 补丁 `tsc --noEmit` | 通过 |
| 2026-11-14 | SA 补丁 `vitest run` | 60 文件 / 1203 用例通过 |
| 2026-11-14 | SA 补丁 `tsdown` | `lib/worker-shell-env.js` 等构建通过 |
| 2026-11-14 | 保留清理真实动作（临时 git worktree） | dry-run 4 项检查通过；真实清理依次 `git worktree remove` → 删除空父目录 → `workspaceRegistry.delete`，台账 `ok` |

## 已知约束

- `client.js` 是普通脚本，顶层不能出现 `import`/`export`；`zh`/`en` 字典内联且需与
  `locale/*.json` 同步。
- 插件目录需本地 `@deepseek-ai/schemastery`；重装后若缺依赖，Host 导入会失败。
- 清理只覆盖 SA 约定 worktree 与 DSH 工作区注册，不删除 session 日志，不提供 `rm -rf`。
