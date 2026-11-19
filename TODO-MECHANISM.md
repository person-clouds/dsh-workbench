---
audience: human
status: current
---

# TODO 标题机制：出现、原因与消失

本文说明会话标题前的 `TODO` 是怎么出现的、为什么以前一直没出现、以及怎样让它消失。

## 一、一句话结论

- **出现**：助手判断这一轮结束后需要你做下一步操作，就在消息末尾输出两个不可见 `U+2063` 标记；插件检测到标记后把当前会话标题改成 `TODO：<原标题>`。
- **消失**：在会话输入框发送 `/ok`。它只清除标题前缀，不发送消息、不生成模型回合、也不归档会话。
- **不会自动消失**：后续普通消息不会自动去掉已存在的 `TODO` 前缀；必须 `/ok` 或手动重命名。

## 二、出现机制

### 1. Agent 输出隐藏标记

[dsh-workbench/index.js](/home/zh/www/dsh-workbench/index.js) 通过 `systemPrompt.context({ required: true })` 注入一条运行时指令：

> 仅当这一回合结束时用户必须执行下一步操作、确认或运行命令，才在最后一条助手消息末尾另起一行输出隐藏标记。

标记本体是两个 `U+2063 INVISIBLE SEPARATOR`，见 [dsh-workbench/lib/todo.js](/home/zh/www/dsh-workbench/lib/todo.js) 的 `USER_ACTION_MARKER`。界面上不可见。

只有“需要用户动作”的回合才应输出；普通问答、纯信息回复不应输出。

### 2. 插件监听助手消息

[index.js](/home/zh/www/dsh-workbench/index.js) 在 `sessionTitle` 服务就绪后注册全局 `session/event` 监听：

1. 只处理 `assistant/message`；
2. 跳过 subagent 会话（`origin === 'subagent'`、有 `parentSession` 或 `delegationDepth > 0`）；
3. 检查助手文本末尾是否有隐藏标记（兼容旧 HTML 注释标记，但新消息不再使用）；
4. 读取当前会话标题，调用 `withTodoPrefix()` 加前缀；
5. 等消息 append 发布结束后，再调用 `sessionTitle.rename()` 写入新的 `session/title` 事件，并更新 Workbench 标题缓存。

### 3. 标题格式

- 普通标题：`TODO：<原标题>`
- `/D` 命令会话：`D: <摘要>` → `TODO D: <摘要>`
- `/G` 命令会话：`G：<标题>` → `TODO G：<标题>`

已带 `TODO` 前缀时重复触发是幂等的，不会叠加。

## 三、为什么以前一直没出现

不是单一原因，排查中确认过三层问题：

1. **监听器没有挂载**：早期在 `apply()` 里一次性 `ctx.get('sessionTitle')`，服务晚到时拿不到就永久跳过。已改为 `ctx.inject(['sessionTitle'], ...)`，服务就绪后自动挂载。
2. **minimal 预设丢失提示词**：普通 `systemPrompt.section()` 会被 `complete: true` 的 persona 替换，模型收不到标记指令。已改为 `required: true` 的 runtime context。
3. **改名被会话层拒绝**：`Session.commit()` 发布 `assistant/message` 时仍持有 `entry.appending = true`，监听器同步调用 `sessionTitle.rename()` 会触发 append 重入保护并抛错。已改为 `scheduleAssistantMessage()` 用微任务推迟到发布结束后执行。

排查细节见 [PLAN-todo-title-listener-fix.md](/home/zh/www/dsh-workbench/PLAN-todo-title-listener-fix.md)。

## 四、消失机制

### 推荐：输入 `/ok`

在会话输入框输入 `/ok` 并回车，或从斜杠命令列表选择 `/ok`：

- 读取当前标题；
- 若以 `TODO` 开头，只删掉开头一个 `TODO` 前缀；
- 不发送消息、不生成模型回合、不归档会话；
- 成功提示：“已清除 TODO，不归档会话”；
- 没有 TODO 时提示：“当前没有 TODO 标记，不归档会话”。

实现位置：[dsh-workbench/client.js](/home/zh/www/dsh-workbench/client.js) 的 `dsh-workbench-todo` 输入触发器。归档仍只能在会话列表手动操作。

### 其他方式

- 手动重命名会话也可以覆盖掉 `TODO` 前缀；
- 任何其它写入 `session/title` 的操作都会覆盖标题；
- 新消息本身不会自动清除旧前缀。

## 五、快速自查

1. 查看当前标题与 TODO 状态：

   ```text
   GET /dsh-workbench/api?action=todoState&sessionId=<session-id>
   ```

   返回 `title` 与 `hasTodo`。

2. 查看服务日志：

   ```bash
   journalctl --user -u dsh-web.service --since '5 minutes ago' | grep dsh-workbench
   ```

   正常挂载应出现 `sessionTitle 就绪，TODO 标题监听已挂载`。

3. 查看会话日志中的标题事件：确认出现带 `TODO` 前缀的 `session/title` 事件。

## 六、相关文件（本机路径）

- [dsh-workbench/index.js](/home/zh/www/dsh-workbench/index.js)：监听、标记检测、标题改名
- [dsh-workbench/lib/todo.js](/home/zh/www/dsh-workbench/lib/todo.js)：标记与前缀工具
- [dsh-workbench/client.js](/home/zh/www/dsh-workbench/client.js)：`/ok` 命令
- [dsh-workbench/README.md](/home/zh/www/dsh-workbench/README.md)：使用说明
- [dsh-workbench/PLAN-todo-title-listener-fix.md](/home/zh/www/dsh-workbench/PLAN-todo-title-listener-fix.md)：本次根因与修复计划
