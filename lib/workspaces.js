/**
 * DSH 工作区与仓库来源。
 *
 * 工作区注册、归档集合和 pin 集合都只读 `ctx.workspaceRegistry`；
 * 会话标题/类型来自 `sessionCatalog`（sessionQuery 投影）。
 * “未分组”是 DSH 客户端同样采用的合成分组：不属于任何工作区的会话。
 */

import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sessionCatalog, sessionKind } from './sessions.js'

/** 工作区快照：路径、会话（带标题）、归档/pin 状态，以及未分组会话。 */
export async function workspacesOverview(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return { error: '当前 DSH Host 没有 workspaceRegistry，无法读取工作区。', workspaces: [], ungrouped: { sessions: [] } }
  const catalog = await sessionCatalog(ctx)
  const byId = new Map(catalog.sessions.map(session => [session.id, session]))
  const owned = new Set()
  const workspaces = []
  for (const workspace of registry.list()) {
    let status = 'ok'
    try { status = await workspace.status() } catch { status = 'unknown' }
    const ids = (workspace.sessionIds || []).map(String)
    ids.forEach(id => owned.add(id))
    workspaces.push({
      id: String(workspace.id),
      title: workspace.title,
      path: workspace.path,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      status,
      exists: existsSync(workspace.path),
      git: existsSync(join(workspace.path, '.git')),
      sessions: ids.map(id => {
        const known = byId.get(id)
        return {
          id,
          title: known ? known.title : '',
          createdAt: known ? known.createdAt : 0,
          archived: Boolean(known ? known.archived : false),
          pinned: Boolean(known ? known.pinned : false),
          kind: known ? known.kind : sessionKind(id),
          live: known ? known.live : false,
          origin: known ? known.origin : '',
        }
      }),
    })
  }
  // 与 DSH 浏览器端一致：排除 subagent 会话；未分组不是工作区，不写回 registry。
  const ungroupedSessions = catalog.sessions
    .filter(session => !owned.has(session.id) && session.origin !== 'subagent')
    .map(session => ({ ...session }))
  return {
    workspaces,
    ungrouped: { title: '未分组', sessions: ungroupedSessions },
    counts: {
      workspaces: workspaces.length,
      sessions: catalog.sessions.filter(session => session.origin !== 'subagent').length,
      ungrouped: ungroupedSessions.length,
    },
    sessionError: catalog.error,
    archivedCount: new Set(registry.archivedSessionIds || []).size,
    pinnedCount: new Set(registry.pinnedSessionIds || []).size,
  }
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
      source: 'workspace',
    })
    if (repos.length >= limit) break
  }
  return repos
}
