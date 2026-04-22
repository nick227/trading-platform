const hhmmCache = new Map()
const dtfByTz = new Map()
const configCache = new WeakMap()

function parseHHMM(value) {
  if (typeof value !== 'string') return null
  const key = value.trim()
  const cached = hhmmCache.get(key)
  if (cached !== undefined) return cached

  const m = key.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) {
    hhmmCache.set(key, null)
    return null
  }
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
    hhmmCache.set(key, null)
    return null
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    hhmmCache.set(key, null)
    return null
  }

  const minutes = hh * 60 + mm
  hhmmCache.set(key, minutes)
  return minutes
}

function getMinutesNowInTz(timezone) {
  let dtf = dtfByTz.get(timezone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    dtfByTz.set(timezone, dtf)
  }

  const parts = dtf.formatToParts(new Date())
  let hh = NaN, mm = NaN
  for (const p of parts) {
    if (p.type === 'hour')   hh = Number(p.value)
    else if (p.type === 'minute') mm = Number(p.value)
  }
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return hh * 60 + mm
}

// config: { start: "09:35", end: "09:55", timezone?: "America/New_York" }
export function evaluateTimeWindow(config) {
  if (!config || typeof config !== 'object') {
    return { pass: false, reason: 'time_window_invalid_config', detail: 'config must be an object' }
  }

  let cached = configCache.get(config)
  if (!cached) {
    const timezone = config.timezone ?? 'America/New_York'
    const start = parseHHMM(config.start)
    const end = parseHHMM(config.end)
    cached = { timezone, start, end }
    configCache.set(config, cached)
  }

  const { timezone, start, end } = cached
  if (start == null || end == null) {
    return { pass: false, reason: 'time_window_invalid_config', detail: 'start/end must be HH:MM' }
  }

  const nowMin = getMinutesNowInTz(timezone)
  if (nowMin == null) {
    return { pass: false, reason: 'time_window_clock_unavailable' }
  }

  // Inclusive window: [start, end]
  const inside = start <= end
    ? (nowMin >= start && nowMin <= end)
    : (nowMin >= start || nowMin <= end) // supports overnight windows if needed

  if (!inside) {
    return { pass: false, reason: 'time_window_outside', detail: `nowMin=${nowMin} start=${start} end=${end} tz=${timezone}` }
  }

  return { pass: true }
}
