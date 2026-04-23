// Fetches today's market session from Alpaca and schedules open/close callbacks.
// Alpaca is the source of truth — never rely on server timezone or hardcoded hours.

import { log } from '../logger.js'

let marketOpen  = null  // Date
let marketClose = null  // Date
let isOpen      = false
let lastRefreshedAt = null

export async function initCalendar(broker) {
  return refreshCalendar(broker)
}

export async function refreshCalendar(broker) {
  const clock = await broker.getClock()
  isOpen      = clock.is_open

  // Parse next open/close from clock
  marketOpen  = new Date(clock.next_open)
  marketClose = new Date(clock.next_close)
  lastRefreshedAt = new Date()

  const now = Date.now()
  const msUntilOpen  = marketOpen.getTime()  - now
  const msUntilClose = marketClose.getTime() - now

  log.info({ isOpen, nextOpen: marketOpen.toISOString(), nextClose: marketClose.toISOString() }, 'calendar_refresh')

  return { isOpen, marketOpen, marketClose, msUntilOpen, msUntilClose, lastRefreshedAt }
}

// Schedule a callback at market open (ms from now)
export function onMarketOpen(msUntilOpen, callback) {
  if (msUntilOpen <= 0) {
    callback()
    return
  }
  log.info({ inMinutes: Math.round(msUntilOpen / 60000) }, 'market_open_scheduled')
  setTimeout(callback, msUntilOpen)
}

// Schedule a callback at market close (ms from now)
export function onMarketClose(msUntilClose, callback) {
  if (msUntilClose <= 0) {
    callback()
    return
  }
  log.info({ inMinutes: Math.round(msUntilClose / 60000) }, 'market_close_scheduled')
  setTimeout(callback, msUntilClose)
}

export function getMarketHours() {
  return { isOpen, marketOpen, marketClose }
}

export function setMarketOpenState(nextIsOpen) {
  isOpen = nextIsOpen
}

export function getLastCalendarRefreshAt() {
  return lastRefreshedAt
}
