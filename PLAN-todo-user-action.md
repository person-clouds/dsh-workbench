---
audience: human
status: current
implementation_status: done
---

# 计划：TODO 会话标记与 `/ok` 完成归档

- 日期：2026-11-17
- 决策：仅有用户下一步动作时由 Agent 输出隐藏标记；`/ok` 手动清除并异步归档；飞书 `/ok` 结束 Ticket、收尾并归档 worker 与评估会话
- 前置：用户已确认命令为小写 `/ok`；群聊与私聊都接受；标记接受隐藏 HTML 注释

## 目标

- DSH 所有用户可见会话在“需要用户确认/执行命令”时，真实标题变为 `TODO：<原标题>`。
- 用户发送 `/ok` 清除当前会话标题前缀并异步归档，不发送 prompt、不产生新 turn。
- SA 的飞书 `/ok` 作为话题/任务完结信号：结束关联 open Ticket，停止对应 worker，清除标题，并归档 worker 与评估会话。
- 内部 subagent 会话不标记；Workbench 左侧工作区列表能立即看到标题变化。

## 范围

- 改：`dsh-workbench` Host 插件与客户端命令；`dsh-superagent` 飞书入站拦截、SourceContext 停止能力、测试与文档。
- 不改：DSH 会话日志、GitHub issue 状态、现有自动标题生成逻辑。
- 不做：自动清除 TODO；按消息内容猜测用户是否已完成；全量历史会话回填。
- 归档：`/ok` 是唯一入口；归档使用 `workspaceRegistry.archiveSession(..., { stopActivity: true })`，不删除日志和目录。

## 改动位置

### 1. `dsh-workbench`

- `lib/todo.js`（新）
  - `hasUserActionMarker(text)`：匹配消息末尾隐藏标记 `<!-- dsh:user-action -->`。
  - `withTodoPrefix(title)`：空标题回退 `未命名会话`；已以 `TODO：`/`TODO:` 开头则原样返回。
  - `stripTodoPrefix(title)`：只去掉开头一个 `TODO：`/`TODO:`。
- `index.js`
  - 注入可选 `systemPrompt`、`sessionTitle`；兼容 `ctx.get(...)`。
  - 注册全局 system prompt section：完成含“需要用户执行下一步/确认/跑命令”的回合时，在最后一条助手消息末尾另起一行输出 `<!-- dsh:user-action -->`；其他情况禁止输出，禁止在正文/代码块引用该标记。
  - 监听 `session/event` 的 `assistant/message`：
    - 从 `event.data.message.content` 提取 text block；
    - 末尾匹配标记且会话不是 `subagent`（`meta.origin === 'subagent'`、有 `parentSession`/`delegationDepth` 时跳过）；
    - 取 `ctx.sessionTitle.get(session)`，幂等改名为 `TODO：...`；
    - 成功后 `titleCacheOf(ctx, config).put([...])` 更新 Workbench 标题缓存，失败只告警。
  - 新增只读辅助 API（可选）：`action=todoState&sessionId=` 返回当前标题，供客户端 `/ok` 校验。
  - 新增 `POST /dsh-workbench/api/archive`：校验 `connection` 鉴权，调用 `ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })`；成功/已归档均返回 ok。
- `client.js`
  - 注入 `inputTriggers`、`sessions`。
  - 注册 `/ok` command source：候选名 `ok`，说明“清除当前会话的 TODO 标记”。
  - `submit` 用 `sessions.using(sessionId, ...)` 读取当前标题，`stripTodoPrefix` 后调用 `reference.binding.session.rename(title)`；返回成功/无需清除提示。绝不调用 `session.prompt`。
  - 标题恢复后异步调用归档 API（命令返回成功后再排队），失败只提示不阻塞；重复 `/ok` 已归档时返回成功。
- `locale/zh.json`、`locale/en.json`：`/ok` 文案。
- `handover/test-workbench-todo.mjs`（新）：标记匹配、前缀幂等、清除幂等、无标题回退。
- `README.md`、`README.en.md`、`STATUS.md`：补充 `/ok` 与 TODO 约定。

### 2. `dsh-superagent`

- `src/sources/feishu-loops.ts`
  - 在 `receive()` 调 `ctx.receive(trigger)` 之前识别纯文本 `/ok`（忽略大小写和首尾空白；只接受 `trigger.human`）。
  - 按 `trigger.threads` 找 open Ticket：从 `ticket.origin.triggerId` 取 origin Trigger 的 threads 与当前线程求交。
  - 有匹配：逐张 `ctx.tickets.stop(ticket.id, 'humanOk')`；随后用 `workerSessionId(ticket.id)` + `ticket.title` 调 `ctx.sessionController.rename(...)` 恢复标题（即清除 `TODO：`）。
  - 异步归档：`workerSessionId(ticket.id)` 与 `assessSessionId(threadKey)` 都调用 `ctx.sessions.archive(...)`；不 await 确认回复，失败只记日志。
  - 无论是否找到 open Ticket：不再把 `/ok` 送入 Engine；在话题回复一条简短确认（找到则“已结束”，没有则“当前没有进行中的任务”）。
  - 群聊与私聊都走同一路径。
- `src/sources/host.ts` / `src/app/source-context.ts` / `src/app/runtime.ts`
  - SourceContext 增加 `tickets.stop(id, reason?)`，内部接到 `Engine.stopTicket`；不向 Source 暴露 Store/Engine。
  - SourceContext 增加 `sessions.archive(id)`，内部调 `workspaceRegistry.archiveSession(id, { stopActivity: true })`，已归档视为成功。
  - 若 `sessionController.rename` 不可用，则跳过标题恢复并记日志，不阻塞 Ticket 结束。
- `tests/todo-ok.spec.ts`（新）
  - 群聊/私聊 `/ok` 结束对应 Ticket、不产生 Engine 入站记录。
  - 多 Ticket 同线程全部结束；无 Ticket 时只回复不报错。
  - `/ok` 大小写、空白、bot 消息、普通文本不误触发。
  - worker 会话标题从 `TODO：xxx` 恢复为 `ticket.title`。
  - 结束后 worker 与 `assess-*` 会话均进入归档集合；评估会话不存在时跳过。
- `README.md` / `docs/`：说明飞书 `/ok` 语义；SA 改动提交正文加“由SA更改”。

## 实施步骤

1. `dsh-workbench` 新增 `lib/todo.js` 与测试，实现标记检测和标题前缀函数。
2. `index.js` 注册全局提示与 `assistant/message` 监听，接 `sessionTitle.rename`、排除 subagent、更新标题缓存。
3. `client.js` 注册 `/ok` 命令，清除标题后异步归档当前会话；补 locale 与文档。
4. `dsh-superagent` 扩展 SourceContext 的 `tickets.stop`、`sessions.archive`，在飞书 `receive()` 前拦截 `/ok`。
5. 飞书 `/ok` 结束 Ticket、恢复 worker 标题、归档 worker/评估会话并回复确认；补测试与文档。
6. 运行检查与手工联调。

## 验收

- 普通会话需要用户操作时，标题变为 `TODO：<原名称>`；同一会话不重复叠加。
- 无用户操作时标题不变；subagent 会话永不出现 TODO。
- DSH 内 `/ok` 后标题恢复并异步归档，且没有新用户消息、没有模型回复；当前会话从活动列表消失，归档筛选可见。
- 飞书群话题/私聊发送 `/ok`：对应 Ticket 变为 ended/human/stopped，worker 停止，worker 标题恢复；worker 与评估会话归档；话题收到确认。
- 飞书 `/ok` 不再进入评估/路由流程；bot 消息与未授权消息不触发。
- Workbench 重启后标题仍正确；已有普通文本和代码块中的标记字符串不误触发。
- `node --check client.js`、Workbench 定向测试、SA `pnpm check` 通过。

## 回滚

- 两仓库分别单次提交回滚；`git revert <commit>`。
- 标题均为 `session/title` 事件，无数据迁移；归档是 workspace 注册表状态，可在 UI 取消归档恢复。
- 飞书行为为新增分支，回滚后 `/ok` 恢复为普通消息进入 Engine。
