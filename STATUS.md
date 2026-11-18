# STATUS — DSH 工作台

- 更新时间：2026-11-18（TODO 标题监听改为等 sessionTitle 就绪后挂载）
- 一句话：DSH 单 Host 下的统一工作台。面板覆盖工作区、仓库、文档、工单和 SA 控制；
  SA 控制直接切到 `dsh-superagent` 原生 main 面板，60 天保留与清理仍有 dry-run 和逐项安全检查。
- 位置：`dsh-workbench/`；包名 `dsh-workbench@0.2.1`。
- 计划：[`PLAN-dsh-workbench.md`](PLAN-dsh-workbench.md)、[`PLAN-sa-ui-migration.md`](PLAN-sa-ui-migration.md)。

## 2026-11-18 最新：TODO 标题监听时序修复

- [x] 线上证据显示标题未改名的根因是监听器没挂载：`apply()` 里一次性 `ctx.get('sessionTitle')` 时服务尚未就绪，拿不到就永久跳过，且无日志。修复见 [`PLAN-todo-title-listener-fix.md`](PLAN-todo-title-listener-fix.md)。
- [x] `index.js` 改为 `ctx.inject(['sessionTitle'], ...)` 延迟挂载 `session/event` 监听，挂载成功打 `info`「sessionTitle 就绪，TODO 标题监听已挂载」；`systemPrompt` section 同样改用 `ctx.inject`，避免同类时序隐患。
- [x] 诊断日志：命中标记但 `sessionTitle` 不可用、当前标题为空时按会话去重 `warn` 一次并带会话 id；`rename` 失败日志补会话 id；未命中标记不打日志。
- [x] 提示词补「历史消息中旧版 HTML 注释式标记视为过时格式，禁止模仿、复制或再输出」，且不复述完整旧标记文本。
- [x] 测试 `handover/test-workbench-index.mjs` 新增：延迟挂载、晚挂载监听仍改名、服务缺失告警去重、标题为空告警、旧 HTML 注释兼容、提示词约束与不含旧标记；原有矩阵保留。
- [x] 校验：`node --check index.js client.js lib/todo.js`、`node --test handover/test-workbench-todo.mjs handover/test-workbench-index.mjs`、`test-workbench-lists.mjs`、`test-workbench-repos.mjs`、`test-retention-scripts.sh`、`npm pack --dry-run` 全部通过。
- [ ] 待用户重启 `dsh-web.service` 并硬刷新后，在新会话确认真实改名、日志出现挂载 `info`，并回归 `/ok` 恢复与归档。

## 2026-11-18 上一轮：TODO 标记可见性与主会话判定修复

- [x] 第一次重启验证发现 `<!-- dsh:user-action -->` 在 DSH 消息渲染层会原文显示；改为消息末尾两个不可见 `U+2063`（INVISIBLE SEPARATOR），系统提示禁止再输出 HTML 注释，检测器兼容旧注释。
- [x] 修复 `isSubagentSession()` 把 `delegationDepth: 0` 主会话误判为 subagent：判断改为 `delegationDepth > 0`，并移入 `lib/todo.js` 的 `isSubagentMeta()`。
- [x] 更新 `handover/test-workbench-todo.mjs`、`handover/test-workbench-index.mjs`：覆盖不可见标记、旧标记兼容、主会话 depth 0 触发、depth > 0 与 `origin=subagent` 跳过。
- [x] 校验：相关 `node --check` 与 `node --test handover/test-workbench-todo.mjs handover/test-workbench-index.mjs` 通过。
- [ ] 待用户重启 `dsh-web.service` 并硬刷新后，在真实新会话确认标记不可见且标题变为 `TODO：...`。

## 2026-11-17 上一轮：TODO 会话标记与 `/ok`

- [x] 新增 `lib/todo.js`：末尾隐藏标记识别、`TODO：` 前缀幂等添加与去除；空标题回退 `未命名会话`。
- [x] 新增只读辅助接口 `action=todoState&sessionId=`，返回当前标题与 `hasTodo`；并补 `handover/test-workbench-index.mjs` 覆盖监听接线、subagent 跳过和接口返回。
- [x] Host 注入系统提示，当时输出可见 HTML 注释标记；2026-11-18 已改为不可见 `U+2063`。监听 `assistant/message`，跳过 subagent，重命名标题并写永久标题缓存。
- [x] 新增 `POST /dsh-workbench/api/archive`，经 `workspaceRegistry.archiveSession(..., { stopActivity: true })` 归档；不会删除日志或目录。
- [x] 客户端注册 `/ok` 命令源：只清除当前会话 TODO 前缀，命令结果输出后延迟约 1.5 秒异步归档，不发送 prompt、不产生新回合。
- [x] 新增 `handover/test-workbench-todo.mjs` 并通过。
- [x] SA 飞书入站拦截人类 `/ok`：停止关联 open Ticket、恢复 worker 标题、归档 worker/评估会话并回复。
- [x] 校验：`node --check index.js/client.js/lib/todo.js`、Workbench 定向测试、SA `pnpm check` 通过。


## 2026-11-16 最新：归档会话标题缓存与仓库会话分区

- [x] 新增 `lib/title-cache.js`：`<dshHome>/state/workbench/session-titles.json`，进程内 Map + mtime 校验，合并后临时文件 + rename 原子写，失败仅告警。
- [x] `sessionCatalog()` 标题改为 DSH 投影缓存 → 永久标题缓存，不再批量 `readTitleSnapshots()`；`hydrateSessionTitles()` 只补传入的当前页，归档缓存命中直接跳过。
- [x] 工作区卡片按切片后补标题；`view=sessions` 分页后补当前页，`sort=title` 才在排序前补全。
- [x] 仓库列表不再携带 `sessions/sessionTotal`，也不在列表阶段调用 `sessionCatalog`；新增 `view=repoSessions&repo=&offset=&limit=&archived=`，按 cwd（含子目录）匹配并排除 subagent。
- [x] 仓库卡片删除会话区块；仓库详情根目录增加“仓库会话”区，翻页走服务端，默认 10 条/页。
- [x] 测试新增：当前页标题读取、永久缓存二次命中零日志、DSH 投影优先、仓库会话分页和列表无会话字段。
- [x] 校验：`node --check index.js/client.js/lib/*.js`、`node --test handover/test-workbench-lists.mjs handover/test-workbench-repos.mjs` 通过；重启 `dsh-web` 实测待用户确认。

## 2026-11-16 上一轮：仓库列表按更新时间倒序

- [x] `view=repos` 默认每页 4 条，`updatedAt` 取仓库最新提交时间；非 git 目录回退到 mtime。
- [x] 服务端先对全量仓库按 `updatedAt` 倒序稳定排序，再分页；前端仓库页同步传 `sort=updatedAt&dir=desc`，分页控件按每页 4 条计算。
- [x] 校验：`node --check index.js/client.js/lib/*.js`、`node --test handover/test-workbench-repos.mjs handover/test-workbench-lists.mjs` 通过。

## 2026-11-16 上一轮：列表规则强化与性能优化

- [x] 新增 `lib/list.js` 统一列表参数：`offset/limit`（上限 50）、`total/hasMore`、
      归档筛选规范化、排序字段/方向白名单、唯一 id 稳定次级排序。
- [x] 会话默认 `archived=active`：`sessionCatalog` 先按归档状态过滤，再只为当前结果读标题快照；
      工作区页提供「未归档 / 已归档 / 全部」切换，并保留页码/筛选状态。
- [x] `view=workspaces` 改为服务端分页（默认 8 个），每卡只带当前 10 条会话预览与
      `sessionTotal/sessionHasMore`；新增 `view=sessions&workspace=<id|ungrouped>` 分页接口，
      卡片翻页不再全量展开。
- [x] `view=repos`、`view=docRepos`、`view=tree` 统一服务端分页并返回 `total/hasMore`；
      前端仓库卡片、文档仓库选择、目录树全部改为按页请求，不再本地切片。
- [x] 工单列表改为服务端分页（默认 `filter=live`、每页 10），只对当前页解析文档标题；
      移除了列表对全库逐条 `buildDiff` 的昂贵 git 操作；详情行为不变。
- [x] 新增 `handover/test-workbench-lists.mjs`：覆盖参数上限/回退、默认未归档、
      服务端会话分页与目录树单层分页；与既有 `test-workbench-repos.mjs` 一起通过。
- [x] 校验：`node --check index.js/client.js/lib/*.js`、`node --test handover/test-workbench-lists.mjs
      handover/test-workbench-repos.mjs` 通过。
- [ ] 待重启 `dsh-web` 后做浏览器人工核对（需用户确认；未重启前插件代码不会生效）。

## 2026-11-15 最新：工单筛选修复 + SA 控制改走原生前端

- [x] 工单右上角筛选改为显式 `live | all` 两态：不再用 `showAll` 推导展示集合。
      真实库 11 张工单全部已结束（`live:false`），旧实现会把「只看进行中」静默回退成全部，
      导致按钮文案/`aria-pressed` 与列表不一致；现在空态会明确提示没有进行中工单，
      点击「看全部」立即展示全部。
- [x] 「SA 控制」不再渲染工作台手写管理表单：新增原生入口，通过
      `ctx.layout.selectPanel('dsh-superagent')` 打开 `dsh-superagent` 已注册的 `main` 面板。
      复用完整原生前端（概览/来源/触发/评估/执行/设置/提示词），不复制 bundle、不维护第二套 CSS。
- [x] 浏览器端插件 `inject` 增加 `layout`；仅在布局接口不可用时回退旧 `LegacySaView`。
- [x] 新增 [`PLAN-sa-ui-migration.md`](PLAN-sa-ui-migration.md)：列出保留清理、原始 JSON、
      工单快照/diff/报告等工作台独有能力，明确「待做待迁、本轮不实现」。
- [x] 校验：`node --check index.js/client.js`、`vm.Script` 解析 + client 双加载 + factory 执行、
      `node --test handover/test-workbench-repos.mjs`、`npm pack --dry-run`（v0.2.1，18 文件）通过。
- [x] 浏览器验收（Playwright + 本机 3080，使用当前已加载插件）：
      工单页初始「只看进行中」显示「当前没有进行中的工单」，点「看全部」后列出 11 条、
      按钮切为「只看进行中」且 `aria-pressed=true`；
      SA 控制页点「打开 Superagent 原生控制台」后成功切到 `dsh-superagent` 的
      概览/来源/触发/评估/执行/设置页面，控制台无 pageerror。

## 已完成（代码侧）

- [x] 改名：目录、包名、插件 id、路由 `/dsh-workbench/api`、侧栏 id `dsh-workbench`、
      市场条目与语言元信息全部切换；不保留旧包名兼容。
- [x] Host：`GET /dsh-workbench/api` 支持工单快照、`view=workspaces|sessions|repos|docs|docRepos|tree|blob|retention`；
      工作区/会话/仓库/文档仓库/目录树均支持服务端分页与归档筛选，`docs` 支持 `repo` 只加载单个仓库；
      `POST` 支持 `dry-run`、`cleanup`、`settings`。
- [x] Host：读取 DSH `workspaceRegistry`，不再读第二份 `workspace.json`；仓库来源改为
      `config.repos` + DSH 工作区路径。
- [x] Host：SA 管理 API 白名单代理 `/dsh-workbench/api/sa`，带
      `x-orchestrator-request: 1`，透传 DSH cookie。
- [x] Host：60 天保留、多重安全检查、台账 `~/.dsh/state/workbench/retention.json`、
      手动 dry-run/cleanup 与每天最多一次自动清理；不删 DSH session 日志。
- [x] Client：5 个标签页 `[工作区] [仓库] [文档] [工单] [SA 控制]`；工作区/保留策略/Settings
      与提示词编辑；工单重试/停止。
- [x] Client：工作区/仓库/工单/目录树均按服务端页请求；文档页先选仓库再按需加载，目录默认收起；
      会话默认未归档并可切换归档范围，分页按钮过多时只显示首尾与当前附近页码。
- [x] 语法与打包自检：`node --check index.js`、`client.js` 的 `vm.Script` 解析、
      `npm pack --dry-run` 通过；`node --test handover/test-workbench-repos.mjs` 通过。
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

### 2026-11-15 `pnpm test` 单例失败：Feishu health 竞争

- 现象：60 文件中仅 `tests/sources.spec.ts` 的 malformed line 用例失败；
  期望 `health.feishu.state == "error"`，实际被晚到的 `[event] ready` 覆盖为 `ready`。
- 根因：`consume()` 的 stdout/stderr 是两个独立管道，事件顺序不保证；
  malformed JSON 已在 stdout 链上报错后，stderr 的 ready 仍可能后到并覆盖。
- 修复：新增增量补丁
  [`handover/dsh-superagent-feishu-health-race.patch`](handover/dsh-superagent-feishu-health-race.patch)，
  在单次 consumer 生命周期内保留首个错误；ready 仅在尚未失败时上报。
- 这是既有竞态，不是 `dsh-superagent-defer-ready.patch` 引入；两个补丁需一起应用后再跑全量测试。

### 2026-11-15 首次 `--apply` 回滚：脚本把无关插件警告当致命错误

- 现象：`bundle 解析` 与悬空检查均通过，服务也已启动（3080 返回 401），
  但脚本约 5 秒后判失败并回滚。
- 根因：日志致命匹配用了裸 `failed to import`，命中 profile 里既有的
  `context-guard (dsh-context-guard): failed to import ... Cannot find package 'dsh-context-guard'`；
  它与 workbench/SA 无关，服务实际仍在运行。
- 次生问题：`journalctl --no-pager` 输出带时间/进程前缀，而提取 token 用了
  `grep '^dsh web:'`，即使不误判也提取不到；现改为 `-o cat`。
- 修复：新增 `fatal_log()`，只匹配 `dsh-workbench` / `dsh-superagent`
  自身的 bundle 跳过、loopback、锁、导入失败，并打印命中行后再诊断/回滚。
- 回滚结果正常：`3082=1，3080(401)=1`。

### 2026-11-15 第二次 `--apply` 回滚：`fatal_log` 在无匹配时触发 `set -e`

- 现象：服务刚启动、日志尚无目标 bundle 错误，脚本约 3 秒后退出并回滚。
- 根因：`FATAL=$(fatal_log "$LOG")` 中，grep 无匹配返回 1；在 `set -e` 下
  命令替换的退出码会使整个脚本退出。
- 修复：`fatal_log()` 末尾加 `|| true`，保证无致命错误时返回 0；
  已用 `bash -c 'set -euo pipefail; f(){ grep ... || true; }; X=$(f); echo ok'` 验证。

### 2026-11-15 第三次 `--apply` 回滚：token 提取管道触发 `set -e`

- 现象：服务刚启动、journal 尚未打印 `dsh web: ...?token=`，脚本约 3 秒后回滚。
- 根因：`TOKEN_URL=$(grep ... | tail -1 | sed ...)`；`set -o pipefail` 下
  首轮 grep 无匹配返回 1，整个命令替换失败，`set -e` 直接退出。
- 修复：提取管道末尾加 `|| true`，让轮询在无 token 时正常 sleep 重试。
- 同类隐患已全量排查：其余 `grep` 均在 `if` / `|| die` / `|| true` 中。

### 2026-11-15 增加切换脚本 `--self-test`

- 连续两次问题都不是业务错误，而是 `set -euo pipefail` 下的 shell 控制流；
  diagnostics 收集发生在退出之后，所以日志里看不到“错误”。
- 新增 `--self-test`：不读取、不修改宿主机，只验证
  `fatal_log()` 无匹配/目标命中、`extract_token_url()` 无 token/有 token 四种场景。
- 新增 `handover/test-switch-single-host.sh`：用假 `systemctl`/`journalctl`/`curl`/`dsh`
  在临时 `HOME`/`DSH_HOME` 中跑完 `--apply` 全路径（含首轮无 token 的轮询），
  不接触宿主机服务或真实 profile。
- `HANDOVER.md` §2 执行顺序改为 `--self-test` → mock 回归 → `--dry-run` → `--apply`。

### 2026-11-15 第四次 `--apply` 回滚：SA 管理 API 缺少 `x-orchestrator-request: 1`

- 现象：workbench API=200，但 `GET /orchestrator/api/state` 返回 403，
  body 为 `{"error":"Same-origin management request required"}`。
- 根因：SA 在 `src/app/http.ts` 中除同源登录态外，还要求
  `x-orchestrator-request: 1` 才接受管理 API；脚本与可用性检查都只带了 cookie。
- 修复（全量同类点）：切换脚本两处探测、`dsh-usability-check/scripts/check.sh`、
  HANDOVER 手工复核命令全部补该 header；mock 测试的 cURL 桩现在对缺失 header
  返回 403，防止回归。
- 验证：`--self-test`、mock 全路径回归、`bash -n` 均通过。

## 2026-11-15 单 Host 切换成功（本机）

- [x] `switch-single-host.sh --apply` 通过：3080 单 Host 启动，SA 作为 web profile
      插件接管状态目录；3082 已停用，旧 `dsh-superagent.service` 已 disable。
- [x] 可用性检查核心链路通过：HTTP 401 → token 303 → 首页 200、`/api/remote.mux` 101、
      `/plugins/events` connected + graph。
- [x] 扩展链路通过：`/dsh-workbench/api` 200、`/orchestrator/api/state` ready、
      `dsh-workbench` / `dsh-superagent` bundle 可解析。
- [x] 工作台 SA 代理鉴权修复：保留浏览器原始 Host/Origin，附离线回归。
- [x] 验收与清理已脚本化：`handover/retention-dry-run.sh`、
      `handover/enable-retention-auto-cleanup.sh`，写操作带备份和审计记录。
- [ ] 浏览器人工核对 5 个标签页、SA 写操作。
- [ ] 执行 `retention-dry-run.sh`，确认结果后再执行
      `enable-retention-auto-cleanup.sh --apply`。

> 已知非阻塞项：profile 内 `dsh-compaction-archive` 链接指向已改名的旧目录
> `task/dsh-compaction-archive`（现为 `dsh-context-guard`），可用性检查因此返回 2。
> 新增 `dsh-usability-check/scripts/clean-dangling-profile-links.sh`：
> 默认预览，`--apply` 只删除悬空软链接并写
> `~/.dsh/state/workbench/profile-link-cleanup.log`；目标目录/正常文件不受影响。

### 2026-11-15 工作台 SA 管理接口返回 `Authentication required`

- 现象：切换成功后，浏览器打开工作台「SA 控制」提示 `Authentication required`。
- 根因：工作台 Host 端代理原来用 `fetch` 请求 `127.0.0.1:3080`，`fetch` 会把
  `Host` 改成 `127.0.0.1:3080`；DSH 登录 cookie 名按 Host 绑定，SA 按新 Host
  找不到原 cookie，判定未登录。
- 修复：`lib/sa.js` 改用 `http.request`/`https.request`，保留浏览器原始
  `Host` 与 `Origin`，继续转发 cookie 和 `x-orchestrator-request: 1`。
- 回归：新增 `handover/test-sa-proxy.mjs`，断言代理到 SA 的 Host/Origin/cookie
  与浏览器一致，已验证 PASS。
- 生效方式：重启 `dsh-web.service` 后浏览器硬刷新。

## 2026-11-15 自动清理“配置已开但运行仍关闭”

- 现象：`enable-retention-auto-cleanup.sh` 报“已经开启”，但 dry-run 仍显示
  “自动清理: 关闭”。
- 根因：配置 `cordis.patch.yml` 已改为 `true`，但运行台账
  `~/.dsh/state/workbench/retention.json` 里仍是之前 dry-run 落下的
  `settings.autoCleanup: false`；工作台运行开关以台账为准。
- 修复：开关脚本 `--apply` 同时改配置和台账，分别备份并写审计；预览会明确
  显示 `config=... manifest=...`。
- 回归：`test-retention-scripts.sh` 覆盖“配置 false+台账 false”和
  “配置 true+台账 false”两种情况，打印 PASS。

## 待本机执行（切换后）

1. 用浏览器核对 5 个标签页、SA 写操作、归档/清理 dry-run；
2. dry-run 通过后把 `~/.dsh/profiles/web/cordis.patch.yml` 的
   `retentionAutoCleanup` 改为 `true` 并重启 `dsh-web`；
3. 若尚未执行，按 `HANDOVER.md` §1 应用
   `dsh-superagent-feishu-health-race.patch`，再跑 `pnpm typecheck && pnpm test && pnpm build`。

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

## 2026-11-15 展示补全与 SA 控制重做

### 调整

- 工作区页不再只依赖已有分组：Host 端同时返回 `workspaces` 与
  `ungrouped`，浏览器展示所有工作区卡片及明确的「未分组」桶；会话显示
  `sessionQuery` 标题，找不到标题时回退「未命名会话 + ID」。
- 仓库页从“只有两个”修正为四类来源合并：显式 `config.repos`、SA 交付仓库
  `repoDir`、DSH 工作区路径、`<stateDir>/work/*` 工单子项目；按真实路径去重，
  每项显示来源徽标与 git 检测结果，并附 cwd 命中的会话名。
- 文档页保持原 API 扁平 `{path,title}` 数据，浏览器侧构建层级树；目录可折叠，
  路径分隔与计数保持稳定。
- SA 控制页不再直接 `<pre>` 原始 JSON：新增概览/问题/健康、来源状态与 health、
  标签刷新、策略同步、线程订阅/取消订阅、决策记录与不可用决策忽略、
  revision-aware 设置表单（含 `rows`/facts/高级开关）、
  提示词编辑（团队三段、技能、修订历史）和保留策略；所有写操作仍走白名单代理。
- 旧 `dsh-superagent` 侧边栏入口与工作台重复。新增待应用的
  `handover/dsh-superagent-hide-legacy-sidebar.patch`：只移除侧栏图标，
  保留 `main` 深链供排障，日常管理统一走 `dsh-workbench`。

### 验证

| 项 | 结果 |
|---|---|
| `node --check index.js` / `lib/*.js` | 通过 |
| `client.js` `vm.Script` 解析 + 连续加载两次 | 两次均注册 `dsh-workbench`，factory 可执行 |
| 临时 Host（复制 DSH_HOME，3081）`view=workspaces` | 返回 2 个工作区 + 未分组桶 |
| 临时 Host `view=repos` | 14 项：1 sa-delivery + 2 workspace + 11 sa-work；git 检测均成功 |
| 临时 Host `view=docs` | 14 组、按仓库返回 Markdown 文件 |
| `handover/dsh-superagent-hide-legacy-sidebar.patch` | 在源文件临时副本上 `patch --dry-run` 通过 |
| `npm pack --dry-run` | 通过，包含 `lib/sessions.js` |

> 本次改动需重启 `dsh-web.service` 并硬刷新浏览器才会生效。
