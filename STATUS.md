# STATUS — DSH 工作台

- 更新时间：2026-11-15（切换脚本加固）
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

## 2026-11-15 切换脚本加固（已完成代码侧）

`handover/switch-single-host.sh` 已补齐 STATUS 上一轮列出的 5 项：

- [x] 预检延迟启动修复：`src/index.ts` 必须含 `void runtime.ready.then`，
      `lib/index.js` 必须含 `runtime.ready.then`；缺任一项直接拒绝 apply。
- [x] 就绪判断改为 HTTP：登录后轮询 `GET /dsh-workbench/api` 与
      `GET /orchestrator/api/state`，接受 `health.runtime.state == "ready"` 或
      `setup.problem != null`；不再 grep `dsh-superagent ready`。
- [x] 失败时输出完整 journal + 定向诊断，写入
      `~/.dsh/backups/dsh-workbench-*/diagnostics-*.log`：systemd 状态、端口、
      HTTP 探测、SA state、profile package 与 bundle 解析、关键字日志。
- [x] 回滚安装前清理备份中悬空的 `dsh-superagent-workbench` 依赖、bundle 与
      node_modules 链接，避免再次 `cannot resolve profile bundle`。
- [x] 新增 `--keep`（失败不回滚、保留现场）与 `--debug`（bash -x、保留临时文件；
      trace 可能含 token）。

> 当前 `/home/zh/src/dsh-superagent` 仍**未应用** `dsh-superagent-defer-ready.patch`，
> 所以本机 `switch-single-host.sh --dry-run` 会按设计停在预检；先按 HANDOVER §1
> 应用增量补丁并 `pnpm build`，再执行切换。

## 2026-11-15 DSH 可用性检查 skill 与浏览器噪声定位

- [x] 新增 workspace skill `.dsh/skills/dsh-usability-check/SKILL.md` 与
      `scripts/check.sh`：核心检查 HTTP 入口、token 登录、`/api/remote.mux` 101、
      `/plugins/events` SSE graph；扩展检查 `/dsh-workbench/api`、SA `/orchestrator/api/state`、
      profile bundle 解析与悬空 node_modules 链接。退出码 `0` 可用 / `1` 核心失败 /
      `2` 仅扩展失败。
- [x] 已在本机实测：核心链路 6 项通过；`/dsh-workbench/api` 与 `/orchestrator/api/state`
      均 404（单 Host 切换尚未执行），skill 正确返回 2。
- [x] 定位浏览器控制台 `client.js:3229 WebSocket to ws://127.0.0.1:9230/ingest failed`：
      来源是 `@deepseek-ai/dsh-experimental-inspector-profile`。其 Client bootstrap 只接受
      `ws://127.0.0.1` 端点，远端浏览器必然连到自己的 loopback；不影响业务。处理方式：
      正常使用移除该 bundle，调试时临时启用并用本机浏览器。
- [x] `AGENTS.md` §6.8 与 `doc/task-workflow.md` 增补「连续 10 步无新增证据 →
      先写 STATUS 交接 → 换新会话；`session_depth` 最多 2 层，到顶停止」。

## 待本机执行（沙箱只读，无法代做）

1. 按 `HANDOVER.md` §1 应用 `dsh-superagent-defer-ready.patch`，执行
   `pnpm typecheck && pnpm test && pnpm build`；
2. 运行 `bash task/dsh-workbench/handover/switch-single-host.sh --dry-run` 预检通过后，
   执行 `--apply`：备份、停两个 Host、改 `web` profile、安装依赖、启动并验证登录/WS/SSE；
3. 用浏览器核对 5 个标签页、SA 写操作、归档/清理 dry-run；
4. dry-run 通过后再把 `retentionAutoCleanup` 改为 `true`。

> 2026-11-15 复核：`dsh-superagent-single-host.patch` 已应用且
> `lib/worker-shell-env.js` 已构建；但 `src/index.ts` 仍是 `await runtime.ready`，
> `dsh-superagent-defer-ready.patch` 尚未应用。切换脚本已在启动前强制检查该前提。

## 2026-11-15 单 Host 切换失败：根因与修复（已证实）

### 现象

- 宿主机执行 `switch-single-host.sh --apply` 后，脚本等待
  `dsh-workbench ready` / `dsh-superagent ready` 超时。
- journal 只看到 `dsh inspector: devtools://…`，看不到 SA 就绪日志。
- 脚本自动回滚时又报
  `cannot resolve profile bundle "dsh-superagent-workbench"`；旧 3080/3082
  最终恢复，浏览器回到回滚后的可用状态。
- 失败态浏览器表现为“一直连接中、工作区为空、插件为空”，但静态首页仍能显示。
  这不是登录或 `dsh-lan` 代理问题，而是 Host 启动未完成导致两条客户端通道不可用。

### 根因（已用临时副本 + trace 证实）

`dsh-superagent/src/index.ts` 的 `apply()` 在 Host 插件行激活期间执行了
`await runtime.ready`。初始化链为：

```text
apply() await runtime.ready
  -> Sessions.ensure()
  -> sessionController.create({ agentPreset: 'dsh-superagent-router' })
  -> composeAgent()
  -> presets.resolve()
  -> presetRegistry.diagnostic()
  -> diagnostic() 发现该 preset 行仍 pending
  -> await loader.await()   // 等待的正是当前尚未返回的 Host 插件行
```

即“自己等自己”的死锁。`@deepseek-ai/dsh-agent-preset-registry` 的约定明确要求：
preset 的 `diagnostic()` 调用方不得位于 Host 行自己的 activation 中。

### 修复

把 SA 的启动等待从 `apply()` 内移出，先让本行激活、发布
`dshSuperagentEnvironment`，再异步记录启动成功/失败：

```ts
void runtime.ready.then(
  () => { /* info 日志 */ },
  (error: unknown) => { ctx.logger.error('dsh-superagent failed to start: %s', String(error)) },
)
```

增量补丁：
[`handover/dsh-superagent-defer-ready.patch`](handover/dsh-superagent-defer-ready.patch)。
它基于当前已应用的 `dsh-superagent-single-host.patch`，只改
`src/index.ts` 与 `tests/index.spec.ts`。

### 临时副本验证结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `vitest run` | 60 文件 / 1205 用例通过 |
| `tsdown` 构建 | 通过，`lib/index.js` 已含 `runtime.ready.then` |
| Host 启动 trace | `preset.diagnostic audit1 dsh-superagent-router {"failed":[],"pending":[]}`，随后 `composeAgent resolved` |
| 启动告警 | 从失败的 `5 entries did not activate` 降为 2 条既有无关告警（`dsh-context-guard` / `dsh-workflow-shortcuts` 的 `ERR_MODULE_NOT_FOUND`） |
| 运行态 HTTP | `/dsh-workbench/api` 200；`/orchestrator/api/state` 200，`health.runtime.state == "ready"` |

### 注意

- `ctx.logger.info` 不写 stdout；`dsh-superagent ready` **不应作为脚本就绪判据**。
  应通过带登录 cookie 的 `GET /orchestrator/api/state` 检查
  `health.runtime.state == "ready"`，或 `setup.problem != null` 视为等待设置。
- `switch-single-host.sh` **尚未**完成以下加固，下次会话应继续：
  1. 预检 `src/index.ts` / `lib/index.js` 已包含延迟启动修复；
  2. 超时时输出完整 journal 与定向诊断；
  3. 回滚前先移除悬空的 `dsh-superagent-workbench` 依赖与 bundle；
  4. 就绪检查改为 HTTP，而不是 grep `dsh-superagent ready`；
  5. 增加 `--keep` / `--debug`，失败时可保留现场。
- 临时验证目录 `.tmpdiag/` 不能提交；本次文档提交只新增增量补丁。

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
