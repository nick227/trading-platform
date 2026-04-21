import { useState } from 'react'

const INPUT_STYLE = {
  width: '100%', 
  padding: '0.75rem',
  border: '1px solid #e9ecef', 
  borderRadius: '8px', 
  fontSize: '14px',
}

export default function DateTimePicker({ value, onChange, minDate = null, disabled = false }) {
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')

  // Initialize from value prop
  useState(() => {
    if (value) {
      const date = new Date(value)
      setDateValue(date.toISOString().split('T')[0]) // YYYY-MM-DD
      setTimeValue(date.toTimeString().slice(0, 5)) // HH:MM
    }
  })

  const handleDateChange = (e) => {
    const newDate = e.target.value
    setDateValue(newDate)
    updateCombinedDateTime(newDate, timeValue)
  }

  const handleTimeChange = (e) => {
    const newTime = e.target.value
    setTimeValue(newTime)
    updateCombinedDateTime(dateValue, newTime)
  }

  const updateCombinedDateTime = (date, time) => {
    if (date && time) {
      const dateTime = new Date(`${date}T${time}:00`)
      onChange(dateTime.toISOString())
    } else {
      onChange(null)
    }
  }

  const getMinDateTime = () => {
    if (minDate) {
      return minDate.toISOString().split('T')[0]
    }
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
      <div>
        <input
          type="date"
          value={dateValue}
          onChange={handleDateChange}
          min={getMinDateTime().split('T')[0]}
          disabled={disabled}
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <input
          type="time"
          value={timeValue}
          onChange={handleTimeChange}
          min="09:30"
          max="16:00"
          disabled={disabled}
          style={INPUT_STYLE}
        />
      </div>
    </div>
  )
}
