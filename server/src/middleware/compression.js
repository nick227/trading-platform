// Fastify response compression + lightweight instrumentation
import compress from '@fastify/compress'
import { deflate, gzip } from 'zlib'
import { promisify } from 'util'

const gzipAsync = promisify(gzip)
const deflateAsync = promisify(deflate)

// Custom compression for large datasets (manual use from code paths that want it)
export const heavyCompression = async (data, format = 'gzip') => {
  try {
    const serialized = JSON.stringify(data)
    if (format === 'gzip') return await gzipAsync(serialized)
    if (format === 'deflate') return await deflateAsync(serialized)
    return data
  } catch (error) {
    console.error('Compression failed:', error)
    return data
  }
}

const compressionStats = {
  totalRequests: 0,
  compressedResponses: 0
}

export const getCompressionStats = () => ({ ...compressionStats })

export const resetCompressionStats = () => {
  compressionStats.totalRequests = 0
  compressionStats.compressedResponses = 0
}

export default async function compressionPlugin(app) {
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
    zlibOptions: { level: 6 }
  })

  app.addHook('onRequest', async (request) => {
    compressionStats.totalRequests++

    // Client explicitly requests no compression (useful for debugging)
    if (request.headers['x-no-compression']) {
      request.headers['accept-encoding'] = 'identity'
    }
  })

  // Response size monitoring (uses post-serialization payload size when available)
  app.addHook('onSend', async (_request, reply, payload) => {
    let size = null

    if (typeof payload === 'string') size = Buffer.byteLength(payload, 'utf8')
    else if (Buffer.isBuffer(payload)) size = payload.length

    if (size != null) reply.header('X-Response-Size', size)
    return payload
  })

  // Best-effort tracking: "was content encoded?"
  app.addHook('onResponse', async (_request, reply) => {
    const encoding = reply.getHeader('content-encoding')
    if (encoding && encoding !== 'identity') compressionStats.compressedResponses++
  })
}

