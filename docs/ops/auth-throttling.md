# Auth throttling and client addresses

## Limits (`server/src/middleware/authThrottle.js`)

| Bucket | Limit | Applies |
|---|---|---|
| Failed sign-ins per account (normalised email) | 10 / 15 min | always |
| Failed sign-ins per (client IP, account) | 5 / 15 min | only when the client IP is trusted |
| Failed sign-ins per client IP, any account | 50 / 15 min | only when the client IP is trusted |
| Sign-up attempts per email | 5 / hour | always |
| Sign-up attempts per client IP | 20 / hour | only when the client IP is trusted |

Throttled requests get `429` with `Retry-After` (seconds) and `{ error, retryAfterSeconds }`.
A successful sign-in clears that account's bucket and that client's (IP, account) bucket.
The login lookup itself is unchanged, so existing mixed-case emails keep working; buckets
are keyed case-insensitively.

Logs: request logs carry method + path only (no client address, headers, cookies or
bodies). Throttling logs `auth_throttled` with `retryAfterSeconds` only.

**Single-instance limitation.** Counters live in memory in the API process. That is correct
for the one `tradeloom-api` instance we run; counters reset on redeploy. Running more than
one replica would give each its own counters (limits multiply by the replica count) — move
the buckets to a shared store (e.g. Redis or a DB table) before scaling out.

## Client address on Railway — `TRUST_PROXY=railway`

Verified on staging 2026-11-24 with the probe below:

| Path | Socket peer seen by the API | `X-Forwarded-For` seen by the API |
|---|---|---|
| client → edge → API (`tradeloom-api-staging`) | `::ffff:100.64.0.x` | `<client>, <edge node>` |
| client → edge → web → API (`tradeloom-web-staging`) | `fd12:…` (private network) | `<client>, <edge node>, ::ffff:100.64.0.x` |

- The edge **discards** client-sent `X-Forwarded-For` (also duplicates, `Forwarded`,
  `X-Client-IP`; HTTP/1.0 and HTTP/2) and writes `<client>, <edge node>`.
- Edge node IPs vary (`79.127.177.113`, `.114`, …) and the two paths differ in hop count,
  so a numeric `TRUST_PROXY` is wrong for at least one path — `2` would make every web
  user share the edge node's address.
- `railway` trusts the chain only when the socket peer is Railway-internal
  (`100.64.0.0/10` or `fd00::/8`) and then uses the left-most entry, which the edge set.
  A non-internal peer never has its headers trusted.

Unset `TRUST_PROXY` (local dev) keeps `request.ip` = socket peer and disables the IP buckets.

### Re-verifying

`GET /api/auth/client-address` returns the socket peer, forwarding headers and resolved
`ip`. It answers 404 unless `CLIENT_ADDRESS_PROBE_KEY` is set on the API and sent as
`x-probe-key`. Set the key, run the requests against both public domains (with and without
a forged `X-Forwarded-For`), then delete the variable again.
