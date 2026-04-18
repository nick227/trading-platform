import React from 'react'

export function DataFallback({ error, loading, children }) {
  if (loading) {
    return (
      <div style={{ 
        padding: '2rem', 
        textAlign: 'center', 
        color: '#6c757d'
      }}>
        <div>Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ 
        padding: '2rem', 
        textAlign: 'center', 
        color: '#dc3545',
        backgroundColor: '#f8d7da',
        border: '1px solid #f5c6cb',
        borderRadius: '4px',
        margin: '1rem'
      }}>
        <div>No data available</div>
        <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
          {error}
        </div>
      </div>
    )
  }

  if (!children || children.length === 0) {
    return (
      <div style={{ 
        padding: '2rem', 
        textAlign: 'center', 
        color: '#6c757d'
      }}>
        <div>No data available</div>
      </div>
    )
  }

  return children
}
