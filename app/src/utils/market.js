// Market hours utilities — always use America/New_York timezone.

const ET = 'America/New_York'

function getETParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ET,
      weekday: 'short',
      hour:    'numeric',
      minute:  'numeric',
      hour12:  false,
    })
    .formatToParts(date)
    .map(p => [p.type, p.value])
  )
}

export function isMarketClosed(date = new Date()) {
  const { weekday, hour, minute } = getETParts(date)
  const h = parseInt(hour,   10)
  const m = parseInt(minute, 10)
  if (weekday === 'Sat' || weekday === 'Sun') return true
  if (h < 9 || h >= 16) return true
  if (h === 9 && m < 30) return true
  return false
}

export function formatETTime(date = new Date()) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: ET,
  }) + ' ET'
}

export function formatETNextOpen(nextOpenISO) {
  if (!nextOpenISO) return '09:30 AM ET'
  return new Date(nextOpenISO).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: ET,
  }) + ' ET'
}

export function getQuoteFreshness(lastUpdate, now = Date.now()) {
  const ageSeconds = Math.round((now - lastUpdate) / 1000)
  
  if (ageSeconds <= 5) return { state: 'live', label: 'Live', ageSeconds }
  if (ageSeconds <= 20) return { state: 'fresh', label: `${ageSeconds}s ago`, ageSeconds }
  if (ageSeconds <= 60) return { state: 'delayed', label: `${ageSeconds}s ago`, ageSeconds }
  return { state: 'stale', label: `${ageSeconds}s ago`, ageSeconds }
}
