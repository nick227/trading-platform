export const CARD_STYLE = {
  background: 'white',
  borderRadius: 24,
  padding: '1rem',
  boxShadow: '0 8px 26px rgba(0,0,0,0.05)',
}

export const SENTIMENT_COLORS = {
  bullish: '#1f8a4c',
  bearish: '#c0392b',
  neutral: '#6c757d',
  warning: '#f39c12',
  danger:  '#e74c3c',
}

export const API = {
  SIGNALS:            '/engine/signals/active',
  CALENDAR:           '/engine/calendar?limit=50&distribution=uniform&min_days=12',
  SPOT_QUOTES:        '/api/quotes?symbols=SPY,QQQ,IWM',
  REGIME:             '/api/regime/SPY',
  RANKINGS:           '/rankings/top?limit=25&maxFragility=0.40',
  MOVERS:             '/rankings/movers?limit=25',
  PREDICTIONS:        '/predictions',
  PREDICTION_CONTEXT: (id) => `/predictions/${encodeURIComponent(id)}/context`,
  RECS:               (cap, mode) => `/recommendations/under/${cap}?mode=${mode}&limit=25`,
}

export const DEFER_MS = {
  signals:     1000,
  calendar:    1500,
  predictions: 2000,
}

export const MAX_PREDICTION_CARDS = 6

export const GRID_2     = { display: 'grid', gridTemplateColumns: '1fr 1fr',    gap: '1rem' }
export const GRID_2_ASYM = { display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }
