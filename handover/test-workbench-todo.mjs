import assert from 'node:assert/strict'
import { hasTodoPrefix, hasUserActionMarker, stripTodoPrefix, withTodoPrefix } from '../lib/todo.js'

assert.equal(hasUserActionMarker('请确认\n<!-- dsh:user-action -->'), true)
assert.equal(hasUserActionMarker('正文提及 <!-- dsh:user-action --> 但在中间'), false)
assert.equal(hasUserActionMarker('```html\n<!-- dsh:user-action -->\n```'), false)
assert.equal(hasTodoPrefix('TODO：修复登录'), true)
assert.equal(hasTodoPrefix('TODO: 修复登录'), true)
assert.equal(hasTodoPrefix('修复登录'), false)
assert.equal(withTodoPrefix('修复登录'), 'TODO：修复登录')
assert.equal(withTodoPrefix('TODO：修复登录'), 'TODO：修复登录')
assert.equal(withTodoPrefix('TODO: 修复登录'), 'TODO: 修复登录')
assert.equal(withTodoPrefix(''), 'TODO：未命名会话')
assert.equal(stripTodoPrefix('TODO：修复登录'), '修复登录')
assert.equal(stripTodoPrefix('TODO: 修复登录'), '修复登录')
assert.equal(stripTodoPrefix('修复登录'), '修复登录')
console.log('test-workbench-todo: ok')
