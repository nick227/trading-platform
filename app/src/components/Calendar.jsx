import { useState } from 'react'

export default function Calendar({ predictions = [] }) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(null)
  const [showModal, setShowModal] = useState(false)
  
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

  // Handle day click to show modal
  const handleDayClick = (date, dayPredictions) => {
    if (dayPredictions.length > 0) {
      setSelectedDate(date)
      setShowModal(true)
    }
  }

  // Close modal
  const closeModal = () => {
    setShowModal(false)
    setSelectedDate(null)
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
      const hasEvents = dayPredictions.length > 0
      
      days.push(
        <div
          key={day}
          className={`calendar-day ${isToday ? 'today' : ''} ${hasEvents ? 'has-events' : ''}`}
          onClick={() => handleDayClick(date, dayPredictions)}
          style={{ cursor: hasEvents ? 'pointer' : 'default' }}
        >
          <div className="calendar-day-number">{day}</div>
          
          {/* Show event count or small dots for multiple events */}
          {hasEvents && (
            <div className="calendar-events-indicator">
              {dayPredictions.length === 1 ? (
                <div 
                  className="calendar-prediction-badge"
                  style={{ 
                    backgroundColor: getTypeColor(dayPredictions[0].type),
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
                    {dayPredictions[0].type}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: '700' }}>
                    {dayPredictions[0].symbol}
                  </div>
                  <div style={{ fontSize: '9px', opacity: '0.9' }}>
                    {(dayPredictions[0].confidence * 100).toFixed(0)}%
                  </div>
                </div>
              ) : (
                <div style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '2px', 
                  justifyContent: 'center',
                  padding: '4px'
                }}>
                  {dayPredictions.slice(0, 4).map((pred, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: getTypeColor(pred.type),
                        minWidth: '8px'
                      }}
                    />
                  ))}
                  {dayPredictions.length > 4 && (
                    <div style={{ fontSize: '9px', color: '#7a7a7a', fontWeight: 600 }}>
                      +{dayPredictions.length - 4}
                    </div>
                  )}
                </div>
              )}
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

      {/* Event Details Modal */}
      {showModal && selectedDate && (
        <div 
          className="calendar-modal-overlay"
          onClick={closeModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div 
            className="calendar-modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              border: '1px solid #333'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#fff' }}>
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </h3>
              <button 
                onClick={closeModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#7a7a7a',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ color: '#cfcfcf' }}>
              {getPredictionsForDate(selectedDate).map((pred, idx) => (
                <div 
                  key={idx}
                  style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '6px',
                    padding: '12px',
                    marginBottom: '12px',
                    borderLeft: `4px solid ${getTypeColor(pred.type)}`
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span 
                        style={{
                          backgroundColor: getTypeColor(pred.type),
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600
                        }}
                      >
                        {pred.type}
                      </span>
                      <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                        {pred.symbol}
                      </span>
                    </div>
                    <span style={{ fontSize: '14px', color: '#7a7a7a' }}>
                      {(pred.confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#7a7a7a' }}>
                    {pred.date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
