import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from '../serve.mjs'

test('production static server preserves SPA, health, and authenticated API proxy contracts', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tradeloom-static-'))
  await mkdir(path.join(dir, 'js'))
  await writeFile(path.join(dir, 'index.html'), '<html>TradeLoom test build</html>')
  await writeFile(path.join(dir, 'js/index-12345678.js'), 'console.log("asset")')
  await writeFile(path.join(dir, '.private'), 'not public')
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    res.writeHead(req.url === '/api/denied' ? 401 : 200, {
      'content-type': 'application/json', 'set-cookie': ['session=test; HttpOnly; Path=/; Secure', 'other=test; Path=/'],
    })
    res.end(JSON.stringify({url:req.url, method:req.method, cookie:req.headers.cookie,
      authorization:req.headers.authorization, proto:req.headers['x-forwarded-proto'], body:Buffer.concat(chunks).toString()}))
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const server = createServer({distDir:dir, apiTarget:`http://127.0.0.1:${upstream.address().port}`})
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {server.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise(r=>server.close(r)), new Promise(r=>upstream.close(r))]); await rm(dir,{recursive:true})})
  const base = `http://127.0.0.1:${server.address().port}`
  for (const route of ['/', '/bots/new', '/profile/broker', '/login']) {
    const r = await fetch(base+route, {headers:{Host:'healthcheck.railway.app'}})
    assert.equal(r.status,200); assert.match(await r.text(),/TradeLoom/); assert.equal(r.headers.get('cache-control'),'no-cache')
  }
  assert.equal(await (await fetch(base+'/healthz')).text(), 'ok')
  assert.equal((await fetch(base+'/missing.js')).status,404)
  assert.equal((await fetch(base+'/.private')).status,404)
  assert.equal((await fetch(base+'/%00')).status,400)
  assert.equal((await fetch(base+'/route',{method:'POST'})).status,405)
  const asset = await fetch(base+'/js/index-12345678.js')
  assert.match(asset.headers.get('cache-control'),/immutable/)
  const head = await fetch(base+'/bots/new',{method:'HEAD'}); assert.equal(head.status,200); assert.equal(await head.text(),'')
  assert.equal((await fetch(base+'/',{headers:{'accept-encoding':'gzip;q=0'}})).headers.get('content-encoding'),null)
  const gz = await fetch(base+'/',{headers:{'accept-encoding':'gzip'}}); assert.equal(gz.headers.get('content-encoding'),'gzip'); assert.match(await gz.text(),/TradeLoom/)
  const r = await fetch(base+'/api/auth/login?x=1',{method:'POST', headers:{cookie:'session=test',authorization:'Bearer test','x-forwarded-proto':'https','content-type':'application/json'},body:'{"test":true}'})
  assert.equal(r.headers.getSetCookie().length,2)
  assert.deepEqual(await r.json(),{url:'/api/auth/login?x=1',method:'POST',cookie:'session=test',authorization:'Bearer test',proto:'https',body:'{"test":true}'})
  assert.equal((await fetch(base+'/api/denied')).status,401)
  await new Promise(resolve => upstream.close(resolve))
  assert.equal((await fetch(base+'/api/offline')).status,502)
})
