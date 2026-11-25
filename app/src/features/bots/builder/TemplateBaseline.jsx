import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadPublicStrategy, summaryLine } from '../../strategies/strategiesApi'

/** The behaviour a platform test covers — not symbols, capital or name, which every user sets. */
export function behaviourKey(d) {
  if (!d) return ''
  const { direction, triggerType, trigger, marketHours, cooldown, positionLimit, dailyLoss, relVolume, priceChange, research, exit } = d
  return JSON.stringify({ direction, triggerType, op: trigger?.operator, marketHours, cooldown, positionLimit, dailyLoss, relVolume, priceChange, research, exit })
}

/**
 * Workshop header for a new bot started from a platform strategy: its standardized result,
 * and a clear marker once the user's configuration departs from the tested defaults.
 */
export default function TemplateBaseline({ templateId, modified }) {
  const [s, setS] = useState(undefined)
  useEffect(() => {
    let live = true
    setS(undefined)
    loadPublicStrategy(templateId).then((x) => live && setS(x)).catch(() => live && setS(null))
    return () => { live = false }
  }, [templateId])
  if (!s) return null
  return (
    <div className={`tl-notice${modified ? ' tl-notice--warn' : ''}`} data-testid="template-baseline" style={{ marginBottom: 18 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <span>
          <strong>{modified ? 'Modified strategy' : 'Strategy defaults'}</strong>
          {' · '}
          {modified ? 'Backtest your changes' : `5-year backtest: ${summaryLine(s.summary?.['5Y'])}`}
        </span>
        <Link className="tl-small" to={`/strategies/${encodeURIComponent(templateId)}`}>Results and methodology →</Link>
      </div>
    </div>
  )
}
