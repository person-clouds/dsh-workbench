/**
 * SA management API 代理。
 *
 * 浏览器只访问 DSH 同源的 /dsh-workbench/api/sa；Host 端再以服务端请求调用
 * `/orchestrator/api/*`。代理不直写 orchestrator.sqlite，也不读取 SA 配置
 * 文件；所有写操作都走 SA 自己的管理接口。
 */

import { Readable } from 'node:stream'

const READ = /^(state|overview|search|sources|settings|models|prompts|policy\/history|decisions|threads|threads\/[^/]+|tickets|tickets\/[^/]+)$/
const POST = /^(executor\/pause|tickets\/[^/]+\/(retry|stop)|sources\/[^/]+\/labels|setup\/check|triggers\/[^/]+\/requeue|decisions\/[^/]+\/dismiss|policy-sync\/[^/]+|prompts\/preview)$/
const PUT = /^(settings\/[A-Za-z0-9:_-]+|prompts)$/

export function allowedSaRequest(method, path) {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('//')) return false
  if (method === 'GET') return READ.test(path)
  if (method === 'POST') return POST.test(path)
  if (method === 'PUT') return PUT.test(path)
  return false
}

async function readBody(req, maxBytes = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new Error(`请求体超过 ${maxBytes} 字节`)
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

/**
 * @param ctx - Cordis 上下文，使用 webServer.port 作为默认 SA 地址。
 * @param config - 插件配置，saApiBase 可覆盖。
 */
export async function proxySa(ctx, config, req, res, url) {
  const method = req.method || 'GET'
  const path = String(url.searchParams.get('path') || '')
  const query = new URLSearchParams(url.searchParams)
  query.delete('path')
  const suffix = query.toString()
  if (!allowedSaRequest(method, path)) {
    json(res, 400, { error: '不支持的 SA 操作' })
    return
  }
  let payload
  try {
    if (method !== 'GET') payload = await readBody(req)
  } catch (error) {
    json(res, 400, { error: String(error && error.message ? error.message : error) })
    return
  }
  const base = String(config.saApiBase || `http://127.0.0.1:${ctx.webServer.port}`).replace(/\/+$/, '')
  const target = `${base}/orchestrator/api/${path}${suffix ? `?${suffix}` : ''}`
  const headers = {
    accept: 'application/json',
    'x-orchestrator-request': '1',
    cookie: String(req.headers.cookie || ''),
  }
  if (payload && payload.length > 0) headers['content-type'] = String(req.headers['content-type'] || 'application/json')
  try {
    const response = await fetch(target, { method, headers, body: payload && payload.length > 0 ? payload : undefined, redirect: 'error' })
    const body = Buffer.from(await response.arrayBuffer())
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  } catch (error) {
    json(res, 502, { error: `SA 管理接口不可用：${String(error && error.message ? error.message : error)}` })
  }
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
