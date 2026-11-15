/**
 * 只读仓库访问：支持 git 对象（不 checkout）与工作区文件两种模式。
 *
 * 来源：
 * - DSH 插件配置 `repos`（显式仓库）；
 * - 配置的 SA 交付仓库；
 * - 当前 workspaceRegistry 中的工作区路径（自动识别）；
 * - SA 工单工作区 stateDir/work/*（实际产出的子项目）。
 * 同一真实路径只保留第一次出现，来源标签据此显示。
 * 只依赖 Node 标准库：
 * - mode=git：`git ls-tree` / `git show` 读取指定 ref；
 * - mode=worktree：直接读磁盘，能看到未提交改动；
 * - 统一屏蔽敏感目录、敏感文件和二进制/超大文件。
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { firstHeading, markdownBlocks, withParts } from './markdown.js'
import { sessionCatalog } from './sessions.js'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const FILE_CACHE_MS = 30_000
const DOC_CACHE_MS = 60_000

const EXCLUDED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.go-build-cache', '.npm-cache', '.cache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', '.toolchain', '.local',
  'dist', 'build', '.run', '.logs', '.xctl', '.go-tmp', '.gomodcache', '.gocache', '.npm',
  '.pnpm-store', '.yarn', 'vendor', 'backups',
])
const SENSITIVE_NAMES = new Set([
  '.env', '.env.local', '.env.production', '.git-credentials', '.npmrc', '.pypirc', '.netrc',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'orchestrator.sqlite',
])
const SENSITIVE_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.kdbx', '.jks', '.keystore', '.sqlite', '.db']
const SENSITIVE_DIRS = new Set(['.ssh', '.gnupg', '.dsh', 'credentials'])
const DOC_EXTS = new Set(['.md', '.markdown'])

const LANG_BY_EXT = {
  '.py': 'python', '.go': 'go', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'tsx', '.vue': 'vue', '.php': 'php', '.sh': 'bash', '.bash': 'bash',
  '.zsh': 'bash', '.sql': 'sql', '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml',
  '.ini': 'ini', '.conf': 'ini', '.md': 'markdown', '.css': 'css', '.html': 'html', '.xml': 'xml',
  '.rs': 'rust', '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp',
}

function expandHome(value) {
  const text = String(value || '')
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

function textOf(error) {
  return String(error && error.message ? error.message : error)
}

async function git(cwd, args, timeout = GIT_TIMEOUT_MS) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true })
  return stdout
}

/** 路径必须是仓库内相对路径；拒绝绝对路径、.. 与反斜杠。 */
export function cleanRel(raw) {
  let value = String(raw || '').replace(/\\/g, '/').trim()
  value = value.replace(/^\/+/, '')
  value = normalize(value).replace(new RegExp(`\\${sep}`, 'g'), '/')
  if (!value || value === '.') return ''
  if (value.startsWith('../') || value.includes('/../') || value === '..') throw new Error(`非法路径：${raw}`)
  return value
}

export function isSensitive(path) {
  const parts = String(path || '').split('/').filter(Boolean)
  if (parts.some(part => SENSITIVE_DIRS.has(part))) return true
  const name = (parts[parts.length - 1] || '').toLowerCase()
  if (SENSITIVE_NAMES.has(name)) return true
  return SENSITIVE_SUFFIXES.some(suffix => name.endsWith(suffix))
}

export function langFor(path) {
  const name = basename(path).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  return LANG_BY_EXT[extname(name).toLowerCase()] || ''
}

function looksLikeGitRepo(repo) {
  return Boolean(repo && repo.path && existsSync(join(repo.path, '.git')))
}

function repoOf(raw) {
  const path = expandHome(raw.path)
  const exclude = Array.isArray(raw.exclude) ? raw.exclude.map(item => String(item).replace(/^\/+|\/+$/g, '')) : []
  return {
    id: String(raw.id || basename(path) || 'repo'),
    name: String(raw.name || raw.id || basename(path) || 'repo'),
    path,
    mode: raw.mode === 'git' ? 'git' : 'worktree',
    ref: String(raw.ref || ''),
    description: String(raw.description || ''),
    remote: String(raw.remote || ''),
    exclude,
    source: String(raw.source || 'configured'),
  }
}

/** SA 工单工作区（stateDir/work/*）：它们是 dshSuperagentRepo 的 git worktree，也是 SA 实际产出的子项目。 */
async function saWorkRepos(config, limit = 40) {
  const root = join(expandHome(config.stateDir || join(config.dshHome || join(homedir(), '.dsh'), 'state', 'superagent')), 'work')
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    try {
      const info = await stat(path)
      found.push({ name: entry.name, path, mtime: info.mtimeMs })
    } catch { /* 读不到的目录跳过 */ }
  }
  found.sort((left, right) => right.mtime - left.mtime)
  return found.slice(0, limit).map(item => repoOf({
    id: `sa-work-${item.name}`,
    name: item.name,
    path: item.path,
    mode: 'worktree',
    description: 'SA 子项目（工单工作区）',
    source: 'sa-work',
  }))
}

/**
 * 读取仓库清单：DSH 显式配置 + workspace 自动识别 + SA 交付仓库兜底。
 * 同一路径或同一 id 只保留第一次出现的条目。
 */
export async function loadRepos(config, workspaces = []) {
  const configured = (Array.isArray(config.repos) ? config.repos : []).map(repoOf).filter(repo => repo.id && repo.path)
  const deliveryPath = expandHome(config.repoDir)
  const delivery = existsSync(deliveryPath) ? [repoOf({
    id: 'superagent',
    name: basename(deliveryPath) || 'superagent',
    path: deliveryPath,
    mode: 'git',
    ref: config.baseRef || 'origin/main',
    description: 'SA 交付仓库',
    source: 'sa-delivery',
  })] : []
  const saWork = await saWorkRepos(config)
  const repos = []
  const paths = new Set()
  const ids = new Set()
  for (const repo of [...configured, ...delivery, ...workspaces, ...saWork]) {
    if (ids.has(repo.id) || paths.has(resolve(repo.path))) continue
    ids.add(repo.id)
    paths.add(resolve(repo.path))
    repos.push(repo)
  }
  return repos
}

export function findRepo(repos, id) {
  return repos.find(repo => repo.id === id)
}

function excluded(repo, path) {
  return repo.exclude.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

async function resolveRef(repo) {
  const candidate = (repo.ref || '').trim()
  for (const ref of [candidate, 'origin/main', 'HEAD']) {
    if (!ref) continue
    try {
      return (await git(repo.path, ['rev-parse', '--verify', `${ref}^{commit}`])).trim()
    } catch { /* 尝试下一个 */ }
  }
  throw new Error(`无法解析仓库 ref：${candidate || repo.path}`)
}

const fileCache = new Map()

/** 文件清单：git 模式读 ref 的 tree，工作区模式递归读磁盘并跳过缓存目录。 */
export async function listFiles(repo) {
  const cacheKey = `${repo.id}:${repo.mode}:${repo.ref}`
  const cached = fileCache.get(cacheKey)
  if (cached && Date.now() - cached.at < FILE_CACHE_MS) return cached.files
  let files
  if (repo.mode === 'git' && looksLikeGitRepo(repo)) {
    const ref = await resolveRef(repo)
    const out = await git(repo.path, ['ls-tree', '-r', '-z', '--name-only', ref])
    files = out.split('\0').filter(Boolean)
  } else {
    files = await walkWorktree(repo.path)
  }
  files = files
    .filter(path => !isSensitive(path) && !excluded(repo, path))
    .sort((left, right) => left.localeCompare(right))
  fileCache.set(cacheKey, { at: Date.now(), files })
  return files
}

async function walkWorktree(root) {
  const collected = []
  async function walk(dir, prefix) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else if (entry.isFile()) collected.push(rel)
    }
  }
  await walk(root, '')
  return collected
}

/** 仓库概况：分支、HEAD、最近提交与工作区改动数量。 */
export async function repoInfo(repo) {
  const info = {
    id: repo.id, name: repo.name, path: repo.path, mode: repo.mode, ref: repo.ref,
    description: repo.description, remote: repo.remote, ok: false, error: '',
    source: repo.source || 'configured', git: looksLikeGitRepo(repo),
    branch: '', head: '', subject: '', when: '', dirty: 0, ahead: 0, behind: 0, commits: [], sessions: [],
  }
  if (!existsSync(repo.path)) {
    info.error = `路径不存在：${repo.path}`
    return info
  }
  if (!looksLikeGitRepo(repo)) {
    info.ok = true
    info.branch = repo.mode === 'worktree' ? '工作区' : '—'
    return info
  }
  try {
    info.ok = true
    info.branch = (await git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (info.branch === 'HEAD' && repo.ref) info.branch = repo.ref
    const log = (await git(repo.path, ['log', '-1', '--format=%h%x1f%an%x1f%at%x1f%s'])).trim()
    if (log) {
      const [short, author, stamp, subject] = log.split('\x1f')
      info.head = short || ''
      info.author = author || ''
      info.subject = subject || ''
      const date = new Date(Number(stamp) * 1000)
      info.when = Number.isNaN(date.getTime()) ? '' : date.toISOString()
    }
    if (repo.mode === 'worktree') {
      const status = await git(repo.path, ['status', '--porcelain', '-z'])
      info.dirty = status.split('\0').filter(Boolean).length
    }
    const commits = await git(repo.path, ['log', '-5', '--format=%h%x1f%an%x1f%at%x1f%s'])
    info.commits = commits.split('\n').filter(Boolean).map(line => {
      const [short, author, stamp, subject] = line.split('\x1f')
      return { short, author, at: new Date(Number(stamp) * 1000).toISOString(), subject }
    })
  } catch (error) {
    info.ok = false
    info.error = textOf(error)
  }
  return info
}

/** 文档索引：仓库内所有 Markdown，只返回路径与首标题。 */
const docsCache = new Map()

export async function docsIndex(repos) {
  const groups = []
  for (const repo of repos) {
    const cacheKey = `${repo.id}:${repo.ref}`
    const cached = docsCache.get(cacheKey)
    if (cached && Date.now() - cached.at < DOC_CACHE_MS) {
      groups.push({ repo: { id: repo.id, name: repo.name, description: repo.description }, docs: cached.docs })
      continue
    }
    const docs = []
    try {
      const files = await listFiles(repo)
      for (const path of files) {
        if (!DOC_EXTS.has(extname(path).toLowerCase())) continue
        const text = await readTextFile(repo, path, 8000)
        docs.push({ path, title: firstHeading(text) || basename(path) })
      }
    } catch { /* 单个仓库读取失败不影响其他仓库 */ }
    docsCache.set(cacheKey, { at: Date.now(), docs })
    groups.push({ repo: { id: repo.id, name: repo.name, description: repo.description }, docs })
  }
  return groups
}

/** 目录列表：只返回直接子项，目录在前。 */
export async function repoTree(repo, rawPath) {
  const path = cleanRel(rawPath)
  const files = await listFiles(repo)
  const prefix = path ? `${path}/` : ''
  const dirs = new Map()
  const entries = []
  for (const file of files) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    if (!rest) continue
    const slash = rest.indexOf('/')
    if (slash >= 0) {
      const name = rest.slice(0, slash)
      if (!dirs.has(name)) dirs.set(name, { type: 'dir', name, path: `${prefix}${name}` })
    } else {
      entries.push({ type: 'file', name: rest, path: file, lang: langFor(file) })
    }
  }
  return { path, entries: [...[...dirs.values()].sort((a, b) => a.name.localeCompare(b.name)), ...entries.sort((a, b) => a.name.localeCompare(b.name))] }
}

async function fileSize(repo, path) {
  if (repo.mode === 'git' && looksLikeGitRepo(repo)) {
    try {
      const ref = await resolveRef(repo)
      return Number((await git(repo.path, ['cat-file', '-s', `${ref}:${path}`])).trim())
    } catch {
      return -1
    }
  }
  try {
    return (await stat(join(repo.path, path))).size
  } catch {
    return -1
  }
}

async function readBytes(repo, path) {
  if (repo.mode === 'git' && looksLikeGitRepo(repo)) {
    const ref = await resolveRef(repo)
    const { stdout } = await run('git', ['-C', repo.path, 'show', `${ref}:${path}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS })
    return stdout
  }
  const target = normalize(join(repo.path, path))
  const root = normalize(repo.path)
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`非法路径：${path}`)
  return readFile(target)
}

async function readTextFile(repo, path, limit = MAX_FILE_BYTES) {
  const size = await fileSize(repo, path)
  if (size < 0 || size > limit) return ''
  const raw = await readBytes(repo, path)
  if (raw.subarray(0, 8000).includes(0)) return ''
  return raw.toString('utf8')
}

/** 读取文件内容；Markdown 返回已切好的块，其他文本返回源码。 */
export async function repoBlob(repo, rawPath) {
  const path = cleanRel(rawPath)
  if (!path) throw new Error('缺少 path 参数')
  if (isSensitive(path) || excluded(repo, path)) throw new Error('该文件不可展示')
  const files = await listFiles(repo)
  if (!files.includes(path)) throw new Error(`文件不存在：${path}`)
  const size = await fileSize(repo, path)
  if (size < 0) throw new Error(`读取文件失败：${path}`)
  if (size > MAX_FILE_BYTES) return { path, size, binary: false, tooLarge: true, text: '', blocks: [], lang: langFor(path) }
  const raw = await readBytes(repo, path)
  const binary = raw.subarray(0, 8000).includes(0)
  if (binary) return { path, size, binary: true, tooLarge: false, text: '', blocks: [], lang: langFor(path) }
  const text = raw.toString('utf8')
  const isDoc = DOC_EXTS.has(extname(path).toLowerCase())
  return {
    path, size, binary: false, tooLarge: false, lang: langFor(path), isDoc,
    text: isDoc ? '' : text,
    blocks: isDoc ? withParts(markdownBlocks(text)) : [],
  }
}

/**
 * 仓库列表页数据：附带 cwd 落在该仓库内的 DSH 会话标题。
 * 会话名来自 sessionQuery，和仓库列表一起返回，避免浏览器二次请求。
 */
export async function reposOverview(repos, ctx) {
  const overview = await Promise.all(repos.map(repoInfo))
  if (!ctx) return overview
  let sessions = []
  try { sessions = (await sessionCatalog(ctx)).sessions.filter(session => session.origin !== 'subagent') } catch { sessions = [] }
  for (const repo of overview) {
    repo.sessions = sessions
      .filter(session => session.cwd === repo.path || (session.cwd && session.cwd.startsWith(`${repo.path}/`)))
      .slice(0, 8)
      .map(session => ({ id: session.id, title: session.title, kind: session.kind, createdAt: session.createdAt, archived: session.archived, pinned: session.pinned }))
  }
  return overview
}
