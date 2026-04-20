// Unified confidence styling system
// Consistent colors, badges, and formatting across all components

export const CONFIDENCE_COLORS = {
  // Action colors
  BUY: { bg: '#e8f5e8', text: '#0a7a47', border: '#0a7a47' },
  SELL: { bg: '#ffe6e6', text: '#c0392b', border: '#c0392b' },
  HOLD: { bg: '#fff3cd', text: '#856404', border: '#856404' },
  
  // Confidence level colors
  HIGH: { bg: '#d4edda', text: '#155724', border: '#28a745' },    // 80%+
  MEDIUM: { bg: '#fff3cd', text: '#856404', border: '#ffc107' },  // 60-79%
  LOW: { bg: '#f8d7da', text: '#721c24', border: '#dc3545' },     // <60%
  
  // Risk colors
  LOW_RISK: { bg: '#d1ecf1', text: '#0c5460', border: '#17a2b8' },
  MEDIUM_RISK: { bg: '#fff3cd', text: '#856404', border: '#ffc107' },
  HIGH_RISK: { bg: '#f8d7da', text: '#721c24', border: '#dc3545' }
}

export const getConfidenceLevel = (confidence) => {
  if (!confidence) return 'LOW'
  const percentage = confidence * 100
  if (percentage >= 80) return 'HIGH'
  if (percentage >= 60) return 'MEDIUM'
  return 'LOW'
}

export const getActionColors = (action) => {
  return CONFIDENCE_COLORS[action] || CONFIDENCE_COLORS.HOLD
}

export const getConfidenceColors = (confidence) => {
  const level = getConfidenceLevel(confidence)
  return CONFIDENCE_COLORS[level]
}

// Standard badge component
export default function ConfidenceBadge({ 
  action, 
  confidence, 
  size = 'medium', 
  showPercentage = true,
  style = {},
  ...props 
}) {
  const actionColors = getActionColors(action)
  const confidenceLevel = getConfidenceLevel(confidence)
  const confidenceColors = getConfidenceColors(confidence)
  
  const sizes = {
    small: { padding: '2px 6px', fontSize: '10px', fontWeight: 600 },
    medium: { padding: '4px 8px', fontSize: '12px', fontWeight: 600 },
    large: { padding: '6px 12px', fontSize: '14px', fontWeight: 700 }
  }
  
  const badgeStyle = {
    ...sizes[size],
    background: actionColors.bg,
    color: actionColors.text,
    border: `1px solid ${actionColors.border}`,
    borderRadius: '12px',
    display: 'inline-block',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    ...style
  }
  
  return (
    <div style={badgeStyle} {...props}>
      {action}
      {showPercentage && confidence && (
        <span style={{ marginLeft: '4px', opacity: 0.8 }}>
          {Math.round(confidence * 100)}%
        </span>
      )}
    </div>
  )
}

// Verdict badge with confidence level indicator
export function VerdictBadge({ verdict, loading = false, size = 'medium', style = {}, ...props }) {
  if (loading) {
    return (
      <div style={{
        background: '#f8f9fa',
        color: '#666',
        padding: size === 'small' ? '2px 6px' : '4px 8px',
        borderRadius: '12px',
        fontSize: size === 'small' ? '10px' : '12px',
        fontWeight: 600,
        textAlign: 'center',
        ...style
      }} {...props}>
        Loading...
      </div>
    )
  }
  
  if (!verdict) {
    return (
      <div style={{
        background: '#f8f9fa',
        color: '#999',
        padding: size === 'small' ? '2px 6px' : '4px 8px',
        borderRadius: '12px',
        fontSize: size === 'small' ? '10px' : '12px',
        fontWeight: 600,
        textAlign: 'center',
        ...style
      }} {...props}>
        No data
      </div>
    )
  }
  
  return (
    <div style={{ textAlign: 'center' }} {...props}>
      <ConfidenceBadge 
        action={verdict.action} 
        confidence={verdict.confidence} 
        size={size}
        style={{ marginBottom: '2px' }}
      />
      {size !== 'small' && (
        <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }}>
          {Math.round(verdict.confidence * 100)}% confident
        </div>
      )}
    </div>
  )
}

// Confidence meter component
export function ConfidenceMeter({ confidence, size = 'medium', style = {}, ...props }) {
  const confidenceLevel = getConfidenceLevel(confidence)
  const confidenceColors = getConfidenceColors(confidence)
  const percentage = Math.round((confidence || 0) * 100)
  
  const heights = {
    small: '6px',
    medium: '8px',
    large: '12px'
  }
  
  return (
    <div style={{ width: '100%', ...style }} {...props}>
      <div style={{
        background: '#e0e0e0',
        height: heights[size],
        borderRadius: heights[size],
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          background: confidenceColors.border,
          height: '100%',
          width: `${percentage}%`,
          borderRadius: heights[size],
          position: 'relative',
          transition: 'width 0.3s ease'
        }}>
          {size !== 'small' && percentage > 10 && (
            <div style={{
              position: 'absolute',
              right: '4px',
              top: size === 'large' ? '-8px' : '-6px',
              background: confidenceColors.border,
              color: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600
            }}>
              {percentage}%
            </div>
          )}
        </div>
      </div>
      {size !== 'small' && (
        <div style={{ 
          textAlign: 'center', 
          fontSize: '10px', 
          color: '#666', 
          marginTop: '4px' 
        }}>
          {confidenceLevel} Confidence
        </div>
      )}
    </div>
  )
}

// Risk badge component
export function RiskBadge({ risk = 'Medium', size = 'medium', style = {}, ...props }) {
  const riskMap = {
    'Low': 'LOW_RISK',
    'Medium': 'MEDIUM_RISK', 
    'High': 'HIGH_RISK'
  }
  
  const colors = CONFIDENCE_COLORS[riskMap[risk]] || CONFIDENCE_COLORS.MEDIUM_RISK
  
  const sizes = {
    small: { padding: '2px 6px', fontSize: '10px' },
    medium: { padding: '4px 8px', fontSize: '12px' },
    large: { padding: '6px 12px', fontSize: '14px' }
  }
  
  return (
    <div style={{
      ...sizes[size],
      background: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: '12px',
      fontWeight: 600,
      display: 'inline-block',
      textAlign: 'center',
      ...style
    }} {...props}>
      {risk} Risk
    </div>
  )
}
