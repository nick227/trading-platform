/**
 * Account-aware throttling for the public auth endpoints.
 *
 * Why not a plain per-IP limiter: behind Railway (edge → web proxy → API) every request
 * can arrive from the same proxy address unless the hop count is configured, and one
 * shared bucket would lock out every user at once. So:
 *   - account buckets (normalised email) always apply — they only affect that account;
 *   - IP buckets apply only when TRUST_PROXY is configured, i.e. request.ip is the client.
 *
 * Failed logins count; a successful login clears that client's per-account bucket.
 * In-memory: correct for the single API instance we run. A second instance needs a
 * shared store.
 */

const MIN = 60_000

export const LIMITS = {
  loginAccount: { max: 10, windowMs: 15 * MIN },  // failures per account, any source
  loginClientAccount: { max: 5, windowMs: 15 * MIN }, // failures per (client IP, account)
  loginClient: { max: 50, windowMs: 15 * MIN },   // failures per client IP, any account
  registerEmail: { max: 5, windowMs: 60 * MIN },
  registerClient: { max: 20, windowMs: 60 * MIN },
}

/**
 * Fastify trustProxy from TRUST_PROXY: a hop count ("2"), "true", or a comma-separated
 * list of addresses/CIDRs. Unset → false (request.ip is the socket peer).
 */
export function trustProxyFromEnv(value = process.env.TRUST_PROXY) {
  const v = String(value ?? '').trim()
  if (!v || v === 'false' || v === '0') return false
  if (v === 'true') return true
  if (/^\d+$/.test(v)) return Number(v)
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()

export class AuthThrottle {
  constructor({ limits = LIMITS, now = () => Date.now(), clientIpTrusted = false } = {}) {
    this.limits = limits
    this.now = now
    this.clientIpTrusted = clientIpTrusted
    this.hits = new Map() // key -> timestamps (ascending)
  }

  _live(key, windowMs) {
    const cutoff = this.now() - windowMs
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    if (list.length) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }

  _keys(kind, { ip, email }) {
    const acct = normalizeEmail(email)
    const out = []
    if (kind === 'login') {
      out.push([`login:acct:${acct}`, this.limits.loginAccount])
      if (this.clientIpTrusted && ip) {
        out.push([`login:ipacct:${ip}|${acct}`, this.limits.loginClientAccount])
        out.push([`login:ip:${ip}`, this.limits.loginClient])
      }
    } else {
      out.push([`register:email:${acct}`, this.limits.registerEmail])
      if (this.clientIpTrusted && ip) out.push([`register:ip:${ip}`, this.limits.registerClient])
    }
    return out
  }

  /** Seconds until the request may proceed; 0 when it isn't throttled. */
  retryAfter(kind, who) {
    let wait = 0
    for (const [key, { max, windowMs }] of this._keys(kind, who)) {
      const list = this._live(key, windowMs)
      if (list.length >= max) wait = Math.max(wait, Math.ceil((list[list.length - max] + windowMs - this.now()) / 1000))
    }
    return wait
  }

  record(kind, who) {
    const t = this.now()
    for (const [key, { windowMs }] of this._keys(kind, who)) this.hits.set(key, [...this._live(key, windowMs), t])
  }

  /** After a successful login: forget this client's failures for the account. */
  clear(who) {
    const acct = normalizeEmail(who.email)
    this.hits.delete(`login:acct:${acct}`)
    if (who.ip) this.hits.delete(`login:ipacct:${who.ip}|${acct}`)
  }

  sweep() {
    const longest = Math.max(...Object.values(this.limits).map((l) => l.windowMs))
    for (const key of [...this.hits.keys()]) this._live(key, longest)
  }
}
