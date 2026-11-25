import { describe, it, expect } from 'vitest'
import {
  getNyseHolidays,
  getNyseEarlyCloses,
  isExchangeTradingDay,
  isExchangeEarlyClose,
  getExpectedCompletedExchangeSession,
  EXCEPTIONAL_EXCHANGE_CLOSURES
} from '../../src/utils/marketCalendar.js'

describe('Market Calendar & Exchange Session Utilities', () => {
  it('correctly calculates the 10 regular NYSE holidays for 2026 with weekend observation rules', () => {
    const holidays2026 = getNyseHolidays(2026)
    
    // 1. New Year's Day (Thursday 2026-01-01)
    expect(holidays2026.has('2026-01-01')).toBe(true)
    // 2. MLK Day (Monday 2026-01-19)
    expect(holidays2026.has('2026-01-19')).toBe(true)
    // 3. Washington's Birthday (Monday 2026-02-16)
    expect(holidays2026.has('2026-02-16')).toBe(true)
    // 4. Good Friday (Friday 2026-04-03)
    expect(holidays2026.has('2026-04-03')).toBe(true)
    // 5. Memorial Day (Monday 2026-05-25)
    expect(holidays2026.has('2026-05-25')).toBe(true)
    // 6. Juneteenth (Friday 2026-06-19)
    expect(holidays2026.has('2026-06-19')).toBe(true)
    // 7. Independence Day (July 4 is Saturday -> observed Friday 2026-07-03)
    expect(holidays2026.has('2026-07-03')).toBe(true)
    // 8. Labor Day (Monday 2026-09-07)
    expect(holidays2026.has('2026-09-07')).toBe(true)
    // 9. Thanksgiving (Thursday 2026-11-26)
    expect(holidays2026.has('2026-11-26')).toBe(true)
    // 10. Christmas Day (Friday 2026-12-25)
    expect(holidays2026.has('2026-12-25')).toBe(true)

    expect(holidays2026.size).toBe(10)
  })

  it('identifies scheduled early-close sessions (13:00 ET close)', () => {
    const earlyCloses2026 = getNyseEarlyCloses(2026)

    // Black Friday (Friday 2026-11-27)
    expect(earlyCloses2026.has('2026-11-27')).toBe(true)
    expect(isExchangeEarlyClose('2026-11-27')).toBe(true)

    // Christmas Eve (Thursday 2026-12-24)
    expect(earlyCloses2026.has('2026-12-24')).toBe(true)
    expect(isExchangeEarlyClose('2026-12-24')).toBe(true)

    // Normal trading day is not an early close
    expect(isExchangeEarlyClose('2026-11-24')).toBe(false)
  })

  it('identifies valid trading days versus holidays, weekends, and exceptional closures', () => {
    // Normal Tuesday
    expect(isExchangeTradingDay('2026-11-24')).toBe(true)

    // Weekend (Saturday)
    expect(isExchangeTradingDay('2026-11-28')).toBe(false)

    // Thanksgiving holiday
    expect(isExchangeTradingDay('2026-11-26')).toBe(false)

    // Historical exceptional closure (President George H.W. Bush Funeral)
    expect(isExchangeTradingDay('2018-12-05')).toBe(false)
  })

  it('determines the expected completed exchange session accounting for 16:30 ET standard close', () => {
    // Tuesday post-close (2026-11-24 17:00 ET -> 22:00 UTC)
    const tuesdayPostClose = new Date('2026-11-24T22:00:00Z')
    expect(getExpectedCompletedExchangeSession(tuesdayPostClose)).toBe('2026-11-24')

    // Tuesday pre-close (2026-11-24 15:00 ET -> 20:00 UTC) -> steps back to Monday
    const tuesdayPreClose = new Date('2026-11-24T20:00:00Z')
    expect(getExpectedCompletedExchangeSession(tuesdayPreClose)).toBe('2026-11-23')

    // Sunday afternoon (2026-11-29 14:00 ET) -> steps back to Black Friday (2026-11-27)
    const sundayAfternoon = new Date('2026-11-29T19:00:00Z')
    expect(getExpectedCompletedExchangeSession(sundayAfternoon)).toBe('2026-11-27')
  })

  it('determines expected completed session on early-close days using 13:30 ET cutoff', () => {
    // Black Friday pre-cutoff (2026-11-27 12:30 ET -> 17:30 UTC): market is still open
    // Since Thursday (2026-11-26) was Thanksgiving, steps back to Wednesday (2026-11-25)
    const blackFridayPreClose = new Date('2026-11-27T17:30:00Z')
    expect(getExpectedCompletedExchangeSession(blackFridayPreClose)).toBe('2026-11-25')

    // Black Friday post-cutoff (2026-11-27 14:00 ET -> 19:00 UTC): early close is complete!
    const blackFridayPostClose = new Date('2026-11-27T19:00:00Z')
    expect(getExpectedCompletedExchangeSession(blackFridayPostClose)).toBe('2026-11-27')
  })
})
