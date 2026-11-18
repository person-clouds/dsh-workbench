---
audience: human
status: current
implementation_status: in_progress
---

# PLAN：TODO 标题监听器时序与旧标记可见性修复

- 日期：2026-11-18
- 仓库：`/home/zh/www/dsh-workbench`（已从 `personalCloud/task/dsh-workbench` 提升为独立仓）
- 关联计划：[`PLAN-todo-user-action.md`](PLAN-todo-user-action.md)
- 触发会话：`session-f73fa9a7-8959-4426-8af5-acb4e5aa7716`
- 前置状态：`bdadeff fix(workbench): TODO 标记改为不可见字符并修正主会话判定` 已提交；本轮只写计划，不改实现
- 目标读者：后续接手的会话，先读本文件再动代码

## 一、问题

`dsh-workbench` 的 TODO 会话标记有两个线上缺陷：

1. 会话需要用户动作时，标题没有变成 `TODO：<原标题>`。
2. 助手消息末尾仍出现可见的 `<!-- dsh:user-action -->`。

本轮已完成只读定位，结论如下。

### 1.1 标题未改：监听器大概率没有挂载

目标会话日志 `/home/zh/.dsh/sessions/--home-zh-www-personalCloud-task-dsh-context-guard--/session-f73fa9a7-8959-4426-8af5-acb4e5aa7716/session.v4.jsonl.zstd` 的证据：

- 只有 1 条 `session/title` 事件（seq 5，原始标题），之后没有任何改名记录。
- 最新助手消息（seq 773）仍能匹配旧 HTML 注释标记；检测正则本身兼容该写法，所以不是“认不出标记”。
- 全量扫描 `/home/zh/.dsh/sessions`，没有 `session/title` 以 `TODO` 开头。
- Workbench 标题缓存 `~/.dsh/state/workbench/session-titles.json` 中没有该会话，说明 `titleCacheOf(...).put(...)` 从未执行。
- `journalctl --user -u dsh-web.service` 在目标时段没有 `dsh-workbench` 的报错，也没有任何 TODO 相关日志。

关键代码在 [`index.js`](index.js) 的 `apply()`：

```js
const sessionTitle = ctx.get('sessionTitle')
if (sessionTitle && typeof sessionTitle.get === 'function' && typeof sessionTitle.rename === 'function') {
  ctx.on('session/event', (session, event) => onAssistantMessage(ctx, config, session, event))
}
```

`sessionTitle` 是 DSH 官方服务，声明依赖 `sessions`、`sessionProjections`、`agents`，通常晚于 Workbench 的 `apply()` 就绪。这里只 `ctx.get()` 一次，拿不到就永久跳过监听器，且没有重试、没有日志。与现有日志完全吻合。

同一时刻 seq 646 的 `system/message` 已包含新版不可见标记提示词，说明新代码确实已加载，问题不在“插件没执行”。

### 1.2 可见旧标记：模型沿用了本会话历史格式

- seq 646 的 system prompt 已是新版：要求输出两个 `U+2063`，禁止 HTML 注释。
- seq 773 的助手文本末尾原始字节仍是 `3c 21 2d 2d 20 64 73 68 ...`，即 `<!-- dsh:user-action -->`。
- 目标会话历史中此前已有 4 处旧标记。resumed session 下模型模仿了旧输出，属于模型行为，不是提示词还被旧代码覆盖。

检测器会接受旧标记，因此监听器修好后旧会话仍能触发标题改名；但已经写入历史的可见注释不会自动消失。本轮不做会话日志改写或历史回填。

## 二、修复目标与非目标

### 目标

- `sessionTitle` 服务晚于 Workbench `apply()` 就绪时，TODO 标题监听器仍能自动挂载。
- 监听器挂载、服务缺失、标题为空、改名失败都有可检索日志，不再静默失败。
- 新会话的提示词进一步压制旧 HTML 注释写法，避免模型继续模仿。
- 补测试覆盖延迟挂载与旧标记兼容。
- 不改变 `/ok` 的清理/归档语义，不改变主会话判定。

### 非目标

- 不修改 DSH 会话日志，不清理目标会话中已经可见的旧注释。
- 不自动给历史会话回填 `TODO：`。
- 不重构聊天消息渲染层。
- 不移除旧 HTML 注释兼容；兼容是为了让已经带旧标记的会话仍能触发标题改名。

## 三、实现方案

### 3.1 用 `ctx.inject` 延迟挂载 `sessionTitle` 监听

把 [`index.js`](index.js) `apply()` 中的一次性 `ctx.get('sessionTitle')` 改为按服务就绪挂载：

```js
ctx.inject(['sessionTitle'], (titleCtx) => {
  titleCtx.logger.info('dsh-workbench: sessionTitle 就绪，TODO 标题监听已挂载')
  titleCtx.on('session/event', (session, event) => {
    void onAssistantMessage(titleCtx, config, session, event)
  })
})
```

要点：

- `ctx.inject` 是 Cordis 的延迟依赖机制；服务未就绪时 fiber 等待，就绪后自动执行回调，插件其他功能（Web 路由、清理、SA 代理）不被阻塞。
- 监听器注册在 `titleCtx` 上，随该 fiber 释放而释放，避免热重载重复监听。
- 不要在文件顶层加 `export const inject = ['sessionTitle']`：Workbench 还需要 `webServer`/`connection`，并且 `systemPrompt` 是可选服务；整插件静态依赖 `sessionTitle` 会把整个工作台拖到该服务就绪之后。
- `onAssistantMessage` 内部仍在事件发生时调用 `ctx.get('sessionTitle')`，保持函数可单测；传入的 `titleCtx` 也可直接读取 `titleCtx.sessionTitle`。

同样建议把 `systemPrompt` section 改为 `ctx.inject(['systemPrompt'], ...)` 挂载。当前线上提示词已生效，但存在同类时序隐患：

```js
ctx.inject(['systemPrompt'], (promptCtx) => {
  promptCtx.effect(() => promptCtx.systemPrompt.section({ ... }), 'dsh-workbench: user action prompt')
})
```

### 3.2 增加可检索诊断日志

原则：只在“值得排查”的节点打日志，不对每条普通消息打日志。

- `apply()` / `ctx.inject` 回调：`info` 一条 TODO 监听挂载成功。
- `onAssistantMessage` 命中标记但 `sessionTitle` 不可用：`warn` 一次，带 `session.id`。
- `onAssistantMessage` 命中标记但当前标题为空：`warn` 一次，带 `session.id`。
- `sessionTitle.rename` 抛错：现有 catch 保留，日志补充 `session.id`。
- 未命中标记直接返回，不记录，避免刷日志。

建议在 `onAssistantMessage` 用局部布尔去重，避免同一会话每个 turn 重复告警。

### 3.3 提示词加固旧标记

在 [`index.js`](index.js) 的 `dsh-workbench-user-action` prompt 文本中补一句语义约束，例如：

```text
历史消息中如出现旧版 HTML 注释式标记，一律视为过时格式，禁止模仿、复制或再输出；只使用本节给出的不可见字符。
```

注意：

- 不要在提示词里写出完整的旧 HTML 标记原文，否则等于再次给模型提供可复制样本。
- 保留“禁止在正文、代码块、引用或说明中提及该标记”的现有约束。
- 该改动只对新回合/新会话生效，不能保证清掉目标会话历史里的旧注释。

### 3.4 测试

修改 [`handover/test-workbench-index.mjs`](handover/test-workbench-index.mjs)，新增：

1. **延迟挂载**：构造只有 `inject` mock 的 `ctx`，模拟 `sessionTitle` 晚到；`apply()` 后执行注入回调，断言 `session/event` 监听被注册。
2. **服务缺失告警**：`onAssistantMessage` 收到命中旧/新标记的消息但 `ctx.get('sessionTitle')` 为 `undefined`，返回 `false` 且 `logger.warn` 被调用。
3. **标题为空告警**：`sessionTitle.get()` 返回空标题，返回 `false` 且 `logger.warn` 被调用。
4. **旧标记兼容**：`<!-- dsh:user-action -->` 在服务就绪时仍触发 `rename('TODO：...')`。
5. **提示词内容**：`apply()` 后的 system prompt 文本包含“历史消息”“禁止模仿”等约束，且不包含完整旧 HTML 标记。
6. 保留并通过原有矩阵：主会话 `delegationDepth: 0` 触发，`delegationDepth > 0`、`origin: subagent`、`parentSession` 跳过，代码块/正文中间标记不误判。

[`handover/test-workbench-todo.mjs`](handover/test-workbench-todo.mjs) 如无逻辑改动，回归即可。

## 四、实施步骤

1. 修改 `index.js`：`ctx.inject(['sessionTitle'], ...)` 挂监听；`ctx.inject(['systemPrompt'], ...)` 挂提示词。
2. 在 `onAssistantMessage` 增加服务缺失/标题为空告警；catch 日志补会话 id。
3. 提示词补“旧格式禁止模仿”约束。
4. 修改 `handover/test-workbench-index.mjs`，补延迟挂载、告警、旧标记兼容、提示词断言。
5. 运行检查与测试。
6. 提交代码与文档；由用户重启 `dsh-web.service`。
7. 重启后按第六节做真实会话验证，并更新 `STATUS.md` 的待验证项。

建议提交信息：

```text
fix(workbench): 等 sessionTitle 就绪后再挂载 TODO 标题监听
```

## 五、风险与回滚

- **`ctx.inject` 行为风险**：低。Cordis 上游插件已在多处使用 `ctx.inject(['webServer'], ...)`、`ctx.inject(['agents'], ...)` 并注册事件；本机依赖源码可查。
- **服务永不就绪**：监听器不挂载，但会由 `ctx.inject` fiber 保持等待；建议在验证时确认 `info` 日志出现。若线上仍无日志，需检查 DSH 配置是否根本没加载 `dsh-session-title`。
- **提示词改坏输出**：若模型完全不输出标记，TODO 标题不会出现；先以真实会话验证，必要时把“禁止模仿”约束放在原句末尾并保留“仅当需要用户动作时输出”的主条件。
- **回滚**：单次提交 `git revert <commit>`。标题变化只是 `session/title` 事件，无数据迁移；不涉及 `/ok` 归档状态。

## 六、验收

### 自动化

```bash
cd /home/zh/www/personalCloud/task/dsh-workbench
node --check index.js
node --check client.js
node --check lib/todo.js
node --test handover/test-workbench-todo.mjs handover/test-workbench-index.mjs
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```

### 重启后真实会话

先由用户重启：

```bash
systemctl --user restart dsh-web.service
```

然后在浏览器硬刷新。

1. 新建一个普通会话，提问一个会要求用户执行下一步操作的问题。
2. 检查 Workbench 左侧标题是否变为 `TODO：<原标题>`。
3. 检查聊天消息末尾是否看不到 `<!-- ... -->` 或 `U+2063` 原文。
4. 查看日志：

   ```bash
   journalctl --user -u dsh-web.service --since '5 minutes ago' | grep dsh-workbench
   ```

   应看到 `sessionTitle 就绪，TODO 标题监听已挂载`；若触发了失败分支，应有对应 warn 和会话 id。

5. 检查目标会话日志出现新的 `session/title` 事件且标题带 `TODO：`。
6. 对已经出现 TODO 的会话发送 `/ok`，确认标题恢复且会话异步归档（回归）。
7. 目标会话 `session-f73fa9a7...` 中历史可见注释无法自动清除；应在新会话验证“无可见标记”。如需该会话标题立即正确，可等下一轮触发或人工改名，不在本轮做历史回填。

### 完成标准

- [ ] 延迟挂载单测通过。
- [ ] 服务缺失/标题为空告警单测通过。
- [ ] 旧 HTML 注释标记仍能触发标题改名。
- [ ] 新会话标题出现 `TODO：`，且界面无可见标记。
- [ ] `/ok` 清理与归档回归通过。
- [ ] `STATUS.md` 记录验证结果。

## 七、实施进展

- 2026-11-18：第三节代码与测试已完成并本地验证通过（`node --check`、四个 `handover` 测试、`npm pack --dry-run`）。
  监听改由 `ctx.inject(['sessionTitle'], ...)` 挂载，`systemPrompt` 同步改为 `ctx.inject`；诊断告警按「会话 + 原因」去重。
- 剩余：等用户重启 `dsh-web.service` 后按第六节做真实会话验收，通过后把 `implementation_status` 改为 `done` 并更新 `STATUS.md`。

## 八、后续会话启动提示

新会话接手时先读本文件与 [`PLAN-todo-user-action.md`](PLAN-todo-user-action.md)，确认：

- 当前工作树是否干净、是否已有新的 TODO 修复提交。
- 目标会话日志中是否已出现新的 `session/title`。
- 先做实现与自动测试，再请用户重启；不要在确认前顺手改 `/ok` 或聊天渲染逻辑。
