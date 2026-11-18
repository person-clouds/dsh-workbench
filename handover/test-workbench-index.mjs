import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { onAssistantMessage, todoStateOf } from '../index.js'
import { USER_ACTION_MARKER } from '../lib/todo.js'

function fixture(options = {}) {
  const calls = []
  let current = options.title ?? '修复登录'
  const session = {
    id: 's1',
    header: { cwd: '/tmp/ws', origin: options.origin, delegationDepth: options.delegationDepth },
    meta: {},
  }
  const sessionTitle = {
    get: value => ({ title: value === session ? current : '' }),
    rename: async (value, title) => {
      assert.equal(value, session)
      calls.push(title)
      current = title
    },
  }
  const sessions = {
    get: id => id === session.id ? session : undefined,
  }
  const ctx = {
    logger: { warn() {} },
    get: name => ({ sessions, sessionTitle })[name],
  }
  return { ctx, session, calls, title: () => current }
}

function message(text) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

test('末尾隐藏标记触发 TODO 标题且已带前缀时不重复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const { ctx, session, calls } = fixture()
    assert.equal(await onAssistantMessage(ctx, { titleFile: join(dir, 'titles.json') }, session, message(`请确认\n${USER_ACTION_MARKER}`)), true)
    assert.deepEqual(calls, ['TODO：修复登录'])
    assert.equal(await onAssistantMessage(ctx, { titleFile: join(dir, 'titles.json') }, session, message(`再次确认\n${USER_ACTION_MARKER}`)), false)
    assert.deepEqual(calls, ['TODO：修复登录'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('标记在中间、代码块或 reasoning 中不触发', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const { ctx, session, calls } = fixture()
    const config = { titleFile: join(dir, 'titles.json') }
    assert.equal(await onAssistantMessage(ctx, config, session, message('正文提及 <!-- dsh:user-action --> 但在中间')), false)
    assert.equal(await onAssistantMessage(ctx, config, session, message('```html\n<!-- dsh:user-action -->\n```')), false)
    assert.equal(await onAssistantMessage(ctx, config, session, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'reasoning', text: '<!-- dsh:user-action -->' }] } },
    }), false)
    assert.deepEqual(calls, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('主会话 delegationDepth 0 可触发，subagent 不触发', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const main = fixture({ delegationDepth: 0 })
    assert.equal(await onAssistantMessage(main.ctx, { titleFile: join(dir, 'titles.json') }, main.session, message(`需要确认\n${USER_ACTION_MARKER}`)), true)
    assert.deepEqual(main.calls, ['TODO：修复登录'])

    const sub = fixture({ delegationDepth: 1 })
    assert.equal(await onAssistantMessage(sub.ctx, { titleFile: join(dir, 'titles.json') }, sub.session, message(`需要确认\n${USER_ACTION_MARKER}`)), false)
    assert.deepEqual(sub.calls, [])

    const origin = fixture({ origin: 'subagent' })
    assert.equal(await onAssistantMessage(origin.ctx, { titleFile: join(dir, 'titles.json') }, origin.session, message(`需要确认\n${USER_ACTION_MARKER}`)), false)
    assert.deepEqual(origin.calls, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('todoState 返回当前标题与 TODO 状态', () => {
  const { ctx } = fixture({ title: 'TODO：修复登录' })
  assert.deepEqual(todoStateOf(ctx, 's1'), {
    status: 200,
    body: { ok: true, sessionId: 's1', title: 'TODO：修复登录', hasTodo: true },
  })
  assert.deepEqual(todoStateOf(ctx, ''), { status: 400, body: { error: '缺少 sessionId' } })
  assert.deepEqual(todoStateOf(ctx, 'missing'), { status: 404, body: { error: '会话不存在或未加载', sessionId: 'missing' } })
})
