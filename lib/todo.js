/** TODO 用户动作标记与标题前缀工具。 */

/** 消息末尾的不可见标记：两个 U+2063 INVISIBLE SEPARATOR。 */
export const USER_ACTION_MARKER = '\u2063\u2063'
const MARKER = /(?:\u2063+|<!--\s*dsh:user-action\s*-->)\s*$/u
const PREFIX = /^TODO[：:]\s*/u

/** 消息末尾是否有隐藏的用户动作标记。 */
export function hasUserActionMarker(text) {
  return typeof text === 'string' && MARKER.test(text.trimEnd())
}

/** 内部 subagent 会话不参与 TODO 标记；delegationDepth 0 是主会话。 */
export function isSubagentMeta(meta) {
  const value = meta && typeof meta === 'object' ? meta : {}
  const depth = Number(value.delegationDepth)
  return value.origin === 'subagent' || value.parentSession !== undefined || (Number.isFinite(depth) && depth > 0)
}

/** 标题是否已带 TODO 前缀。 */
export function hasTodoPrefix(title) {
  return PREFIX.test(String(title ?? ''))
}

/** 给标题加 TODO 前缀；空标题回退，已带前缀时保持幂等。 */
export function withTodoPrefix(title) {
  const value = String(title ?? '').trim() || '未命名会话'
  return hasTodoPrefix(value) ? value : `TODO：${value}`
}

/** 只去掉开头一个 TODO 前缀，其他内容保持不变。 */
export function stripTodoPrefix(title) {
  return String(title ?? '').replace(PREFIX, '')
}
