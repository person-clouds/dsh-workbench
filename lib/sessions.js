/**
 * DSH 会话目录：标题、cwd、归档/pin 与类型。
 *
 * 标题不在 SessionHeader 里，必须走 Host 的 sessionQuery 投影
 * （readTitleSnapshots）；拿不到时回退到实时 SessionStore / 持久化列表。
 * 这里只读，不创建、不修改任何 Session。
 */

/** 会话类型：SA 的 orchestrator-* / worker-*，其余为普通会话。 */
export function sessionKind(id) {
  if (String(id).startsWith('worker-')) return 'worker'
  if (String(id).startsWith('orchestrator-')) return 'orchestrator'
  return 'session'
}

function recordFromSession(session) {
  const header = session && (session.header || session.meta || {})
  const id = String((header && header.id) || (session && session.id) || '')
  if (!id) return undefined
  return {
    header: {
      id,
      createdAt: Number(header.createdAt || 0),
      cwd: header.cwd ? String(header.cwd) : '',
      origin: header.origin,
      parentSession: header.parentSession,
      isSeeded: Boolean(header.isSeeded),
    },
    live: true,
    persisted: false,
  }
}

/**
 * 读取当前 Host 的会话目录。
 * @returns {{sessions: Array<object>, error: string, titles: number}}
 */
export async function sessionCatalog(ctx) {
  const registry = ctx.get('workspaceRegistry')
  const archived = new Set(registry && registry.archivedSessionIds ? registry.archivedSessionIds : [])
  const pinned = new Set(registry && registry.pinnedSessionIds ? registry.pinnedSessionIds : [])
  const query = ctx.get('sessionQuery')
  let records = []
  let error = ''
  if (query && typeof query.listSessions === 'function') {
    try {
      records = await query.listSessions()
    } catch (failure) {
      error = String(failure && failure.message ? failure.message : failure)
    }
  }
  if (records.length === 0) {
    const store = ctx.get('sessions')
    if (store && typeof store.list === 'function') {
      try { records = store.list().map(recordFromSession).filter(Boolean) } catch { /* 保底失败时返回空目录 */ }
    }
  }

  const ids = records.map(record => String(record.header && record.header.id ? record.header.id : '')).filter(Boolean)
  const titleById = new Map()
  if (query && typeof query.readTitleSnapshots === 'function' && ids.length > 0) {
    try {
      const results = await query.readTitleSnapshots(ids)
      for (const result of results) {
        if (result && result.status === 'fulfilled' && result.value && result.value.title) {
          titleById.set(String(result.sessionId), String(result.value.title.title || ''))
        }
      }
    } catch (failure) {
      if (!error) error = String(failure && failure.message ? failure.message : failure)
    }
  }

  const sessions = records.map(record => {
    const header = record.header || {}
    const id = String(header.id || '')
    return {
      id,
      title: titleById.get(id) || '',
      createdAt: Number(header.createdAt || 0),
      cwd: header.cwd ? String(header.cwd) : '',
      origin: header.origin || '',
      parentSession: header.parentSession ? String(header.parentSession) : '',
      seeded: Boolean(header.isSeeded),
      live: Boolean(record.live),
      persisted: Boolean(record.persisted),
      archived: archived.has(id),
      pinned: pinned.has(id),
      kind: sessionKind(id),
    }
  }).filter(session => session.id)
  sessions.sort((left, right) => right.createdAt - left.createdAt)
  return { sessions, error, titles: titleById.size }
}
