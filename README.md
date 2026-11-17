[中文](README.md) | [English](README.en.md)

# DSH 工作台（dsh-workbench）

把 DSH 工作区、SA 工单与报告、交付分支改动、Markdown 文档和只读代码浏览放进同一个侧栏面板；
需要操作 SA 时，从「SA 控制」直接切到 `dsh-superagent` 自带的完整前端页面，不再维护第二套较弱表单，也不新开端口或第二个 DSH Host。

> 定位：DSH 的交付视图与 SA 管理入口。状态事实只有一个写者：DSH Host 写 `workspace.json` 与 session，
> SA 写 `orchestrator.sqlite`；本插件只读 SA 数据库。SA 管理界面以原生 `dsh-superagent` 面板为唯一事实来源。

## 面板结构

侧栏图标（id `dsh-workbench`，中文名「DSH 工作台」）→ `main` 槽位：

```text
[工作区] [仓库] [文档] [工单] [SA 控制]
```

| 标签页 | 内容 |
|---|---|
| 工作区 | 读取 DSH `workspaceRegistry`：工作区卡片服务端分页 + 「未分组」桶；会话默认只显示**未归档**，顶部可切换未归档/已归档/全部；每张卡片显示当前页会话，翻页由服务端完成 |
| 仓库 | SA 交付仓库 + DSH 工作区路径 + `<stateDir>/work/*` 工单子项目，自动检测 git；仓库卡片每页 4 个并按更新时间（最新提交时间，非 git 目录取 mtime）倒序；仓库列表不附带会话，进入仓库后单独分页展示该仓库会话（默认 10 条/页），目录逐层加载也由服务端分页 |
| 文档 | 仓库选择服务端分页；选择后按需读取该仓库的 Markdown 索引，目录默认收起，点击逐层展开 |
| 工单 | SA 工单列表服务端分页，默认只查进行中；详情含报告、diff、工单记录；可直接重试/停止；列表不对全库逐条查 git |
| SA 控制 | 一键切到 `dsh-superagent` 原生 main 面板：概览 / 来源 / 触发 / 评估 / 执行 / 设置与提示词。工作台独有但原生暂缺的能力只登记在 [`PLAN-sa-ui-migration.md`](PLAN-sa-ui-migration.md)，本轮不实现 |

## 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 工作区、会话归属 | DSH `ctx.workspaceRegistry` | 与 DSH Web UI 同一份事实；未分组由 Host 端计算 |
| 会话标题 | DSH 投影缓存 + 永久标题缓存 + `ctx.sessionQuery` | 先查实时/持久化投影，再查 `<dshHome>/state/workbench/session-titles.json`；只有当前页缺标题时才 `readTitleSnapshots` 并回写缓存 |
| 仓库清单 | `config.repos` + SA 交付仓库 + DSH 工作区 + `<stateDir>/work/*` | 按真实路径去重，来源标记为 configured / sa-delivery / workspace / sa-work |
| 工单、报告、SA 设置 | `~/.dsh/state/superagent/orchestrator.sqlite` | 只读打开，WAL 可读 |
| 工单记录 | 交付仓库 `origin/main` 的 `docs/work/<id8>-*.md` | 只读 git 对象 |
| 分支改动 | `git diff <baseRef>...agent/<执行名>` | 只读；后台 `git fetch` 只更新引用 |
| 文档 / 代码 | `config.repos` + DSH 工作区路径 | `git` 或 `worktree` 模式 |
| SA 管理写操作 | `dsh-superagent` 原生面板 → `/orchestrator/api/*` | 原生页面与工作台同源；工作台旧 `lib/sa.js` 代理仅作布局接口不可用时的降级回退 |


## 列表查询约定

- 所有会持续增长的列表使用 `offset`/`limit`（`limit` 上限 50），响应带 `total`/`hasMore`；
  前端只保留当前页状态，不再先拉全量再切片；
- 会话默认 `archived=active`，显式传 `archived=archived|all` 才查看归档；工作区页顶部提供
  未归档 / 已归档 / 全部切换；
- 排序字段与方向走白名单，非法值回退默认；时间列表默认时间倒序并用唯一 id 做稳定次级键；
- 仓库列表默认每页 4 条，按 `updatedAt`（最新提交时间；非 git 目录回退 mtime）倒序；
- 工单列表只对当前页解析文档标题，不再为整库每条执行 `buildDiff`；
- 目录树按一层返回 `entries + total + hasMore`；工作区会话卡片分页接口为
  `view=sessions&workspace=<id|ungrouped>&offset=&limit=&archived=`，仓库详情会话分页接口为
  `view=repoSessions&repo=<id>&offset=&limit=&archived=`；
- 会话标题先查 DSH 投影缓存与永久标题缓存，只有当前页仍缺标题的会话才读日志；
  `sort=title` 时才先补全标题再排序。归档会话标题读取成功后永久缓存，重启后仍可直接命中。

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
除显式 `repos` 外，仓库列表自动包含：`repoDir` 指向的 SA 交付仓库、DSH
`workspaceRegistry` 中的所有工作区、`<stateDir>/work/*` 下的 SA 工单子项目。
同一真实路径只保留一次，不再读取 `superagent-console/repos.json`。

> 侧边栏统一入口是 `dsh-workbench`。若旧 `dsh-superagent` 面板仍占一个侧栏图标，
> 用 [`handover/dsh-superagent-hide-legacy-sidebar.patch`](handover/dsh-superagent-hide-legacy-sidebar.patch)
> 去掉重复入口；旧面板 `main` 深链保留，「SA 控制」正是通过 `ctx.layout.selectPanel("dsh-superagent")`
> 复用它。迁移清单见 [`PLAN-sa-ui-migration.md`](PLAN-sa-ui-migration.md)。

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
├── lib/workspaces.js     # DSH workspaceRegistry + 未分组 + 会话分页
├── lib/list.js           # 列表分页/归档筛选/排序白名单
├── lib/sessions.js       # sessionQuery 会话目录；按页补标题
├── lib/title-cache.js    # 归档会话标题永久缓存（原子写、失败仅告警）
├── lib/retention.js      # 60 天保留、安全检查与清理台账
├── lib/sa.js             # SA 管理 API 白名单代理
├── client.js             # 浏览器侧：侧栏图标 + 5 个标签页；SA 控制切原生面板
├── PLAN-sa-ui-migration.md # 原生 SA 页面兼容与「待做待迁」清单
├── locale/zh.json        # 中文文案
├── locale/en.json
├── market/person-clouds__dsh-workbench.yml
├── icon.svg
├── scripts/
│   ├── sa-state.sh            # SA 运行态只读读取（journal 取 token → cookie → /orchestrator/api/state）
│   └── retire-legacy-units.sh # 收尾退役旧单元（dsh-superagent / superagent-console），幂等
└── handover/                  # 单 Host 切换脚本与补丁（switch-single-host.sh 等）
```

`sa-state.sh` 是 SA 运行态的唯一读取实现：`cloudctl sa status` 与
`task/health-watch/scripts/checks/50-superagent.sh` 都调它，避免两套口径。

## 已知限制

- 分支改动只在分支已推送或本地仍存在时可读；执行目录已清理且分支已删时只剩报告与文档；
- 单次 diff 截断 400KB，单文件超过 2MB 或为二进制时不内联；
- 不做代码全文搜索；
- 能看到工作台的人等于能看到工单、文档与代码（与 DSH 登录态一致）。

## TODO 与 `/ok`

- 用户可见会话需要用户下一步操作时，Agent 用隐藏标记让标题变成 `TODO：<原标题>`；subagent 会话不标记。
- 在会话输入框发送 `/ok`：只清除标题前缀，命令结果输出后延迟约 1.5 秒再异步归档当前会话；不发送消息、不生成模型回合。
