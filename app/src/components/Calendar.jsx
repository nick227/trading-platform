import { useState } from 'react'

export default function Calendar({ predictions = [] }) {
  const [currentDate, setCurrentDate] = useState(new Date())
  
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  
  // Get first day of month and number of days
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()
  
  // Get predictions for a specific date
  const getPredictionsForDate = (date) => {
    return predictions.filter(pred => 
      pred.date.getDate() === date.getDate() &&
      pred.date.getMonth() === date.getMonth() &&
      pred.date.getFullYear() === date.getFullYear()
    )
  }
  
  // Navigate months
  const navigateMonth = (direction) => {
    setCurrentDate(new Date(year, month + direction, 1))
  }
  
  // Get color for prediction type
  const getTypeColor = (type) => {
    switch(type) {
      case 'BUY': return '#1f8a4c'
      case 'SELL': return '#c0392b'
      case 'HIGH': return '#6c5ce7'
      case 'WATCH': return '#f39c12'
      case 'EVENT': return '#e74c3c'
      default: return '#7a7a7a'
    }
  }
  
  // Generate calendar days
  const generateCalendarDays = () => {
    const days = []
    const today = new Date()
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>)
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      const dayPredictions = getPredictionsForDate(date)
      const isToday = date.toDateString() === today.toDateString()
      const primaryPrediction = dayPredictions[0] // Take only the first prediction
      
      days.push(
        <div
          key={day}
          className={`calendar-day ${isToday ? 'today' : ''}`}
        >
          <div className="calendar-day-number">{day}</div>
          
          {/* Single prediction filling the day square */}
          {primaryPrediction && (
            <div className="calendar-day-prediction">
              <div 
                className="calendar-prediction-badge"
                style={{ 
                  backgroundColor: getTypeColor(primaryPrediction.type),
                  color: 'white',
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  padding: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  textAlign: 'center',
                  lineHeight: '1.2'
                }}
              >
                <div style={{ fontSize: '11px', marginBottom: '2px' }}>
                  {primaryPrediction.type}
                </div>
                <div style={{ fontSize: '12px', fontWeight: '700' }}>
                  {primaryPrediction.symbol}
                </div>
                <div style={{ fontSize: '9px', opacity: '0.9' }}>
                  {(primaryPrediction.confidence * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          )}
        </div>
      )
    }
    
    return days
  }
  
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  
  return (
    <div className="calendar-container">
      {/* Calendar Header */}
      <div className="calendar-header">
        <button 
          className="calendar-nav-btn"
          onClick={() => navigateMonth(-1)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
        </button>
        
        <h3 className="calendar-title">
          {monthNames[month]} {year}
        </h3>
        
        <button 
          className="calendar-nav-btn"
          onClick={() => navigateMonth(1)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </button>
      </div>
      
      {/* Week Days Header */}
      <div className="calendar-weekdays">
        {weekDays.map(day => (
          <div key={day} className="calendar-weekday">
            {day}
          </div>
        ))}
      </div>
      
      {/* Calendar Grid */}
      <div className="calendar-grid">
        {generateCalendarDays()}
      </div>
    </div>
  )
}
