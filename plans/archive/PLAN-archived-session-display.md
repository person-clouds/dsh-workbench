# 计划：归档会话标题缓存与仓库会话分区

- 状态：已完成（2026-11-16）
- 日期：2026-11-16
- 决策：仓库页不再附带会话；进仓库后分页展示；归档会话名走永久标题缓存
- 前置：用户已批准实施

## 目标

- 仓库列表只显示仓库信息，不再为每个仓库查会话。
- 进入仓库后单独展示该仓库会话，服务端分页（默认 10 条）。
- 归档会话标题一次读取后永久缓存；缓存命中零日志读取，未命中只读当前页日志。
- 会话标题读取统一放到分页/切片之后，禁止批量扫历史日志，并写入列表规范。

## 范围

- 改：新增 `lib/title-cache.js`；调整 `lib/sessions.js`、`lib/repos.js`、`lib/workspaces.js`、`index.js`、`client.js`、locale、测试、README、STATUS。
- 不改：归档/pin 写逻辑、会话日志、既有 API 的默认归档筛选。
- 不做：全量后台回填标题、外部数据库、新依赖。

## 改动位置

- `lib/title-cache.js`（新）
  - 文件：`<dshHome>/state/workbench/session-titles.json`，结构 `{version,updatedAt,sessions:{<id>:{title,createdAt,kind,cwd,archived,updatedAt}}}`。
  - 读：进程内 Map + 文件 mtime 校验；写：合并后原子写（临时文件 + rename），失败仅告警。
- `lib/sessions.js`
  - `sessionCatalog()`：标题先查 DSH 投影缓存，再查永久标题缓存；不再批量 `readTitleSnapshots()`。
  - `hydrateSessionTitles(ctx, sessions, cache)`：仅对传入的当前页 ids 去重读取日志；成功后写入永久缓存；归档会话缓存命中直接跳过。
- `lib/workspaces.js`
  - `sessionsPage()`：分页后对 `page.items` 补标题；`sort=title` 时先补标题再排序。
  - `workspacesOverview()`：每卡 `slice(0, sessionLimit)` 后、未分组切片后补标题。
- `lib/repos.js`
  - `reposOverview()` 不再挂 `sessions/sessionTotal`；列表接口不传 `ctx`。
  - 新增 `repoSessionPage(ctx, repo, options, cache)`：按 `cwd === repo.path` 或子路径匹配，归档筛选/排序/分页，标题只补当前页。
- `index.js`
  - `view=repos` 直接返回 `result.items`，删除第二次 `reposOverview(..., ctx)`。
  - 新增 `view=repoSessions&repo=<id>&offset=&limit=&archived=`，返回仓库信息 + 当前页会话。
- `client.js`
  - `RepoCard` 删除会话区块。
  - 仓库详情根目录增加“会话”区，使用服务端分页；翻页请求 `view=repoSessions`。
- 测试/文档：新增标题缓存命中与分页读取断言；README“列表查询约定”补会话标题按页读取规则；STATUS 记录。

## 实施步骤

1. 实现 `lib/title-cache.js` 与 `lib/sessions.js` 的缓存优先、按页补标题。
2. 改造 `lib/repos.js` 和 `index.js`：仓库列表去会话，新增 `repoSessions`。
3. 改造 `client.js` 仓库卡片与详情会话分页，补 locale 文案。
4. 更新测试并执行 `node --check`、`node --test handover/test-workbench-lists.mjs handover/test-workbench-repos.mjs`。
5. 更新 README/STATUS，重启 `dsh-web` 实测首次/二次归档访问与仓库页。

## 验收

- 仓库列表响应无 `sessions` 字段，不再调用 `sessionCatalog`。
- 进入仓库可看到会话，翻页由服务端完成，每页最多 10 条。
- 归档会话首次访问只读当前页标题；第二次访问命中永久缓存，不再读日志。
- 缓存文件包含每个已读归档会话的 `id` 与 `title`；重启 `dsh-web` 后名称仍在。
- 缓存/日志都缺失时显示现有“未命名会话”，不阻塞列表。
- 定向测试通过；归档工作区首屏预计从约 25s 降到秒级。

## 回滚

- 单次提交回滚代码；标题缓存文件为派生数据，可保留或删除，不影响归档状态和会话日志。
- 重启 `dsh-web` 即恢复原行为。
