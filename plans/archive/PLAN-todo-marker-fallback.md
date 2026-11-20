---
implementation_status: done
created_at: 2026-11-19 22:15:00
updated_at: 2026-11-19 22:24:00
---

# PLAN：TODO 标记漏输出的兜底识别

- 仓库：`/home/zh/www/dsh-workbench`（本任务唯一可写仓）
- 触发会话：`session-8a3a4002-807d-42f5-b2ad-1dc2608df437`
- 关联：[`TODO-MECHANISM.md`](TODO-MECHANISM.md)、[`PLAN-todo-user-action.md`](PLAN-todo-user-action.md)
- 用户已确认采用方案 A（插件兜底 + 提示词收紧）

## 一、目标

标记仍是主路径；当模型漏输出末尾不可见标记、但最后一条消息含实质「需要你执行」小节时，插件仍能把标题改成 `TODO：<原标题>`。

非目标：不改 `/ok` 语义、不改主会话/subagent 判定、不猜测无小节结构的用户动作、不回填历史会话标题。

## 二、证据

- 触发会话 82 条 assistant 消息中 0 条含 `U+2063`；3 条含标记的 `user/message` 全是 runtime context 注入，说明提示词在、模型漏输出。
- 该会话唯一 `session/title` 为用户首条消息（seq 3），之后无改名事件；最终消息（seq 756）有 `## 需要你执行` + 编号列表 + 命令块，末尾无标记。
- 对照：同一进程（20:18 启动，已含 `51c27d7`）内 21:26 的 `session-4c282e28` 标题正常变为 `TODO G：…`，链路本身可用。
- 近 3 天扫描：含「需要你执行」的 assistant 消息 7 条，带标记 3 条；有小节条目的 5 条里 3 条漏标。

## 三、改动位置

1. [`lib/todo.js`](lib/todo.js)：新增 `hasUserActionSection(text)`。定位最后一段「需要你执行」小节（`#`~`######` 标题行、加粗行或独占一行的标签行）；小节内出现代码块起始或列表条目才算用户动作，只写「无」或纯说明不算。
2. [`index.js`](index.js)：`onAssistantMessage()` 判定改为「末尾标记 或 实质小节」；导入新函数；提示词补一句「出现非空『需要你执行』小节时同样必须输出标记」。
3. [`handover/test-workbench-todo.mjs`](handover/test-workbench-todo.mjs)：补小节识别矩阵。
4. [`handover/test-workbench-index.mjs`](handover/test-workbench-index.mjs)：补「无标记但有小节仍改名」，以及 superagent/subagent 不兜底回归。
5. [`README.md`](README.md)、[`STATUS.md`](STATUS.md)、[`TODO-MECHANISM.md`](TODO-MECHANISM.md)：说明两层触发。

## 四、实施步骤

1. 写 `lib/todo.js` 检测与导出。
2. 接 `index.js` 判定与提示词。
3. 补测试并本地跑通。
4. 同步 README / STATUS / TODO-MECHANISM。
5. 跑 AGENTS 规定的 5 条验证与 `./scripts/check.sh --repo dsh-workbench`，提交推送 `main`。
6. 用户重启 `dsh-web.service` 后做真实会话验证。

## 五、验收

自动化：

```bash
cd /home/zh/www/dsh-workbench
node handover/test-workbench-todo.mjs
node handover/test-workbench-lists.mjs
node handover/test-workbench-repos.mjs
node handover/test-workbench-index.mjs
bash handover/test-retention-scripts.sh
cd /home/zh/www && ./scripts/check.sh --repo dsh-workbench
```

真实会话（重启后）：

1. 新会话里让 Agent 收尾时列出需要用户执行的命令，但不要求它输出标记；标题应变成 `TODO：…`。
2. 收尾只写「需要你执行：无」的会话不应出现 TODO。
3. `/ok` 仍能清除前缀，且不归档会话。

## 六、风险与回滚

- 误标：讨论该规则时引用「需要你执行」小节且带列表，可能被兜底加 TODO。用「标题级 + 小节内代码块/条目」收紧，误报时 `/ok` 一次即恢复。
- 漏标：小节标题格式异常（如「待你执行」）不在兜底范围内，属可接受边界。
- 回滚：`git revert <commit>`；只影响 `assistant/message` 的判定，不涉及数据迁移。

## 改动记录

- 2026-11-19 22:15 建立计划：确认方案 A，列出检测规则、改动位置与验收。
- 2026-11-19 22:24 完成实现与测试：`hasUserActionSection()` 上线，监听器改为标记/小节双路径；5 条仓内验证与 `check.sh --repo dsh-workbench` 全绿；真实会话 seq 756 原文离线校验通过。待用户重启 `dsh-web.service` 后做真实验证。
