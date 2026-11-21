// Production server for the built SPA (Node built-ins only).
// - Serves ./dist with long-lived caching for hashed assets and no-cache for HTML.
// - Falls back to index.html for client-side routes.
// - Streams /api/* to API_PROXY_TARGET (e.g. Railway private API), passing cookies through.
// - /healthz answers without touching the API.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/
const HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css)$/
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
}

export function createServer({ distDir, apiTarget }) {
  const root = path.resolve(distDir)
  const indexPath = path.join(root, 'index.html')
  const upstream = apiTarget ? new URL(apiTarget) : null

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers })
    res.end(body)
  }

  function proxy(req, res) {
    if (!upstream) return send(res, 502, JSON.stringify({ error: 'API proxy not configured' }), { 'Content-Type': 'application/json' })
    const headers = { ...req.headers, host: upstream.host }
    const fwdFor = req.headers['x-forwarded-for']
    headers['x-forwarded-for'] = fwdFor ? `${fwdFor}, ${req.socket.remoteAddress}` : req.socket.remoteAddress
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http'
    headers['x-forwarded-host'] = req.headers.host || ''
    const up = http.request(
      { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers)
        upRes.pipe(res)
      }
    )
    up.setTimeout(60_000, () => up.destroy(new Error('upstream timeout')))
    up.on('error', () => {
      if (!res.headersSent) send(res, 502, JSON.stringify({ error: 'API unavailable' }), { 'Content-Type': 'application/json' })
      else res.destroy()
    })
    req.pipe(up)
  }

  function serveFile(req, res, filePath, { isIndex }) {
    const ext = path.extname(filePath).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    const rel = path.relative(root, filePath)
    const cache = isIndex ? 'no-cache' : HASHED.test(rel) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
    const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': cache, Vary: 'Accept-Encoding' }
    const gzip = COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    if (gzip) headers['Content-Encoding'] = 'gzip'
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => res.destroy())
    ;(gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res)
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local')
    if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Cache-Control': 'no-store' })
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(req, res)
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })

    let decoded
    try {
      decoded = decodeURIComponent(url.pathname)
    } catch {
      return send(res, 400, 'Bad Request')
    }
    const filePath = path.resolve(root, '.' + path.posix.normalize(decoded))
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return send(res, 403, 'Forbidden')

    fs.stat(filePath, (err, st) => {
      if (!err && st.isFile() && path.basename(filePath) !== '.htaccess') return serveFile(req, res, filePath, { isIndex: filePath === indexPath })
      // Unknown asset-looking paths are 404s; everything else is a client-side route.
      if (path.extname(decoded)) return send(res, 404, 'Not Found')
      return serveFile(req, res, indexPath, { isIndex: true })
    })
  })
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const server = createServer({ distDir: path.join(here, 'dist'), apiTarget: process.env.API_PROXY_TARGET })
  const port = Number(process.env.PORT || 4173)
  const host = process.env.HOST || '::'
  server.listen(port, host, () => console.log(`[serve] listening on ${host}:${port}; /api -> ${process.env.API_PROXY_TARGET || '(not configured)'}`))
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
