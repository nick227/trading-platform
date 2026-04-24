import { useEffect, useMemo, useState } from 'react'
import { alphaFetch } from '../../../api/services/alphaEngineService.js'

function fmtAsOf(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtPct(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

function fmtNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString()
}

export default function EngineSignalsPanel({ selectedStock }) {
  const symbol = selectedStock?.symbol

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [regime, setRegime] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [consensus, setConsensus] = useState(null)
  const [attribution, setAttribution] = useState(null)

  useEffect(() => {
    if (!symbol) return

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.allSettled([
      alphaFetch(`/api/regime/${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/ticker/${encodeURIComponent(symbol)}/accuracy`),
      alphaFetch(`/api/consensus/signals?ticker=${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/ticker/${encodeURIComponent(symbol)}/attribution`),
    ]).then((results) => {
      if (cancelled) return

      const [regimeRes, accuracyRes, consensusRes, attributionRes] = results
      setRegime(regimeRes.status === 'fulfilled' ? regimeRes.value : null)
      setAccuracy(accuracyRes.status === 'fulfilled' ? accuracyRes.value : null)
      setConsensus(consensusRes.status === 'fulfilled' ? consensusRes.value : null)
      setAttribution(attributionRes.status === 'fulfilled' ? attributionRes.value : null)

      const hasAny = results.some((r) => r.status === 'fulfilled')
      if (!hasAny) setError('Engine signals unavailable')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [symbol])

  const drivers = useMemo(() => {
    if (Array.isArray(attribution?.drivers)) return attribution.drivers
    if (Array.isArray(attribution?.items)) return attribution.items
    if (Array.isArray(attribution)) return attribution
    return []
  }, [attribution])

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Engine Signals</h3>
      </div>

      {!selectedStock ? (
        <div className="panel-empty">Select a stock to view signals</div>
      ) : loading ? (
        <div className="panel-empty">Loading signals…</div>
      ) : error ? (
        <div className="panel-empty">{error}</div>
      ) : (
        <div className="stack-sm">
          <div className="data-rows">
            <div className="data-row-3 data-row-divider">
              <span className="muted">Regime</span>
              <span style={{ fontWeight: 700 }}>{regime?.regime ?? regime?.state ?? regime?.name ?? '—'}</span>
              <span className="muted text-right">{regime?.asOf ? fmtAsOf(regime.asOf) : ' '}</span>
            </div>
            <div className="data-row-3 data-row-divider">
              <span className="muted">Hit Rate</span>
              <span style={{ fontWeight: 700 }}>
                {accuracy?.hitRate != null ? fmtPct((accuracy.hitRate <= 1 ? accuracy.hitRate * 100 : accuracy.hitRate)) : '—'}
              </span>
              <span className="muted text-right">{accuracy?.sampleCount != null ? `${fmtNumber(accuracy.sampleCount)} samples` : ' '}</span>
            </div>
            <div className="data-row-3 data-row-divider">
              <span className="muted">Residual Alpha</span>
              <span style={{ fontWeight: 700 }}>{accuracy?.residualAlpha != null ? fmtPct(accuracy.residualAlpha) : '—'}</span>
              <span className="muted text-right">{accuracy?.pFinal != null ? `pFinal ${accuracy.pFinal}` : ' '}</span>
            </div>
            {(consensus?.pFinal != null || consensus?.agreementBonus != null || consensus?.consensusStalenessMinutes != null) ? (
              <div className="data-row-3 data-row-divider">
                <span className="muted">Consensus</span>
                <span style={{ fontWeight: 700 }}>
                  {consensus?.pFinal != null ? `pFinal ${consensus.pFinal}` : '—'}
                </span>
                <span className="muted text-right">
                  {consensus?.agreementBonus != null
                    ? `+${consensus.agreementBonus}`
                    : consensus?.consensusStalenessMinutes != null
                      ? `${consensus.consensusStalenessMinutes}m stale`
                      : ' '}
                </span>
              </div>
            ) : null}
          </div>

          {drivers.length > 0 ? (
            <div>
              <div className="eyebrow mb-0">Attribution</div>
              <div className="data-rows mt-2">
                {drivers.slice(0, 6).map((d, idx) => (
                  <div key={idx} className="data-row-divider">
                    <div className="font-600">
                      {d.category ?? d.group ?? '—'} · {d.direction ?? '—'} · {d.materiality ?? d.weight ?? '—'}
                    </div>
                    <div className="muted">
                      {Array.isArray(d.tags) ? d.tags.join(', ') : d.tags ?? d.concepts ?? ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="muted text-xs">No attribution available.</div>
          )}
        </div>
      )}
    </article>
  )
}
