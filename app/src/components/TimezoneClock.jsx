import { useState, useEffect } from 'react'

export default function TimezoneClock() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [userTimezone, setUserTimezone] = useState('')

  useEffect(() => {
    // Update time every second
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    // Get user timezone with fallback
    let timezone
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      // Test if timezone is valid
      new Date().toLocaleTimeString('en-US', { timeZone: timezone })
    } catch (error) {
      console.warn('Invalid timezone detected, using fallback:', error)
      timezone = 'UTC' // Fallback to UTC
    }
    setUserTimezone(timezone)

    return () => clearInterval(timer)
  }, [])

  const formatTime = (date, timezone, showTimezone = true) => {
    try {
      return date.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: showTimezone ? 'short' : undefined
      })
    } catch (error) {
      console.warn('Timezone formatting error, using UTC:', error)
      return date.toLocaleTimeString('en-US', {
        timeZone: 'UTC',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: showTimezone ? 'short' : undefined
      })
    }
  }

  const formatDate = (date, timezone) => {
    try {
      return date.toLocaleDateString('en-US', {
        timeZone: timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    } catch (error) {
      console.warn('Date timezone formatting error, using UTC:', error)
      return date.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    }
  }

  const getETTime = () => {
    return formatTime(currentTime, 'America/New_York', false)
  }

  const getUTCTime = () => {
    return formatTime(currentTime, 'UTC', false)
  }

  const getUserTime = () => {
    return formatTime(currentTime, userTimezone, false)
  }

  const isMarketOpen = () => {
    const etTime = new Date(currentTime.toLocaleString("en-US", {timeZone: "America/New_York"}))
    const day = etTime.getDay()
    const hours = etTime.getHours()
    const minutes = etTime.getMinutes()
    
    // Weekend check
    if (day === 0 || day === 6) return false
    
    // Market hours: 9:30 AM - 4:00 PM ET
    return (hours > 9 || (hours === 9 && minutes >= 30)) && hours < 16
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      padding: '0.5rem 0.75rem',
      fontSize: '12px'
    }}>
      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '11px', color: '#666' }}>
        <div>
          {isMarketOpen() ? 'Market Open' : 'Market Closed'}: 
        </div>
        <div>
          {getUserTime()}
        </div>
        <div>
          
          {formatDate(currentTime, userTimezone)}
        </div>
      </div>
      <div style={{ fontSize: '10px', color: '#999', textAlign: 'center' }}>
        
      </div>
    </div>
  )
}
