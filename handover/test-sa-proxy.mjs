#!/usr/bin/env node
/** 回归：workbench 代理必须保留浏览器 Host/Origin，SA cookie 才能通过鉴权。 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { proxySa } from '../lib/sa.js'

const seen = {}
const sa = http.createServer((req, res) => {
  seen.host = req.headers.host
  seen.origin = req.headers.origin
  seen.cookie = req.headers.cookie
  seen.request = req.headers['x-orchestrator-request']
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, path: req.url }))
})
await new Promise(resolve => sa.listen(0, '127.0.0.1', resolve))
const saBase = `http://127.0.0.1:${sa.address().port}`

const proxy = http.createServer((req, res) => {
  void proxySa({}, { saApiBase: saBase }, req, res, new URL(req.url, 'http://localhost'))
})
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))

function call() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxy.address().port,
      path: '/dsh-workbench/api/sa?path=state',
      headers: {
        host: '192.168.31.244:8080',
        origin: 'http://192.168.31.244:8080',
        cookie: 'dsh-session=test-cookie',
      },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end()
  })
}

try {
  const result = await call()
  assert.equal(result.status, 200)
  assert.deepEqual(JSON.parse(result.body), { ok: true, path: '/orchestrator/api/state' })
  assert.equal(seen.host, '192.168.31.244:8080')
  assert.equal(seen.origin, 'http://192.168.31.244:8080')
  assert.equal(seen.cookie, 'dsh-session=test-cookie')
  assert.equal(seen.request, '1')
  console.log('PASS: SA 代理保留 Host/Origin/cookie，x-orchestrator-request=1')
} finally {
  proxy.close()
  sa.close()
}
