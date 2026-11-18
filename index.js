/**
 * Host 端：DSH 统一工作台。
 *
 * 读取 DSH workspaceRegistry、SA 工单库/git 对象和 Markdown，通过
 * `GET /dsh-workbench/api` 交给浏览器端渲染；SA 管理操作统一代理到
 * `/orchestrator/api/*`。唯一写操作是 SA 管理 API 代理和 60 天清理台账，
 * 不直接写 SA SQLite，也不删除 session 日志。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { branchDiff, fileAt, findTicketDoc, headInfo, looksLikeRepo, syncRemote } from './lib/gitdata.js'
import { archivedFilter, listParams, paginate, sortBy, timeValue } from './lib/list.js'
import { firstHeading, markdownBlocks, splitPatch, withParts } from './lib/markdown.js'
import { allowedSaRequest, proxySa } from './lib/sa.js'
import { docsIndex, findRepo, loadRepos, repoBlob, repoSessionPage, repoTree, reposOverview } from './lib/repos.js'
import { loadTickets } from './lib/tickets.js'
import { retentionFile, retentionSnapshot, runCleanup } from './lib/retention.js'
import { sessionsPage, workspaceRepos, workspacesOverview } from './lib/workspaces.js'
import { createTitleCache } from './lib/title-cache.js'
import { hasTodoPrefix, hasUserActionMarker, isSubagentMeta, USER_ACTION_MARKER, withTodoPrefix } from './lib/todo.js'

export const name = 'dsh-workbench'
/** webServer 提供路由，connection 提供 Host / Origin 校验与浏览器鉴权。 */
export const inject = ['webServer', 'connection']

const DEFAULT_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

export const Config = z.object({
  dshHome: z.string().default(DEFAULT_HOME).description('DSH 主目录；默认状态目录与清理台账都在其下。'),
  stateDir: z.string().default(join(DEFAULT_HOME, 'state', 'superagent')).description('SA 状态目录，存放 orchestrator.sqlite。'),
  repoDir: z.string().default(join(homedir(), 'src', 'dshSuperagentRepo')).description('SA 交付仓库的本地克隆；只读 git 对象。'),
  baseRef: z.string().default('origin/main').description('对比交付分支的基线引用。'),
  cacheSeconds: z.number().default(10).description('快照缓存秒数。'),
  fetchMinutes: z.number().default(10).description('SA 交付仓库后台 git fetch 间隔（分钟），0 表示不同步。'),
  repos: z.array(z.object({
    id: z.string(),
    name: z.string().default(''),
    path: z.string(),
    mode: z.union([z.const('git'), z.const('worktree')]).default('worktree'),
    ref: z.string().default(''),
    description: z.string().default(''),
    remote: z.string().default(''),
    exclude: z.array(z.string()).default([]),
  })).default([]).description('DSH 级仓库清单；未配置时自动使用 workspaceRegistry 中的工作区路径。'),
  retentionDays: z.number().default(60).description('归档后保留天数。'),
  retentionAutoCleanup: z.boolean().default(true).description('是否每天自动执行一次符合全部安全条件的清理。'),
  retentionCheckMinutes: z.number().default(60).description('自动清理检查间隔（分钟）。'),
  retentionFile: z.string().default('').description('清理台账路径；留空为 ~/.dsh/state/workbench/retention.json。'),
  saApiBase: z.string().default('').description('SA 管理 API 基地址；留空使用当前 DSH Host 的 127.0.0.1 回环地址。'),
})

/** 一次快照请求的进程内缓存：key 由请求形状决定。 */
let cache = { key: '', at: 0, value: undefined, pending: undefined }
let syncState = { at: '', ok: undefined, message: '尚未同步' }
/** 同一 Host 进程内复用标题缓存；文件路径变化（dshHome 不同）时另建实例。 */
const titleCaches = new Map()

function titleCacheOf(ctx, config) {
  const key = config.titleFile || `${config.dshHome || DEFAULT_HOME}`
  if (!titleCaches.has(key)) {
    titleCaches.set(key, createTitleCache(config, {
      warn: message => { if (ctx && ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message); else console.warn(message) },
    }))
  }
  return titleCaches.get(key)
}

/** 从 assistant 消息的 content 中提取可见文本。 */
function assistantText(message) {
  const content = Array.isArray(message && message.content) ? message.content : []
  return content.filter(block => block && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}

function titleOf(snapshot) {
  if (typeof snapshot === 'string') return snapshot
  return String(snapshot && snapshot.title || '')
}

function dbPathOf(config) {
  const stateDir = config.stateDir || join(config.dshHome || DEFAULT_HOME, 'state', 'superagent')
  return join(stateDir, 'orchestrator.sqlite')
}

/** 工单库版本；不阻塞展示。 */
function schemaVersion(dbPath, DatabaseSync) {
  if (!DatabaseSync) return undefined
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 3000 })
    try {
      const row = db.prepare("select value from kv where key like '%schema%'").get()
      return row ? Number(JSON.parse(String(row.value))) : undefined
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

async function buildDoc(repoDir, ticket) {
  if (!looksLikeRepo(repoDir)) return undefined
  const path = await findTicketDoc(repoDir, ticket.id)
  if (!path) return undefined
  const raw = await fileAt(repoDir, path)
  if (raw === undefined) return undefined
  return { path, title: firstHeading(raw), blocks: withParts(markdownBlocks(raw)) }
}

async function buildDiff(repoDir, ticket, withPatch) {
  if (!looksLikeRepo(repoDir) || !ticket.branch) return { exists: false, files: [], stat: '', patch: [] }
  const diff = await branchDiff(repoDir, ticket.branch)
  if (!diff.exists) return { exists: false, files: [], stat: '', patch: [] }
  return {
    exists: true,
    ref: diff.ref,
    files: diff.files,
    stat: diff.stat,
    patch: withPatch ? splitPatch(diff.patch) : [],
    patchBytes: diff.patch.length,
  }
}

/** 组装工单快照；`?ticket=` 只组装详情。列表只对当前页查 git 文档。 */
async function buildSnapshot(config, ticketId, params, DatabaseSync) {
  const query = params || new URLSearchParams()
  const dbPath = dbPathOf(config)
  const repoDir = config.repoDir
  const repo = { dir: repoDir, ok: looksLikeRepo(repoDir), baseRef: config.baseRef, sync: syncState }
  if (repo.ok) Object.assign(repo, await headInfo(repoDir))

  const { tickets, error } = await loadTickets(dbPath)
  const base = {
    generatedAt: new Date().toISOString(),
    db: { path: dbPath, ok: !error, error, schema: error ? undefined : schemaVersion(dbPath, DatabaseSync) },
    repo,
    counts: {
      all: tickets.length,
      live: tickets.filter(ticket => ticket.live).length,
      merged: tickets.filter(ticket => ticket.outcome === 'merged').length,
    },
  }

  if (ticketId) {
    const ticket = tickets.find(item => item.id === ticketId || item.id.startsWith(ticketId))
    if (!ticket) return { ...base, error: `找不到工单：${ticketId}` }
    const [doc, diff] = await Promise.all([buildDoc(repoDir, ticket), buildDiff(repoDir, ticket, true)])
    return { ...base, ticket: { ...ticket, doc, diff } }
  }

  const filter = query.get('filter') === 'all' ? 'all' : 'live'
  const filtered = filter === 'live' ? tickets.filter(ticket => ticket.live) : tickets
  const sort = query.get('sort') === 'updatedAt' ? 'updatedAt' : 'createdAt'
  const dir = query.get('dir') === 'asc' ? 'asc' : 'desc'
  const ordered = sortBy(filtered, sort, dir, (ticket, field) => timeValue(ticket[field]), ticket => ticket.id)
  const page = paginate(ordered, { offset: Math.max(0, Number(query.get('offset')) || 0), limit: Math.max(1, Math.min(Number(query.get('limit')) || 10, 50)) })
  // 列表渲染只使用当前页的文档标题；不再为整库逐条 buildDiff。
  const withDocs = await Promise.all(page.items.map(async ticket => {
    const doc = await buildDoc(repoDir, ticket)
    return { ...ticket, reports: ticket.reports.length, doc: doc ? { path: doc.path, title: doc.title } : undefined }
  }))
  return { ...base, tickets: withDocs, total: page.total, offset: page.offset, limit: page.limit, hasMore: page.hasMore, filter, sort, dir }
}

/** 文档、代码、工作区、保留策略等读请求共用的调度入口。 */
async function buildView(ctx, config, params, DatabaseSync) {
  const view = params.get('view') || ''
  if (view === 'workspaces') {
    const page = listParams(params, { defaultLimit: 8, maxLimit: 20, defaultSort: 'updatedAt', allowedSorts: ['updatedAt', 'createdAt', 'title', 'id'], defaultDir: 'desc' })
    return {
      generatedAt: new Date().toISOString(),
      ...(await workspacesOverview(ctx, {
        ...page,
        archived: archivedFilter(params.get('archived'), 'active'),
        cache: titleCacheOf(ctx, config),
        sessionLimit: Math.max(1, Math.min(Number(params.get('sessionLimit')) || 10, 20)),
      })),
    }
  }
  if (view === 'sessions') {
    const page = listParams(params, { defaultLimit: 10, maxLimit: 50, defaultSort: 'createdAt', allowedSorts: ['createdAt', 'id', 'title', 'kind'], defaultDir: 'desc' })
    return {
      generatedAt: new Date().toISOString(),
      ...(await sessionsPage(ctx, {
        ...page,
        workspace: params.get('workspace') || 'ungrouped',
        archived: archivedFilter(params.get('archived'), 'active'),
        cache: titleCacheOf(ctx, config),
      })),
    }
  }
  if (view === 'retention') {
    const { tickets, error } = await loadTickets(dbPathOf(config))
    if (error) return { error }
    return { generatedAt: new Date().toISOString(), ...(await retentionSnapshot(config, tickets, ctx.get('workspaceRegistry'))) }
  }
  if (view === 'docRepos') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    const page = listParams(params, { defaultLimit: 12, maxLimit: 50, defaultSort: 'name', allowedSorts: ['name', 'id', 'source'], defaultDir: 'asc' })
    const ordered = sortBy(repos, page.sort, page.dir, (repo, field) => field === 'name' ? repo.name : field === 'source' ? repo.source : repo.id, repo => repo.id)
    const result = paginate(ordered, page)
    return {
      generatedAt: new Date().toISOString(),
      repos: result.items.map(repo => ({ id: repo.id, name: repo.name, description: repo.description, source: repo.source })),
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      hasMore: result.hasMore,
      sort: page.sort,
      dir: page.dir,
    }
  }
  if (view === 'docs') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    return {
      generatedAt: new Date().toISOString(),
      groups: await docsIndex(repos, params.get('repo') || ''),
    }
  }
  if (view === 'repos') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    const page = listParams(params, { defaultLimit: 4, maxLimit: 50, defaultSort: 'updatedAt', allowedSorts: ['updatedAt', 'name', 'id', 'source'], defaultDir: 'desc' })
    // 仓库更新时间取最新提交时间（非 git 目录回退到 mtime），先对全量排序再分页。
    const overview = await reposOverview(repos)
    const ordered = sortBy(overview, page.sort, page.dir, (repo, field) => {
      if (field === 'updatedAt') return timeValue(repo.updatedAt)
      if (field === 'name') return repo.name
      if (field === 'source') return repo.source
      return repo.id
    }, repo => repo.id)
    const result = paginate(ordered, page)
    return {
      generatedAt: new Date().toISOString(),
      repos: result.items,
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      hasMore: result.hasMore,
      sort: page.sort,
      dir: page.dir,
    }
  }
  if (view === 'repoSessions') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    const repo = findRepo(repos, params.get('repo') || '')
    if (!repo) return { error: `找不到仓库：${params.get('repo') || ''}` }
    const page = listParams(params, { defaultLimit: 10, maxLimit: 50, defaultSort: 'createdAt', allowedSorts: ['createdAt', 'id', 'title', 'kind'], defaultDir: 'desc' })
    return {
      generatedAt: new Date().toISOString(),
      ...(await repoSessionPage(ctx, repo, {
        ...page,
        archived: archivedFilter(params.get('archived'), 'active'),
      }, titleCacheOf(ctx, config))),
    }
  }
  if (view === 'tree' || view === 'blob') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    const repo = findRepo(repos, params.get('repo') || '')
    if (!repo) return { error: `找不到仓库：${params.get('repo') || ''}` }
    if (!looksLikeRepo(repo.path) && repo.mode === 'git') return { error: `仓库不可用：${repo.path}` }
    const treePage = listParams(params, { defaultLimit: 50, maxLimit: 50, defaultSort: 'name', allowedSorts: ['name'], defaultDir: 'asc' })
    const result = view === 'tree'
      ? await repoTree(repo, params.get('path') || '', treePage)
      : await repoBlob(repo, params.get('path') || '')
    return {
      generatedAt: new Date().toISOString(),
      repo: { id: repo.id, name: repo.name, description: repo.description, mode: repo.mode, ref: repo.ref },
      ...result,
    }
  }
  return { error: `未知视图：${view}` }
}

function cached(key, ttlSeconds, build) {
  const now = Date.now()
  const fresh = cache.value && cache.key === key && now - cache.at < ttlSeconds * 1000
  if (fresh) return Promise.resolve(cache.value)
  if (cache.pending && cache.key === key) return cache.pending
  cache.key = key
  cache.pending = build()
    .then(value => {
      cache = { key, at: Date.now(), value, pending: undefined }
      return value
    })
    .catch(error => {
      cache.pending = undefined
      throw error
    })
  return cache.pending
}

function cachedSnapshot(config, ticketId, params, DatabaseSync) {
  return cached(`ticket:${ticketId || ''}:${params ? params.toString() : ''}`, config.cacheSeconds, () => buildSnapshot(config, ticketId, params, DatabaseSync))
}

function cachedView(ctx, config, params, DatabaseSync) {
  return cached(`view:${params.toString()}`, config.cacheSeconds, () => buildView(ctx, config, params, DatabaseSync))
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new Error(`请求体超过 ${maxBytes} 字节`)
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** 诊断告警去重：同一会话同一原因只记录一次，避免每个 turn 刷屏。 */
const warnedReasons = new Set()

function warnOnce(ctx, reason, sessionId, text) {
  const key = `${reason}:${sessionId}`
  if (warnedReasons.has(key)) return
  if (warnedReasons.size >= 500) warnedReasons.clear()
  warnedReasons.add(key)
  if (ctx && ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(text, sessionId)
}

/** 处理 assistant/message：命中末尾标记时把当前会话标题改为 TODO 前缀。 */
export async function onAssistantMessage(ctx, config, session, event) {
  const sessionId = String((session && session.id) || '')
  try {
    if (!event || event.type !== 'assistant/message' || isSubagentMeta((session && (session.header || session.meta)) || {})) return false
    if (!hasUserActionMarker(assistantText(event.data && event.data.message))) return false
    const sessionTitle = ctx.get('sessionTitle')
    if (!sessionTitle || typeof sessionTitle.get !== 'function' || typeof sessionTitle.rename !== 'function') {
      warnOnce(ctx, 'sessionTitle-unavailable', sessionId, 'dsh-workbench: 命中 TODO 标记但 sessionTitle 不可用，未改名 session=%s')
      return false
    }
    const current = titleOf(sessionTitle.get(session))
    if (!current) {
      warnOnce(ctx, 'title-empty', sessionId, 'dsh-workbench: 命中 TODO 标记但当前标题为空，未改名 session=%s')
      return false
    }
    const next = withTodoPrefix(current)
    if (next === current) return false
    await sessionTitle.rename(session, next)
    await titleCacheOf(ctx, config).put([{ id: String(session.id), title: next, kind: 'session', cwd: String(session.header && session.header.cwd || '') }])
    return true
  } catch (error) {
    ctx.logger.warn('dsh-workbench: 更新 TODO 标题失败 session=%s %s', sessionId, error)
    return false
  }
}

/** 只读查询会话当前标题，供客户端 `/ok` 做命令前校验。 */
export function todoStateOf(ctx, sessionId) {
  const id = String(sessionId || '').trim()
  if (!id) return { status: 400, body: { error: '缺少 sessionId' } }
  const sessions = ctx.get('sessions')
  const session = sessions && typeof sessions.get === 'function' ? sessions.get(id) : undefined
  if (!session) return { status: 404, body: { error: '会话不存在或未加载', sessionId: id } }
  const sessionTitle = ctx.get('sessionTitle')
  if (!sessionTitle || typeof sessionTitle.get !== 'function') return { status: 503, body: { error: 'sessionTitle 不可用' } }
  const title = titleOf(sessionTitle.get(session))
  return { status: 200, body: { ok: true, sessionId: id, title, hasTodo: hasTodoPrefix(title) } }
}

/** 注册 `/dsh-workbench/api` 与 `/dsh-workbench/api/sa`。 */
function serveRoute(ctx, config) {
  const rejection = req => (ctx.connection.requestRejection ? ctx.connection.requestRejection({ headers: req.headers }) : undefined)
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const refusal = rejection(req)
    if (refusal !== undefined) {
      res.writeHead(refusal, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(refusal === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if (url.pathname === '/dsh-workbench/api/archive') {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      try {
        const body = await readJsonBody(req)
        const sessionId = String(body.sessionId || '').trim()
        if (!sessionId) return json(res, 400, { error: '缺少 sessionId' })
        const registry = ctx.get('workspaceRegistry')
        if (!registry || typeof registry.archiveSession !== 'function') return json(res, 503, { error: 'workspaceRegistry 不可用' })
        const archived = Array.isArray(registry.archivedSessionIds) && registry.archivedSessionIds.includes(sessionId)
        if (!archived) await registry.archiveSession(sessionId, { stopActivity: true })
        return json(res, 200, { ok: true, archived: true, sessionId })
      } catch (error) {
        return json(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    }
    if (url.pathname === '/dsh-workbench/api/sa') {
      await proxySa(ctx, config, req, res, url)
      return
    }
    if (url.pathname !== '/dsh-workbench/api') {
      json(res, 404, { error: '未知路由' })
      return
    }

    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        if (body.action === 'dry-run') {
          const { tickets, error } = await loadTickets(dbPathOf(config))
          if (error) return json(res, 500, { error })
          const value = await runCleanup(ctx, config, tickets, { dryRun: true, trigger: 'manual' })
          return json(res, 200, value)
        }
        if (body.action === 'cleanup') {
          const { tickets, error } = await loadTickets(dbPathOf(config))
          if (error) return json(res, 500, { error })
          const value = await runCleanup(ctx, config, tickets, { dryRun: false, trigger: 'manual' })
          return json(res, 200, value)
        }
        if (body.action === 'settings') {
          const { loadRetention, saveRetention } = await import('./lib/retention.js')
          const manifest = await loadRetention(config)
          if (body.days !== undefined) manifest.settings.days = Math.max(1, Number(body.days) || 60)
          if (body.autoCleanup !== undefined) manifest.settings.autoCleanup = Boolean(body.autoCleanup)
          await saveRetention(config, manifest)
          const { tickets, error } = await loadTickets(dbPathOf(config))
          if (error) return json(res, 500, { error })
          return json(res, 200, await retentionSnapshot(config, tickets, ctx.get('workspaceRegistry')))
        }
        return json(res, 400, { error: '未知操作' })
      } catch (error) {
        return json(res, 400, { error: String(error && error.message ? error.message : error) })
      }
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET, POST' })
      res.end()
      return
    }
    try {
      if ((url.searchParams.get('action') || '') === 'todoState') {
        const state = todoStateOf(ctx, url.searchParams.get('sessionId'))
        return json(res, state.status, state.body)
      }
      const view = url.searchParams.get('view') || ''
      const value = view
        ? await cachedView(ctx, config, url.searchParams, ctx.get('node:sqlite')?.DatabaseSync)
        : await cachedSnapshot(config, url.searchParams.get('ticket') || '', url.searchParams, ctx.get('node:sqlite')?.DatabaseSync)
      const failed = value && value.error && !value.tickets && !value.ticket && !value.groups && !value.repos && !value.entries && !value.path && !value.workspaces && !value.sessions && !value.candidates && !value.repo
      json(res, failed ? 400 : 200, value)
    } catch (error) {
      json(res, 500, { error: String(error && error.message ? error.message : error) })
    }
  }
}

export function apply(ctx, config) {
  const route = {
    kind: 'prefix',
    path: '/dsh-workbench/api',
    handler: serveRoute(ctx, config),
  }
  ctx.effect(() => ctx.webServer.register(route), 'dsh-workbench: api route')

  // systemPrompt 与 sessionTitle 都可能晚于本插件 apply() 就绪，用 ctx.inject 等依赖到位再挂载，
  // 避免一次性 ctx.get() 拿不到就永久跳过（见 PLAN-todo-title-listener-fix.md）。
  // 用 required runtime context 而不是 prompt section：minimal 等预设的 persona 是 complete section，
  // 会把所有普通 section 合并结果替换掉；required context 仍会进入模型上下文，TODO 标记才能跨预设生效。
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.effect(() => promptCtx.systemPrompt.context({
      name: 'dsh-workbench-user-action',
      order: 130,
      required: true,
      interpolate: false,
      text: () => `仅当这一回合结束时用户必须执行下一步操作、确认或运行命令，才在最后一条助手消息末尾另起一行输出隐藏标记（下面引号内为两个 U+2063 INVISIBLE SEPARATOR 不可见字符，直接复制，不要改成可见文字）：“${USER_ACTION_MARKER}”；其他情况禁止输出。禁止输出 HTML 注释，禁止在正文、代码块、引用或说明中提及、引用或解释该标记。历史消息中如出现旧版 HTML 注释式标记，一律视为过时格式，禁止模仿、复制或再输出；只使用本节给出的不可见字符。`,
    }), 'dsh-workbench: user action context')
  })

  ctx.inject(['sessionTitle'], titleCtx => {
    titleCtx.logger.info('dsh-workbench: sessionTitle 就绪，TODO 标题监听已挂载')
    // 监听注册在 titleCtx 上，随该 fiber 释放而释放，热重载不会重复监听。
    titleCtx.on('session/event', (session, event) => {
      void onAssistantMessage(titleCtx, config, session, event)
    })
  })

  const minutes = Number(config.fetchMinutes) || 0
  if (minutes > 0 && looksLikeRepo(config.repoDir)) {
    const sync = async () => {
      syncState = await syncRemote(config.repoDir)
      ctx.logger.info('dsh-workbench: fetch %s %s', config.repoDir, syncState.ok ? '完成' : `失败 ${syncState.message}`)
      cache = { key: '', at: 0, value: undefined, pending: undefined }
    }
    ctx.effect(() => {
      const timer = setInterval(() => { void sync() }, minutes * 60 * 1000)
      timer.unref?.()
      return () => clearInterval(timer)
    }, 'dsh-workbench: fetch loop')
    queueMicrotask(() => { void sync() })
  } else if (!looksLikeRepo(config.repoDir)) {
    ctx.logger.warn('dsh-workbench: SA 交付仓库不存在或不是 git 仓库：%s', config.repoDir)
  }

  const checkMinutes = Math.max(5, Number(config.retentionCheckMinutes) || 60)
  ctx.effect(() => {
    const timer = setInterval(() => {
      void (async () => {
        const snapshot = await retentionSnapshot(config, (await loadTickets(dbPathOf(config))).tickets, ctx.get('workspaceRegistry'))
        if (!snapshot.settings.autoCleanup) return
        const due = !snapshot.lastRun || Date.now() - Date.parse(snapshot.lastRun) >= 86_400_000
        if (!due || snapshot.eligible.length === 0) return
        const result = await runCleanup(ctx, config, (await loadTickets(dbPathOf(config))).tickets, { dryRun: false, trigger: 'auto' })
        ctx.logger.info('dsh-workbench: 自动清理完成 cleaned=%s', result.lastResult?.cleaned ?? 0)
      })().catch(error => ctx.logger.warn('dsh-workbench: 自动清理失败 %s', error))
    }, checkMinutes * 60 * 1000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'dsh-workbench: retention loop')

  ctx.logger.info('dsh-workbench ready: db=%s repo=%s retention=%s', dbPathOf(config), config.repoDir, retentionFile(config))
}
