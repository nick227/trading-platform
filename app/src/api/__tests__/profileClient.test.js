import { describe, it, expect, vi, afterEach } from 'vitest'
import { logoutFromServer, disconnectBroker, loginWithCredentials } from '../profileClient'

afterEach(() => vi.unstubAllGlobals())

describe('profileClient requests', () => {
  it('sign-out and disconnect send no JSON content-type without a body (the API rejects an empty JSON body)', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetch)
    await logoutFromServer()
    await disconnectBroker()
    for (const [, opts] of fetch.mock.calls) {
      expect(opts.headers?.['Content-Type']).toBeUndefined()
      expect(opts.credentials).toBe('include')
    }
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/logout')
  })

  it('still declares JSON when a body is sent', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'u' }) }))
    vi.stubGlobal('fetch', fetch)
    await loginWithCredentials('a@example.test', 'pw')
    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
  })
})
