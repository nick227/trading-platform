/**
 * US Stock Market (NYSE / NASDAQ) Calendar & Session Utilities
 * Computes official exchange trading days, market holidays, and expected completed sessions.
 */

function nthDayOfWeekInMonth(year, monthIndex, targetDayOfWeek, n) {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, monthIndex, day))
    if (d.getUTCMonth() !== monthIndex) break
    if (d.getUTCDay() === targetDayOfWeek) {
      count++
      if (count === n) return d
    }
  }
  return null
}

function lastDayOfWeekInMonth(year, monthIndex, targetDayOfWeek) {
  let last = null
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, monthIndex, day))
    if (d.getUTCMonth() !== monthIndex) break
    if (d.getUTCDay() === targetDayOfWeek) {
      last = d
    }
  }
  return last
}

function getEasterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function getGoodFriday(year) {
  const easter = getEasterSunday(year)
  return new Date(easter.getTime() - 2 * 86_400_000)
}

function applyWeekendHolidayRule(date) {
  const dow = date.getUTCDay()
  if (dow === 0) {
    // Sunday holiday observed on Monday
    return new Date(date.getTime() + 86_400_000)
  }
  if (dow === 6) {
    // Saturday holiday observed on Friday
    return new Date(date.getTime() - 86_400_000)
  }
  return date
}

export function getNyseHolidays(year) {
  const holidays = new Set()
  const add = (d) => {
    if (d) holidays.add(d.toISOString().slice(0, 10))
  }

  // 1. New Year's Day (Jan 1)
  add(applyWeekendHolidayRule(new Date(Date.UTC(year, 0, 1))))

  // 2. Martin Luther King Jr. Day (3rd Monday in Jan)
  add(nthDayOfWeekInMonth(year, 0, 1, 3))

  // 3. Washington's Birthday / Presidents' Day (3rd Monday in Feb)
  add(nthDayOfWeekInMonth(year, 1, 1, 3))

  // 4. Good Friday (Friday before Easter)
  add(getGoodFriday(year))

  // 5. Memorial Day (Last Monday in May)
  add(lastDayOfWeekInMonth(year, 4, 1))

  // 6. Juneteenth National Independence Day (June 19)
  add(applyWeekendHolidayRule(new Date(Date.UTC(year, 5, 19))))

  // 7. Independence Day (July 4)
  add(applyWeekendHolidayRule(new Date(Date.UTC(year, 6, 4))))

  // 8. Labor Day (1st Monday in September)
  add(nthDayOfWeekInMonth(year, 8, 1, 1))

  // 9. Thanksgiving Day (4th Thursday in November)
  add(nthDayOfWeekInMonth(year, 10, 4, 4))

  // 10. Christmas Day (Dec 25)
  add(applyWeekendHolidayRule(new Date(Date.UTC(year, 11, 25))))

  return holidays
}

export function isExchangeTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return false
  const year = d.getUTCFullYear()
  const holidays = getNyseHolidays(year)
  return !holidays.has(dateStr)
}

/**
 * Returns the expected latest completed exchange trading session (YYYY-MM-DD)
 * based on wall-clock time in America/New_York and standard 16:30 ET close buffer.
 * If now is before 16:30 ET or on an exchange holiday/weekend, steps backward to the
 * latest completed trading day.
 */
export function getExpectedCompletedExchangeSession(now = new Date()) {
  const nyDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const nyHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' }), 10)
  const nyMinutes = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }), 10)

  // Market closes at 16:00 ET; daily settlement and bar publication complete by 16:30 ET
  const isPostClose = nyHour > 16 || (nyHour === 16 && nyMinutes >= 30)

  let cursor = new Date(`${nyDateStr}T12:00:00Z`)

  if (!isPostClose) {
    cursor = new Date(cursor.getTime() - 86_400_000)
  }

  for (let i = 0; i < 15; i++) {
    const sessionStr = cursor.toISOString().slice(0, 10)
    if (isExchangeTradingDay(sessionStr)) {
      return sessionStr
    }
    cursor = new Date(cursor.getTime() - 86_400_000)
  }

  return cursor.toISOString().slice(0, 10)
}
