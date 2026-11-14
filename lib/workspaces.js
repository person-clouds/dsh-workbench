/**
 * DSH 工作区与仓库来源。
 *
 * 这里只读 `ctx.workspaceRegistry`：工作区注册、归档集合和 pin 集合都来自
 * DSH Host 的同一个写者，不再读取第二份 workspace.json。仓库列表由调用方
 * 显式配置或工作区路径自动推导。
 */

import { existsSync } from 'node:fs'
import { basename } from 'node:path'

/** 工作区快照：路径、会话、归档与 pin 状态。 */
export async function workspacesOverview(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return { error: '当前 DSH Host 没有 workspaceRegistry，无法读取工作区。', workspaces: [] }
  const archived = new Set(registry.archivedSessionIds || [])
  const pinned = new Set(registry.pinnedSessionIds || [])
  const workspaces = []
  for (const workspace of registry.list()) {
    let status = 'ok'
    try { status = await workspace.status() } catch { status = 'unknown' }
    workspaces.push({
      id: String(workspace.id),
      title: workspace.title,
      path: workspace.path,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      status,
      exists: existsSync(workspace.path),
      sessions: (workspace.sessionIds || []).map(id => ({
        id: String(id),
        archived: archived.has(id),
        pinned: pinned.has(id),
        kind: sessionKind(String(id)),
      })),
    })
  }
  return { workspaces, archivedCount: archived.size, pinnedCount: pinned.size }
}

/** SA 会话命名约定：orchestrator-* / worker-*；其他归为普通会话。 */
function sessionKind(id) {
  if (id.startsWith('worker-')) return 'worker'
  if (id.startsWith('orchestrator-')) return 'orchestrator'
  return 'session'
}

/** 把工作区路径转成代码浏览器的仓库条目；同一路径只出现一次。 */
export function workspaceRepos(ctx, limit = 80) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return []
  const repos = []
  const seen = new Set()
  for (const workspace of registry.list()) {
    const path = workspace.path
    if (!path || seen.has(path) || !existsSync(path)) continue
    seen.add(path)
    repos.push({
      id: `workspace-${String(workspace.id).slice(0, 8)}`,
      name: workspace.title || basename(path),
      path,
      mode: 'worktree',
      ref: '',
      description: 'DSH 工作区',
      remote: '',
      exclude: [],
    })
    if (repos.length >= limit) break
  }
  return repos
}
