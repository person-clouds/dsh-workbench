# STATUS — DSH 工作台

- 更新时间：2026-11-15
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
- [x] 修复浏览器端重复加载注册失败：`zh`/`en` 字典移入 `factory` 闭包，顶层只保留
      `window.__ModuleLoader__.load({...})`。旧写法在 HMR/重复加载时会因顶层 `const`
      重声明抛 `SyntaxError`，表现为 `loaded without registering "dsh-workbench"`。
- [x] SA 侧配套补丁：worker 环境改为显式 `env`（不再改 `process.env`）、`WORK_TOOLS` 移除
      subagent/跨 Session 工具、启动时异常会话归档对账（只归档不删除）、
      `DSH_DISABLE_SUPERAGENT=1` 安全模式、SA 管理 API 使用 DSH Connection 鉴权。该补丁在 `/tmp/dsh-sa-patch` 草案中通过
      `tsc --noEmit`、`vitest`（60 文件 / 1203 用例）与 `tsdown` 构建。

## 待本机执行（沙箱只读，无法代做）

1. 按 `HANDOVER.md` §1 应用 SA 源码补丁，执行 `pnpm typecheck && pnpm test && pnpm build`；
2. 运行 `bash task/dsh-workbench/handover/switch-single-host.sh --apply`：
   备份、停两个 Host、改 `web` profile、安装依赖、启动并验证登录/WS/SSE；
3. 用浏览器核对 5 个标签页、SA 写操作、归档/清理 dry-run；
4. dry-run 通过后再把 `retentionAutoCleanup` 改为 `true`。

> 2026-11-15 复核：本机 `dsh-superagent` 源码目前**尚未应用**补丁
> （无 `lib/worker-shell-env.js`，`git apply --check -R` 失败），所以之前若只做
> 「步骤 2」必然缺新构建产物。切换脚本已在启动前强制检查该前提。

## 关键验证记录

| 时间 | 项 | 结果 |
|---|---|---|
| 2026-11-14 | `node --check index.js` / `lib/*.js` | 通过 |
| 2026-11-14 | `client.js` `vm.Script` 解析 | 通过 |
| 2026-11-14 | `npm pack --dry-run` | `dsh-workbench@0.2.0`，15 文件 |
| 2026-11-14 | `client.js` 连续加载两次（Chromium + `vm.Script`） | 两次均注册 `dsh-workbench`，无重声明异常 |
| 2026-11-14 | SA 补丁 `tsc --noEmit` | 通过 |
| 2026-11-14 | SA 补丁 `vitest run` | 60 文件 / 1203 用例通过 |
| 2026-11-14 | SA 补丁 `tsdown` | `lib/worker-shell-env.js` 等构建通过 |
| 2026-11-14 | 保留清理真实动作（临时 git worktree） | dry-run 4 项检查通过；真实清理依次 `git worktree remove` → 删除空父目录 → `workspaceRegistry.delete`，台账 `ok` |

## 已知约束

- 本机 DSH 有两个入口：`http://192.168.31.244:8080`（`dsh-lan.socket` → `127.0.0.1:3080`）
  与 Tailnet `https://zh-gem-r7.tailb6e152.ts.net:8443/`。登录 cookie 按协议 + authority
  绑定，两个 origin 的 cookie 不通用；journal 打印的 8443 token URL 不能直接登录 8080。
- 切换后若浏览器「一直连接中、工作区/插件为空」，先验证 `/api/remote.mux` 为 101 与
  `/plugins/events` 持续输出，不要只看静态首页；两者任一失败都会导致该症状。
- `client.js` 是普通脚本，顶层不能出现 `import`/`export`，也不能放 `const`/`let`/`class`
  等顶层词法声明（HMR 重复加载会重声明失败）；顶层只允许 `window.__ModuleLoader__.load`。
  `zh`/`en` 字典在 `factory` 内联，需与 `locale/*.json` 同步。
- 插件目录需本地 `@deepseek-ai/schemastery`；重装后若缺依赖，Host 导入会失败。
- 清理只覆盖 SA 约定 worktree 与 DSH 工作区注册，不删除 session 日志，不提供 `rm -rf`。
