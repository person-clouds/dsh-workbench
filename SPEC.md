---
audience: shared
status: current
---

# SPEC：dsh-workbench

## 目标

把 DSH 的工作区、仓库、文档、SA 工单与 SA 控制收进同一个 Web 侧栏面板，作为 DSH 的交付视图与 SA 管理入口；不新开端口、不启动第二个 DSH Host、不维护第二套 SA 表单。

## 用户

- 在 DSH Web 里做交付的个人开发者；
- 需要从同一面板查看 SA 工单、分支改动和仓库文档的场景。

## 范围

- Host 端：只注册 `/dsh-workbench/api`，读取 `ctx.workspaceRegistry`、SA `orchestrator.sqlite`（只读 WAL）、git 对象与本仓 Markdown；
- Client 端：侧栏图标 `dsh-workbench`（中文名「DSH 工作台」）→ `main` 槽位，五个标签页：工作区 / 仓库 / 文档 / 工单 / SA 控制；
- 列表统一用 `offset`/`limit` 服务端分页，返回 `total`/`hasMore`；
- SA 写操作经 `dsh-superagent` 原生面板同源接口 `/orchestrator/api/*` 转发。

## 非目标

- 不实现 `dsh-superagent` 原生面板已有功能（进度见 `plans/PLAN-sa-ui-migration.md`）；
- 不写 `orchestrator.sqlite`，不接管 SA 工单状态；
- 不读取凭据与 `.env`，不渲染 `innerHTML`；
- 不做第二套 SA 表单、不新增对外端口。

## 接口

- Host bundle：`package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` 插入 `id: dsh-workbench`；
- Client bundle：`dsh.client`（`platform: web`，`immediately: true`）；
- HTTP：`GET /dsh-workbench/api?view=workspaces|repos|repoSessions|docs|tree|file|tickets|...`，统一 `offset`/`limit`（上限 50）；SA 写操作需带 `x-orchestrator-request: 1`；
- 配置：`stateDir`、`repos` 等路径项均有默认值，见 `README.md`。

## 运行方式

```bash
# 本机开发（link 安装）
dsh plugin --profile web add link:/home/zh/www/dsh-workbench
# 重启 dsh web 后，侧栏出现「DSH 工作台」
```

## 验收命令

```bash
node handover/test-workbench-todo.mjs
node handover/test-workbench-lists.mjs
node handover/test-workbench-repos.mjs
node handover/test-workbench-index.mjs
bash handover/test-retention-scripts.sh
```

## 约束

- 中文文档与注释；提交信息用 `type(scope): 摘要`；
- 安全边界见 `README.md`「安全边界」；改动需同步 `README.md`、`STATUS.md` 与相关 `PLAN-*.md`。
