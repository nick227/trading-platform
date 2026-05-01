import { useEffect, useMemo, useState } from 'react'
import { get } from '../../../api/client.js'
import { transformCalendarEventsToPredictions } from '../../../utils/predictions.js'
import { API, DEFER_MS } from '../constants.js'

export function useCalendarEvents({ defer = DEFER_MS.calendar } = {}) {
  const [events, setEvents] = useState([])

  useEffect(() => {
    const load = async () => {
      try {
        const data = await get(API.CALENDAR)
        setEvents(data.events || [])
      } catch (err) {
        console.error('Failed to load calendar:', err)
      }
    }
    const t = setTimeout(load, defer)
    return () => clearTimeout(t)
  }, [defer])

  const calendarPredictions = useMemo(
    () => transformCalendarEventsToPredictions(events),
    [events]
  )

  return { calendarPredictions }
}
