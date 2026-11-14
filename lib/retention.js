/**
 * 60 天保留与清理。
 *
 * 只清理 SA 管理的 worktree 和 DSH workspace 注册；session 日志永不删除。
 * 所有动作先经过多重安全检查，失败就保留现场并写入台账。禁止 rm -rf 兜底。
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rmdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DAY_MS = 86_400_000
const TERMINAL = new Set(['merged', 'closed', 'dropped', 'completed'])

export function defaultRetention(config) {
  return {
    version: 1,
    settings: {
      days: Number(config.retentionDays) || 60,
      autoCleanup: config.retentionAutoCleanup !== false,
    },
    discovered: {},
    ledger: [],
    lastRun: '',
    lastResult: null,
  }
}

export function retentionFile(config) {
  const configured = String(config.retentionFile || '').trim()
  if (configured) return configured
  return join(config.dshHome || join(homedir(), '.dsh'), 'state', 'workbench', 'retention.json')
}

export async function loadRetention(config) {
  const path = retentionFile(config)
  const fallback = defaultRetention(config)
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'))
    return {
      ...fallback,
      ...raw,
      settings: { ...fallback.settings, ...(raw.settings || {}) },
      discovered: raw.discovered && typeof raw.discovered === 'object' ? raw.discovered : {},
      ledger: Array.isArray(raw.ledger) ? raw.ledger.slice(-500) : [],
    }
  } catch {
    return fallback
  }
}

export async function saveRetention(config, manifest) {
  const path = retentionFile(config)
  await mkdir(dirname(path), { recursive: true })
  manifest.ledger = Array.isArray(manifest.ledger) ? manifest.ledger.slice(-500) : []
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/** 只有 SA 约定目录下的 worktree 才允许被清理。 */
export function allowedWorktreeRoots(config) {
  return [
    join(homedir(), 'src', 'dsh-worktrees'),
    join(config.stateDir || join(config.dshHome || join(homedir(), '.dsh'), 'state', 'superagent'), 'work'),
  ].map(path => resolve(path))
}

function within(root, path) {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function isAllowedWorktree(config, path) {
  const target = resolve(path)
  return allowedWorktreeRoots(config).some(root => within(root, target))
}

async function git(cwd, args, timeout = 30_000) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout, windowsHide: true })
  return stdout
}

async function gitStatus(execDir) {
  try {
    const out = await git(execDir, ['status', '--porcelain', '-z'])
    return { ok: true, dirty: out.split('\0').filter(Boolean) }
  } catch (error) {
    return { ok: false, error: textOf(error) }
  }
}

/** 从 worktree 反查主仓库根目录；用于 `git worktree remove`。 */
async function mainRepoOf(execDir) {
  const common = (await git(execDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  return dirname(common)
}

function archiveId(ticket) {
  return `worker-${ticket.id}`
}

/**
 * 判断一张 ticket 是否可清理。任何一项不确定都返回 blocked，不尝试猜测。
 * @param ticket - 工单面板快照。
 * @param registry - DSH workspaceRegistry，可为 undefined（测试 dry-run）。
 */
export async function inspectCandidate(config, ticket, registry, manifest, now = Date.now()) {
  const checks = []
  const block = (reason, detail = '') => checks.push({ ok: false, reason, detail })
  const pass = reason => checks.push({ ok: true, reason })

  const endedAt = ticket.endedAt || ''
  if (!endedAt) {
    const discovered = manifest.discovered[ticket.id]
    if (discovered) pass('结束时间缺失，使用首次发现时间')
    else block('结束时间缺失，等待首次发现记录')
  }
  const basis = endedAt || manifest.discovered[ticket.id]
  const ageDays = basis ? Math.floor((now - Date.parse(basis)) / DAY_MS) : 0
  if (!TERMINAL.has(ticket.outcome)) block('工单未结束或结束方式未知', ticket.outcome)
  else pass('工单已结束')
  if (ticket.live) block('工单仍在执行')
  if (!basis) block('无法计算保留期')
  else if (!(ageDays >= manifest.settings.days)) block(`保留期未满：${ageDays}/${manifest.settings.days} 天`)

  const sessionId = archiveId(ticket)
  const archived = new Set(registry?.archivedSessionIds || [])
  const pinned = new Set(registry?.pinnedSessionIds || [])
  if (archived.has(sessionId)) pass('worker 会话已归档')
  else block('worker 会话尚未归档', sessionId)
  if (pinned.has(sessionId)) block('worker 会话在 pin 列表', sessionId)

  // “分支已合并或明确放弃”：merged 直接通过；closed/dropped 视为明确放弃；
  // completed 但没有 merged 结果时无法确认，交给人工处理。
  if (ticket.outcome === 'merged') pass('交付分支已合入')
  else if (ticket.outcome === 'closed' || ticket.outcome === 'dropped') pass('工单已明确放弃')
  else block('无法确认分支已合并或已放弃', ticket.outcome)

  if (ticket.outcome !== 'merged' && ticket.outcome !== 'closed' && ticket.outcome !== 'dropped' && ticket.prUrls?.length) {
    block('存在未必关闭的 PR', ticket.prUrls.join(' '))
  }

  const execDir = ticket.execDir || ''
  if (!execDir) {
    block('没有 worktree 路径，不可清理目录')
  } else if (!isAllowedWorktree(config, execDir)) {
    block('worktree 不在受控根目录下', execDir)
  } else if (!existsSync(execDir)) {
    pass('worktree 已不存在')
  } else {
    const status = await gitStatus(execDir)
    if (!status.ok) block('无法读取 worktree git 状态', status.error)
    else if (status.dirty.length > 0) block(`worktree 有 ${status.dirty.length} 个未提交改动`)
    else pass('worktree 无未提交改动')
  }

  return {
    id: ticket.id,
    shortId: ticket.shortId,
    title: ticket.title,
    outcome: ticket.outcome,
    endedAt,
    basis: basis || '',
    ageDays,
    workerSessionId: sessionId,
    execDir,
    checks,
    eligible: checks.every(check => check.ok),
  }
}

/** 计算全部候选；不修改磁盘、manifest，只补 discovered 回退时间到返回值。 */
export async function retentionSnapshot(config, tickets, registry) {
  const manifest = await loadRetention(config)
  const now = Date.now()
  let discoveredChanged = false
  for (const ticket of tickets) {
    if (!ticket.endedAt && ticket.outcome && manifest.discovered[ticket.id] === undefined) {
      manifest.discovered[ticket.id] = new Date(now).toISOString()
      discoveredChanged = true
    }
  }
  const candidates = []
  for (const ticket of tickets) candidates.push(await inspectCandidate(config, ticket, registry, manifest, now))
  if (discoveredChanged) await saveRetention(config, manifest)
  return {
    settings: manifest.settings,
    manifestPath: retentionFile(config),
    candidates,
    eligible: candidates.filter(item => item.eligible),
    ledger: manifest.ledger.slice(-50).reverse(),
    lastRun: manifest.lastRun,
    lastResult: manifest.lastResult,
    nextRun: nextRunAt(manifest),
  }
}

function nextRunAt(manifest) {
  if (!manifest.settings.autoCleanup) return ''
  const last = Date.parse(manifest.lastRun || '') || 0
  return new Date(Math.max(Date.now(), last + DAY_MS)).toISOString()
}

async function removeEmptyParents(config, directory) {
  let current = dirname(directory)
  const roots = allowedWorktreeRoots(config)
  while (roots.some(root => within(root, current))) {
    try { await rmdir(current) } catch { break }
    current = dirname(current)
  }
}

/**
 * 执行一轮清理。`dryRun` 只报告；真实清理逐张重复安全检查，失败不删除。
 */
export async function runCleanup(ctx, config, tickets, { dryRun = true, trigger = 'manual' } = {}) {
  const manifest = await loadRetention(config)
  const registry = ctx.get('workspaceRegistry')
  const now = Date.now()
  for (const ticket of tickets) {
    if (!ticket.endedAt && ticket.outcome && manifest.discovered[ticket.id] === undefined) {
      manifest.discovered[ticket.id] = new Date(now).toISOString()
    }
  }
  const results = []
  for (const ticket of tickets) {
    const candidate = await inspectCandidate(config, ticket, registry, manifest, now)
    if (!candidate.eligible) {
      if (!dryRun) results.push({ ...candidate, action: 'skipped' })
      continue
    }
    if (dryRun) {
      results.push({ ...candidate, action: 'dry-run' })
      continue
    }
    const entry = { at: new Date().toISOString(), ticket: ticket.id, shortId: ticket.shortId, dir: ticket.execDir, action: 'cleanup', ok: false, steps: [] }
    try {
      if (ticket.execDir && existsSync(ticket.execDir)) {
        const main = await mainRepoOf(ticket.execDir)
        await git(main, ['worktree', 'remove', ticket.execDir])
        entry.steps.push('git worktree remove')
        await removeEmptyParents(config, ticket.execDir)
        entry.steps.push('删除空父目录')
      }
      if (registry) {
        const target = ticket.execDir ? await realpath(ticket.execDir).catch(() => resolve(ticket.execDir)) : ''
        const workspace = registry.list().find(item => resolve(item.path) === target)
        if (workspace) {
          await registry.delete(workspace.id)
          entry.steps.push('workspaceRegistry.delete')
        }
      }
      entry.ok = true
    } catch (error) {
      entry.error = textOf(error)
    }
    manifest.ledger.push(entry)
    results.push({ ...candidate, action: 'cleanup', ok: entry.ok, error: entry.error, steps: entry.steps })
  }
  manifest.lastRun = new Date().toISOString()
  manifest.lastResult = { trigger, dryRun, total: results.length, cleaned: results.filter(item => item.ok).length, at: manifest.lastRun }
  await saveRetention(config, manifest)
  return { ...(await retentionSnapshot(config, tickets, registry)), lastResult: manifest.lastResult, results }
}

function textOf(error) {
  return String(error && error.message ? error.message : error)
}
