import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, onAssistantMessage, todoStateOf } from '../index.js'
import { USER_ACTION_MARKER } from '../lib/todo.js'

function fixture(options = {}) {
  const calls = []
  const warnings = []
  let current = options.title ?? '修复登录'
  const session = {
    id: options.id ?? 's1',
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
    logger: { warn: (...args) => warnings.push(args) },
    get: name => (options.noTitleService ? { sessions } : { sessions, sessionTitle })[name],
  }
  return { ctx, session, calls, warnings, title: () => current }
}

function message(text) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

/** 模拟插件上下文：记录 inject 回调、effect、事件监听，服务初始都不可用。 */
function applyFixture() {
  const injections = new Map()
  const listeners = []
  const infos = []
  const warnings = []
  const ctx = {
    logger: { info: message => infos.push(message), warn: message => warnings.push(message) },
    get: () => undefined,
    effect: fn => {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on: (event, handler) => listeners.push({ event, handler }),
    webServer: { register: () => () => {} },
    connection: {},
    inject: (names, callback) => {
      injections.set(names.join(','), callback)
      return Promise.resolve()
    },
  }
  return { ctx, injections, listeners, infos, warnings }
}

/** systemPrompt service 晚到后注入回调用的子上下文。 */
function promptChild(registrations) {
  return {
    systemPrompt: {
      section: options => { registrations.sections.push(options); return () => {} },
      context: options => { registrations.contexts.push(options); return () => {} },
    },
    effect: fn => fn(),
  }
}

test('systemPrompt 与 sessionTitle 晚到时就绪后挂载监听与提示词', () => {
  const { ctx, injections, infos } = applyFixture()
  apply(ctx, { repoDir: '/nonexistent/repo', fetchMinutes: 0, retentionCheckMinutes: 60 })

  assert.ok(injections.has('systemPrompt'))
  assert.ok(injections.has('sessionTitle'))

  const registrations = { sections: [], contexts: [] }
  injections.get('systemPrompt')(promptChild(registrations))
  assert.equal(registrations.sections.length, 0)
  assert.equal(registrations.contexts.length, 1)
  assert.equal(registrations.contexts[0].name, 'dsh-workbench-user-action')
  assert.equal(registrations.contexts[0].required, true)

  const events = []
  const titleCtx = {
    logger: { info: message => infos.push(message) },
    on: (event, handler) => events.push({ event, handler }),
  }
  injections.get('sessionTitle')(titleCtx)
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'session/event')
  assert.ok(infos.some(message => String(message).includes('TODO 标题监听已挂载')))
})

test('晚挂载的 session/event 监听仍能改名标题', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const { ctx, injections } = applyFixture()
    apply(ctx, { repoDir: '/nonexistent/repo', fetchMinutes: 0, retentionCheckMinutes: 60, titleFile: join(dir, 'titles.json') })

    const calls = []
    const session = { id: 'mounted', header: { cwd: '/tmp/ws', delegationDepth: 0 }, meta: {} }
    let current = '晚挂载'
    const titleCtx = {
      logger: { info() {} },
      get: name => name === 'sessionTitle' ? {
        get: value => ({ title: value === session ? current : '' }),
        rename: async (value, title) => { calls.push(title); current = title },
      } : undefined,
      on: (event, handler) => { if (event === 'session/event') handler(session, message(`请确认\n${USER_ACTION_MARKER}`)) },
    }
    injections.get('sessionTitle')(titleCtx)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, ['TODO：晚挂载'])
    // 监听是 fire-and-forget，等标题缓存落盘后再清理临时目录。
    await new Promise(resolve => setTimeout(resolve, 100))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('命中标记但 sessionTitle 不可用告警一次并返回 false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const { ctx, session, warnings } = fixture({ id: 'no-service', noTitleService: true })
    const config = { titleFile: join(dir, 'titles.json') }
    assert.equal(await onAssistantMessage(ctx, config, session, message(`请确认\n${USER_ACTION_MARKER}`)), false)
    assert.equal(await onAssistantMessage(ctx, config, session, message(`请确认\n${USER_ACTION_MARKER}`)), false)
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0][0]), /sessionTitle 不可用/)
    assert.equal(warnings[0][1], 'no-service')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('命中标记但标题为空告警并返回 false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const { ctx, session, calls, warnings } = fixture({ id: 'empty-title', title: '' })
    assert.equal(await onAssistantMessage(ctx, { titleFile: join(dir, 'titles.json') }, session, message(`请确认\n${USER_ACTION_MARKER}`)), false)
    assert.deepEqual(calls, [])
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0][0]), /标题为空/)
    assert.equal(warnings[0][1], 'empty-title')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('旧 HTML 注释标记仍能触发标题改名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const { ctx, session, calls } = fixture({ id: 'legacy-marker' })
    assert.equal(await onAssistantMessage(ctx, { titleFile: join(dir, 'titles.json') }, session, message('请确认\n<!-- dsh:user-action -->')), true)
    assert.deepEqual(calls, ['TODO：修复登录'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('提示词包含压制旧标记的约束且不复述完整旧标记', () => {
  const { ctx, injections } = applyFixture()
  apply(ctx, { repoDir: '/nonexistent/repo', fetchMinutes: 0, retentionCheckMinutes: 60 })
  const registrations = { sections: [], contexts: [] }
  injections.get('systemPrompt')(promptChild(registrations))
  const text = registrations.contexts[0].text()
  assert.ok(text.includes('历史消息'))
  assert.ok(text.includes('禁止模仿'))
  assert.ok(text.includes('只使用本节给出的不可见字符'))
  assert.ok(!text.includes('<!--'))
  assert.ok(!text.includes('dsh:user-action'))
})

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
    const { ctx, session, calls } = fixture({ id: 'mid-marker' })
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
    const main = fixture({ id: 'main-depth-0', delegationDepth: 0 })
    assert.equal(await onAssistantMessage(main.ctx, { titleFile: join(dir, 'titles.json') }, main.session, message(`需要确认\n${USER_ACTION_MARKER}`)), true)
    assert.deepEqual(main.calls, ['TODO：修复登录'])

    const sub = fixture({ id: 'sub-depth-1', delegationDepth: 1 })
    assert.equal(await onAssistantMessage(sub.ctx, { titleFile: join(dir, 'titles.json') }, sub.session, message(`需要确认\n${USER_ACTION_MARKER}`)), false)
    assert.deepEqual(sub.calls, [])

    const origin = fixture({ id: 'sub-origin', origin: 'subagent' })
    assert.equal(await onAssistantMessage(origin.ctx, { titleFile: join(dir, 'titles.json') }, origin.session, message(`需要确认\n${USER_ACTION_MARKER}`)), false)
    assert.deepEqual(origin.calls, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})


test('D/G 命令会话的 TODO 前缀保留命令标识', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-index-'))
  try {
    const d = fixture({ id: 'd-session', title: 'D: 实现登录' })
    assert.equal(await onAssistantMessage(d.ctx, { titleFile: join(dir, 'titles.json') }, d.session, message(`请确认\n${USER_ACTION_MARKER}`)), true)
    assert.deepEqual(d.calls, ['TODO D: 实现登录'])

    const g = fixture({ id: 'g-session', title: 'G：修复登录' })
    assert.equal(await onAssistantMessage(g.ctx, { titleFile: join(dir, 'titles.json') }, g.session, message(`请确认\n${USER_ACTION_MARKER}`)), true)
    assert.deepEqual(g.calls, ['TODO G：修复登录'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('/ok 只清除 TODO 前缀，不归档会话', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(source.includes("text: t(hadTodo ? 'okCleared' : 'okNoTodo')"))
  assert.ok(source.includes('不归档会话'))
  assert.ok(!source.includes('ARCHIVE_DELAY_MS'))
  assert.ok(!source.includes('/api/archive'))
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
