# 计划：单 Host 合并 SA，并将 workbench 改名 dsh-workbench

- 状态：已实施（代码与文档完成；本机切换与运行态验证待执行）
- 日期：2026-11-14
- 适用项目：`task/superagent-workbench/`、`dsh-superagent`、DSH `web` profile
- 决策者：用户
- 当前结论：按本计划推进，实施前先备份；未经用户明确说“开干”不改运行时代码

## 1. 背景

当前本机有两个长期运行的 DSH Host：

- `dsh-web`：`web` profile，3080，Tailnet Serve `8443`，运行主 UI；
- `dsh-superagent`：`superagent` profile，3082，仅回环，运行 SA。

两者共用 `DSH_HOME=/home/zh/.dsh`，因此同时读写：

- `~/.dsh/storages/workspace.json`；
- `~/.dsh/sessions/`；
- 其他按 DSH_HOME 定位的状态。

`@deepseek-ai/dsh-storage-json` 是单文件、内存权威、无跨进程写锁的存储，两个 Host 会互相覆盖。已观察到：

- 两边 workspace / session 列表不一致；
- 同一 session 显示的工作目录不同；
- 一边归档后另一边不归档。

根因不是 superagent 的 bug，而是两个进程都把自己当成唯一写者。

同时，当前 workbench 的定位也不对：

- 名字是 `superagent-workbench`；
- 默认复用 `task/superagent-console/repos.json`；
- 会把并非 SA 创建的仓库显示出来；
- README 把它描述成“官方 SA 面板的只读补充”，与后续统一 UI 的方向冲突。

## 2. 术语

- **SA**：superagent，即 `dsh-superagent` 整套系统。以后口头和文档统一使用这个简写。
- **orchestrator**：SA 内部长期存在的一个 DSH 会话，负责语义判断、路由、回复和配置操作，不直接写业务代码。
- **worker**：SA 为每个 ticket 创建的执行会话，命名 `worker-<ticketId>`，负责实际代码工作。
- **dsh-workbench**：DSH 统一工作台，负责展示与操作，不是 SA 专属面板。

## 3. 目标

### 3.1 最终形态

```text
dsh-web（唯一 DSH Host）
├─ 3080 / Tailnet Serve 8443
├─ 唯一 workspaceRegistry / sessionController 写者
├─ dsh-workbench（DSH 工作台 + SA 控制面）
└─ dsh-superagent（插件）
    ├─ Runtime / Engine
    ├─ orchestrator.sqlite（唯一写者）
    ├─ orchestrator 会话（1 个）
    └─ worker-<ticket> 会话（每个 ticket 1 个）
```

### 3.2 必须达成

1. 只保留一个 DSH Host，共用 8443 入口和 DSH 登录态；
2. workspace、session、归档状态两边完全一致；
3. SA 不再独立监听 3082，不再有独立 `dsh-superagent.service`；
4. SA 仍保留独立 `stateDir`、worktree 根目录和执行隔离；
5. worker worktree 根目录统一为 `~/src/dsh-worktrees/<repo>/<ticket>`；
6. 每个 ticket 只有 1 个 worker 会话，SA 不随意创建小会话；
7. dsh-workbench 从只读交付台升级为 DSH 工作台，并逐步吸收 SA 官方 panel；
8. 归档后保留 60 天，允许自动清理 worktree 与 workspace 注册；
9. 文档、PROJECT_INDEX、部署说明同步更新。

### 3.3 非目标

- 不修改 DSH 核心的 workspace/session 语义；
- 不用文件监听或 IPC 去合并两个 `workspace.json` 写者；
- 不把 SA 的执行进程塞进主进程；
- 不自动删除 session 日志；
- 不在本次计划中直接执行迁移或重启。

## 4. 单 Host 架构

### 4.1 运行方式

- `web` profile 作为唯一 DSH Host；
- `dsh-superagent` 作为 bundle/插件装入 `web` profile；
- 删除独立 `superagent` profile 的 systemd 单元与 3082 监听；
- SA 的 worker 仍是子进程/会话，不阻塞主 Host。

### 4.2 状态所有权

| 状态 | 唯一所有者 | 说明 |
|---|---|---|
| `workspace.json` | DSH Host | 禁止第二进程写 |
| session 日志 | DSH Host | 归档只隐藏，不删除 |
| `orchestrator.sqlite` | SA | workbench 只读展示，写操作走 SA API |
| workbench 配置/清理台账 | dsh-workbench | 独立于 SA DB |
| worker worktree | SA/workbench 清理器 | 路径受控，不碰用户仓库 |

### 4.3 环境隔离

`dsh-superagent/src/infra/environment.ts` 的 `applyEnvironment()` 会修改进程级 `process.env`，包括 `PATH` 和 git 配置。合并后必须改掉：

- 不再修改主 Host 的全局 `process.env`；
- 环境变量只注入 worker 子进程；
- `GIT_CONFIG_GLOBAL`、`GH_TOKEN`、`GITHUB_TOKEN` 清理只作用于 worker 环境；
- 保留 `workerBin`、shim、`workerGitConfig` 的隔离语义。

### 4.4 安全模式

增加 `DSH_DISABLE_SUPERAGENT=1`：

- 启动时跳过 SA 插件；
- 主 UI 和 workbench 正常工作；
- 用于插件升级失败或 SA 异常时恢复主系统。

## 5. SA 的会话模型

### 5.1 允许的会话

```text
1 个 orchestrator 会话
+ 每个 ticket 1 个 worker 会话
= SA 允许创建的 DSH 会话全集
```

### 5.2 orchestrator 的职责

- 读取候选 trigger；
- 决定建 ticket、挂到已有 ticket、忽略或停止；
- 向人回复结果和需要处理的事项；
- 管理 ticket retry / status / note；
- 保存 settings / policy / prompts；
- 接收 domain event 通知。

它不负责写代码，也不是独立进程。真正调度由 Engine 完成。

### 5.3 禁止随意创建小会话

当前 SA 的 `WORK_TOOLS` 包含：

```ts
'subagent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent'
```

DSH 的 `subagent` 会创建子 Session，导致出现“echo 一下”“生成张图”等小会话。计划：

1. 从 worker 工具集中移除 `subagent`、`list_subagent_models`、`send_message`、`list_agents`、`interrupt_agent`；
2. worker 的临时操作使用同一会话内的 `bash` / `job_*`；
3. 图片、测试、echo、调研等产物都放在 ticket 会话和 worktree 内；
4. 保留 `limitSubagent()` 仅用于迁移期清理历史遗留；
5. 增加测试：worker 工具列表不包含 `subagent`；一个 ticket 只产生 1 个 worker 会话。

### 5.4 异常会话对账

- 合法集合 = orchestrator + 已知 ticket 的 worker；
- worktree 根目录下由 SA 管理但不合法的会话：只归档，不删除；
- panel 不提供“新建会话”入口；
- 记录对账日志，便于排查。

## 6. worktree 与 workspace

### 6.1 worktree 根目录

```text
~/src/dsh-worktrees/<repo>/<ticket>
```

约束：

- 路径经 `fs.realpath` 规范化后创建 workspace；
- `<repo>` 必须全局唯一，重名时使用 `owner-repo`；
- 一个 worktree 对应一个 workspace；
- 标题格式：`[SA] <repo> / <ticket>`。

### 6.2 DSH 的归档语义

DSH 本身的行为：

- `archiveSession` 只把 session id 加入 `global.archivedSessionIds`；
- 保留 `sessionIds` 槽位；
- 不删除 session 日志；
- `unarchiveSession` 恢复原位置；
- `workspaceRegistry.delete` 只删除注册记录，保留目录和 session 日志；
- DSH 不管理 worktree，也没有自动 TTL。

因此 SA/workbench 的清理必须是额外能力，不能假设 DSH 会自动做。

## 7. 60 天保留与自动清理

### 7.1 策略

```yaml
retention:
  days: 60
  autoCleanup: true
```

### 7.2 清理范围

| 对象 | 处理 |
|---|---|
| session 日志 | 归档后不自动删除，由 DSH 永久保留 |
| workspace 注册 | 60 天后可自动删除 |
| worktree 目录 | 60 天后可自动删除 |
| ticket 报告 / 文档 / 分支 | 保留在 SA DB 和 git 仓库 |
| 清理台账 | 保留，记录原因、时间、结果 |

### 7.3 时间计算

- 从 ticket 结束时间 `ended.at` 起算；
- 旧数据没有结束时间时，记录首次发现已结束的时间作为回退值；
- 清理台账：`~/.dsh/state/workbench/retention.json`。

### 7.4 自动清理条件

必须同时满足：

- ticket 已结束（merged / closed / dropped / completed）；
- worker 会话已归档；
- worktree 无未提交改动；
- 分支已合并或明确放弃；
- 没有打开的 PR；
- 不在 pin 列表；
- 距 ticket 结束 ≥ 60 天；
- 当天清理任务没有失败记录。

任一条不满足就跳过，并写入报告。

### 7.5 清理动作

```text
1. git worktree remove（失败则放弃本轮）
2. 删除空父目录
3. workspaceRegistry.delete(workspaceId)
4. 写清理台账
```

禁止 `rm -rf` 兜底。失败说明仍有价值，保留并报告。

### 7.6 页面

- 「可清理」列表；
- 「最近清理」记录；
- 手动 dry-run；
- 自动清理开关和下次执行时间。

## 8. dsh-workbench 定位与改名

### 8.1 新定位

> dsh-workbench 是 DSH 的统一工作台：负责工作区、仓库、文档、交付物，以及 SA 的配置与运行管理。

不再写“只读展示层”“官方 panel 的补充”。

### 8.2 页面结构

```text
[工作区] [仓库] [文档] [工单] [SA 控制]
```

- 工作区：DSH workspaceRegistry 总览；
- 仓库：DSH 配置仓库 + workspace 自动识别，不再默认复用 `superagent-console/repos.json`；
- 文档：仓库内 Markdown；
- 工单：SA 工单、报告、diff、retry、stop；
- SA 控制：health、sources、policy、eval、executor、prompts、pause。

### 8.3 改名清单

```text
目录：task/superagent-workbench → task/dsh-workbench
包名：dsh-superagent-workbench → dsh-workbench
插件 id：dsh-workbench
路由：/dsh-workbench/api
侧栏 id：dsh-workbench
locale meta：DSH 工作台
版本：0.2.0（breaking rename）
```

- 不做旧包名、旧路由、旧书签兼容；
- `web` profile 移除旧 link，安装新路径；
- npm 发布新包 `dsh-workbench`；
- GitHub 仓库可重命名为 `person-clouds/dsh-workbench`；
- 旧包发 deprecation 提示即可。

### 8.4 只读与写操作边界

- 读：DSH 状态、SA 工单/报告、git 对象、Markdown；
- 写：
  - DSH 级：workspace 注销、worktree 清理；
  - SA 级：通过 SA management API 执行配置、暂停、retry、stop、prompt 保存；
- 禁止：
  - workbench 直接写 `orchestrator.sqlite`；
  - workbench 直接改 SA 配置文件；
  - 浏览器端绕过 DSH 鉴权调用内部 API。

## 9. SA panel 渐进合并

### 9.1 接入方式

第一阶段：workbench Host 代理 SA management API。

```text
浏览器
  → /dsh-workbench/api/sa/*
  → workbench Host 校验 DSH 登录态和同源
  → 服务端调用 /orchestrator/api/*
```

第二阶段：如耦合加深，将 SA 管理能力提升为 Cordis service，HTTP API 变成薄封装。

### 9.2 必须修的鉴权限制

当前 SA `registerHttp()` 要求：

```ts
ctx.webServer.host === '127.0.0.1'
```

合并到 8443 后 Web 服务不再只听回环，必须改为：

- 不要求 loopback；
- 使用 DSH 自身登录态 / connection 校验；
- 写操作要求同源；
- 保留 `x-orchestrator-request: 1` 作为 CSRF 辅助头；
- 使用配置的 `publicOrigin` 或 DSH 认证结果判断，而不是写死 Host。

### 9.3 合并阶段

1. 改名 + 重新定位；
2. SA 只读状态进入 workbench；
3. SA 写操作进入 workbench；
4. 覆盖官方 panel 功能后隐藏官方侧栏入口；
5. 保留 SA 后端 management API。

## 10. 实施步骤

### 阶段 0：备份与基线

- 备份 `~/.dsh/storages/workspace.json`；
- 备份两个 profile 的 `package.json` 和 `cordis.patch.yml`；
- 记录当前服务、端口、session 数量；
- 记录回滚命令；
- 确认没有并行未提交改动混入。

### 阶段 1：单 Host 合并

- 把 SA 插件装入 `web` profile；
- 停用并移除 `dsh-superagent.service`；
- 删除 3082 监听；
- 修复 `applyEnvironment()` 的全局环境修改；
- 增加 `DSH_DISABLE_SUPERAGENT=1`；
- 验证 workspace/session/归档一致。

### 阶段 2：会话模型收紧

- 从 `WORK_TOOLS` 移除 subagent 等工具；
- 增加 session policy 校验；
- 增加异常会话归档对账；
- 测试每个 ticket 仅 1 个 worker。

### 阶段 3：workbench 改名与重定位

- 目录、包名、插件 id、路由、locale、README 全量改名；
- 仓库来源改为 DSH 级；
- 移除“只读”表述；
- 安装新插件并验证。

### 阶段 4：SA 管理接入

- 修 `registerHttp` 鉴权；
- workbench 增加 SA 控制 Tab；
- 先只读，再写操作；
- 覆盖官方 panel 后隐藏官方入口。

### 阶段 5：60 天保留与清理

- 实现 retention manifest；
- 实现 dry-run、自动清理、台账、页面；
- 先在测试目录验证；
- 再启用自动清理。

### 阶段 6：文档与收尾

- 更新 README、STATUS、PROJECT_INDEX；
- 更新部署与回滚文档；
- 记录测试报告；
- 提交并推送。

## 11. 验收标准

1. 只有一个 DSH Host 进程监听 Web；
2. 8080/8443 入口与 DSH 登录态正常；
3. 不再有 3082 监听；
4. 主 UI 能看到 SA 的 orchestrator 和 worker 会话；
5. 主 UI 归档 SA 会话后，workbench 与 SA 状态一致；
6. 运行一个 ticket 全程只产生 1 个 worker 会话；
7. 不再出现“生成图片/echo”类子会话；
8. workbench 能管理工作区、仓库、文档、工单、SA 配置；
9. SA 配置写操作只经过 SA management API；
10. 归档 60 天后，符合条件的 worktree 和 workspace 被自动清理；
11. 有未提交改动、打开 PR、pin 或未合并分支时不会清理；
12. session 日志不会被自动删除；
13. 文档、PROJECT_INDEX、回滚说明齐全。

## 12. 风险与回滚

| 风险 | 处理 |
|---|---|
| 合并 Host 后启动失败 | 保留旧 profile 与 unit 文件；用备份恢复 |
| workspace 数据损坏 | 实施前备份 `workspace.json`；提供恢复命令 |
| SA 环境变量污染主进程 | 阶段 1 先修 `applyEnvironment()` |
| panel 管理接口不可用 | 保留 `/orchestrator/api`，workbench 只做代理 |
| 自动清理误删 | 默认 dry-run 验证；60 天 + 多重安全条件；禁止 `rm -rf` |
| 插件升级破坏主 UI | `DSH_DISABLE_SUPERAGENT=1` 安全模式 |
| 重启中断会话 | 实施前明确告知用户，选择低峰时段 |

## 13. 已确认决策

1. 采用方案 A：单 DSH Host，单写者，执行隔离；
2. 统一 worktree 根目录 `~/src/dsh-worktrees/<repo>/<ticket>`；
3. SA 会话模型：1 个 orchestrator + 每个 ticket 1 个 worker；
4. 禁止 SA 随意创建小会话；
5. dsh-workbench 重新定位为 DSH 工作台，并吸收 SA panel；
6. 改名 `dsh-workbench`，不做旧版本兼容；
7. 归档后保留 60 天，允许自动清理；
8. session 日志不自动删除；
9. 文档统一使用 SA 简写；
10. 用户未明确说“开干”前，不实施运行时代码变更。
