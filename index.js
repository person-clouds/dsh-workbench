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
import { firstHeading, markdownBlocks, splitPatch, withParts } from './lib/markdown.js'
import { allowedSaRequest, proxySa } from './lib/sa.js'
import { docsIndex, findRepo, loadRepos, repoBlob, repoTree, reposOverview } from './lib/repos.js'
import { loadTickets } from './lib/tickets.js'
import { retentionFile, retentionSnapshot, runCleanup } from './lib/retention.js'
import { workspaceRepos, workspacesOverview } from './lib/workspaces.js'

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

/** 组装工单快照；`?ticket=` 只组装详情。 */
async function buildSnapshot(config, ticketId, DatabaseSync) {
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

  const withDocs = await Promise.all(tickets.map(async ticket => {
    const [doc, diff] = await Promise.all([buildDoc(repoDir, ticket), buildDiff(repoDir, ticket, false)])
    return { ...ticket, reports: ticket.reports.length, doc: doc ? { path: doc.path, title: doc.title } : undefined, diff: diff.exists ? diff : undefined }
  }))
  return { ...base, tickets: withDocs }
}

/** 文档、代码、工作区、保留策略等读请求共用的调度入口。 */
async function buildView(ctx, config, params, DatabaseSync) {
  const view = params.get('view') || ''
  if (view === 'workspaces') {
    return { generatedAt: new Date().toISOString(), ...(await workspacesOverview(ctx)) }
  }
  if (view === 'retention') {
    const { tickets, error } = await loadTickets(dbPathOf(config))
    if (error) return { error }
    return { generatedAt: new Date().toISOString(), ...(await retentionSnapshot(config, tickets, ctx.get('workspaceRegistry'))) }
  }
  if (view === 'docs') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    return { generatedAt: new Date().toISOString(), groups: await docsIndex(repos) }
  }
  if (view === 'repos') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    return { generatedAt: new Date().toISOString(), repos: await reposOverview(repos) }
  }
  if (view === 'tree' || view === 'blob') {
    const repos = await loadRepos(config, workspaceRepos(ctx))
    const repo = findRepo(repos, params.get('repo') || '')
    if (!repo) return { error: `找不到仓库：${params.get('repo') || ''}` }
    if (!looksLikeRepo(repo.path) && repo.mode === 'git') return { error: `仓库不可用：${repo.path}` }
    const result = view === 'tree'
      ? await repoTree(repo, params.get('path') || '')
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

function cachedSnapshot(config, ticketId, DatabaseSync) {
  return cached(`ticket:${ticketId || ''}`, config.cacheSeconds, () => buildSnapshot(config, ticketId, DatabaseSync))
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
      const view = url.searchParams.get('view') || ''
      const value = view
        ? await cachedView(ctx, config, url.searchParams, ctx.get('node:sqlite')?.DatabaseSync)
        : await cachedSnapshot(config, url.searchParams.get('ticket') || '', ctx.get('node:sqlite')?.DatabaseSync)
      const failed = value && value.error && !value.tickets && !value.ticket && !value.groups && !value.repos && !value.entries && !value.path && !value.workspaces && !value.candidates
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
