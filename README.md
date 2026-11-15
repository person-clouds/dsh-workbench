[中文](README.md) | [English](README.en.md)

# DSH 工作台（dsh-workbench）

把 DSH 工作区、SA 工单与报告、交付分支改动、Markdown 文档和只读代码浏览放进同一个侧栏面板；
需要操作 SA 时，在面板内直接调用 SA 管理 API，不再新开端口或第二个 DSH Host。

> 定位：DSH 的交付视图与 SA 管理入口。状态事实只有一个写者：DSH Host 写 `workspace.json` 与 session，
> SA 写 `orchestrator.sqlite`；本插件只读 SA 数据库，写操作一律经 SA 管理 API。

## 面板结构

侧栏图标（id `dsh-workbench`，中文名「DSH 工作台」）→ `main` 槽位：

```text
[工作区] [仓库] [文档] [工单] [SA 控制]
```

| 标签页 | 内容 |
|---|---|
| 工作区 | 读取 DSH `workspaceRegistry`：标题、路径、状态、会话；归档/pin 状态只读展示 |
| 仓库 | 配置的仓库 + DSH 工作区路径；目录树、文件内容、最近提交、未提交改动数 |
| 文档 | 按仓库分组的 Markdown 索引，打开即渲染 |
| 工单 | SA 工单列表与详情：报告、diff、工单记录；可直接重试/停止 |
| SA 控制 | SA 概览、设置、提示词、模型、来源与保留策略；写操作代理到 `/orchestrator/api/*` |

## 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 工作区、会话归属 | DSH `ctx.workspaceRegistry` | 与 DSH Web UI 同一份事实 |
| 工单、报告、SA 设置 | `~/.dsh/state/superagent/orchestrator.sqlite` | 只读打开，WAL 可读 |
| 工单记录 | 交付仓库 `origin/main` 的 `docs/work/<id8>-*.md` | 只读 git 对象 |
| 分支改动 | `git diff <baseRef>...agent/<执行名>` | 只读；后台 `git fetch` 只更新引用 |
| 文档 / 代码 | `config.repos` + DSH 工作区路径 | `git` 或 `worktree` 模式 |
| SA 管理写操作 | `/dsh-workbench/api/sa` → `/orchestrator/api/*` | 同源、带 DSH 登录态与 `x-orchestrator-request: 1` |

## 安装

```bash
# 本机开发目录
cd /home/zh/www/personalCloud/task/dsh-workbench

# 通过 DSH 插件管理器安装，或：
dsh plugin --profile web add link:/home/zh/www/personalCloud/task/dsh-workbench
```

发布包安装：

```bash
dsh plugin --profile web add dsh-workbench
```

卸载：在插件管理器移除 `dsh-workbench`（不删除本目录）。

## 配置

在 DSH 设置 → 插件 → DSH 工作台里改，或写进 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-workbench
  name: dsh-workbench
  config:
    dshHome: /home/zh/.dsh
    stateDir: /home/zh/.dsh/state/superagent
    repoDir: /home/zh/src/dshSuperagentRepo
    baseRef: origin/main
    cacheSeconds: 10
    fetchMinutes: 10
    repos: []                 # 可选；留空自动使用 DSH 工作区路径
    retentionDays: 60
    retentionAutoCleanup: true
    retentionCheckMinutes: 60
    saApiBase: ''             # 留空使用当前 DSH Host 的回环地址
```

`repos` 每项：`{ id, name, path, mode: git|worktree, ref, description, remote, exclude }`。
DSH 工作区会自动出现在仓库列表中，不再读取 `superagent-console/repos.json`。

## 60 天保留与清理

- SA 工单归档（未结束的工单不清理）超过 `retentionDays` 后，才进入候选；
- 只处理 `~/src/dsh-worktrees/` 与 `<stateDir>/work/` 下的 worktree，且必须通过脏工作区、锁、路径、会话归档等全部检查；
- 先 `git worktree remove`，再删 DSH 工作区注册；DSH session 日志永不删除；
- 支持面板内 dry-run；自动清理每 24 小时最多一次，结果写入
  `~/.dsh/state/workbench/retention.json`；
- `cordis.patch.yml` 的 `retentionAutoCleanup` 是初始值；`retention.json`
  已存在时，运行开关以台账里的 `settings.autoCleanup` 为准。开启请用
  `handover/enable-retention-auto-cleanup.sh --apply`，脚本会同步配置和台账；
- 任何一项检查失败都保留现场并记录原因，不提供 `rm -rf` 兜底。

## 安全边界

- 只注册 `/dsh-workbench/api` 一个前缀路由；Host/Origin 与浏览器登录态由 DSH Connection 的
  `ctx.connection.requestRejection` 判定，未登录 401，不受信来源 403；
- SA 写操作必须带 `x-orchestrator-request: 1`，且只允许白名单方法/路径；
- 不读凭据、不读 `.env`；代码浏览屏蔽 `.env*`、`.git`、凭据目录、`*.pem/*.key/*.sqlite/*.db` 等；
- 所有内容以 React 元素渲染，不使用 `innerHTML`。

## 目录结构

```text
task/dsh-workbench/
├── package.json          # bundle 清单：dsh.bundle.patch + dsh.client（web，immediately）
├── cordis.patch.yml      # 插入行 dsh-workbench
├── index.js              # Host：路由、快照、SA 代理、后台 fetch、保留策略循环
├── lib/tickets.js        # 只读 orchestrator.sqlite
├── lib/gitdata.js        # git show / ls-tree / diff / fetch
├── lib/markdown.js       # Markdown 子集 → block / 行内片段；diff 切块
├── lib/repos.js          # 只读仓库：文档索引 / 目录树 / 文件内容
├── lib/workspaces.js     # DSH workspaceRegistry 读取
├── lib/retention.js      # 60 天保留、安全检查与清理台账
├── lib/sa.js             # SA 管理 API 白名单代理
├── client.js             # 浏览器侧：侧栏图标 + 5 个标签页
├── locale/zh.json        # 中文文案
├── locale/en.json
├── market/person-clouds__dsh-workbench.yml
├── icon.svg
├── scripts/
│   ├── sa-state.sh            # SA 运行态只读读取（journal 取 token → cookie → /orchestrator/api/state）
│   └── retire-legacy-units.sh # 收尾退役旧单元（dsh-superagent / superagent-console），幂等
└── handover/                  # 单 Host 切换脚本与补丁（switch-single-host.sh 等）
```

## 已知限制

- 分支改动只在分支已推送或本地仍存在时可读；执行目录已清理且分支已删时只剩报告与文档；
- 单次 diff 截断 400KB，单文件超过 2MB 或为二进制时不内联；
- 不做代码全文搜索；
- 能看到工作台的人等于能看到工单、文档与代码（与 DSH 登录态一致）。
`sa-state.sh` 是 SA 运行态的唯一读取实现：`cloudctl sa status` 与
`task/health-watch/scripts/checks/50-superagent.sh` 都调它，避免两套口径。

