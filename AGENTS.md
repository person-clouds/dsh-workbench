---
audience: ai
status: current
---

# AGENTS.md

> 本仓是独立的 DSH Web 插件仓库「DSH 工作台」。跨仓规则仍以 [`/home/zh/www/AGENTS.md`](../AGENTS.md) 为准；本文件只补充本仓规则。

## 0. 阅读顺序

1. 本文件；
2. [`SPEC.md`](SPEC.md)：目标、范围、接口、非目标与验收命令；
3. [`README.md`](README.md)：面板结构、数据来源、安装与安全边界；
4. [`STATUS.md`](STATUS.md)：当前实现状态与验收进度；
5. 进行中的 `PLAN-*.md`。

## 1. 硬约束

- 中文；代码/命令/日志可保留英文。
- 最小变更：只改被要求的内容，不顺手重构。
- 安全边界（见 `README.md`「安全边界」）：只注册 `/dsh-workbench/api`；SA 写操作必须带 `x-orchestrator-request: 1` 且只允许白名单方法/路径；不读凭据与 `.env`；内容一律以 React 元素渲染，禁止 `innerHTML`。
- 不新开端口、不启动第二个 DSH Host、不维护第二套 SA 表单。
- 只读 `~/.dsh/state/superagent/orchestrator.sqlite`，不写库。
- 提交信息用 `type(scope): 摘要`；每个提交只含本任务文件。

## 2. 改代码后必须验证

```bash
node handover/test-workbench-todo.mjs
node handover/test-workbench-lists.mjs
node handover/test-workbench-repos.mjs
node handover/test-workbench-index.mjs
bash handover/test-retention-scripts.sh
```

安装/联调：`dsh plugin --profile web add link:/home/zh/www/dsh-workbench`，重启 `dsh web` 后验证侧栏面板。

## 3. 文档与提交门禁

- 本仓 Markdown 必须有 `audience`/`status` frontmatter（见 `docs-policy.json`）。
- 提交前在 `/home/zh/www` 执行 `./scripts/check.sh --repo dsh-workbench`，失败不得提交。
- 改动同步 `README.md`、`STATUS.md` 与相关 `PLAN-*.md`。

## 4. 发布

构建、打包与 npm/Release 流程见 [`PUBLISHING.md`](PUBLISHING.md)。
