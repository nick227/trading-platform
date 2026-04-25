import { useEffect, useMemo, useState } from 'react'
import alphaEngineService from '../../../api/services/alphaEngineService.js'

function safeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function titleCase(value) {
  if (!value || typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null
  return v.slice(0, 1).toUpperCase() + v.slice(1).toLowerCase()
}

function KV({ label, value }) {
  return (
    <div>
      <div className="muted text-xs">{label}</div>
      <div className="font-600">{value ?? '—'}</div>
    </div>
  )
}

export default function ResearchPanel({ selectedStock }) {
  const symbol = selectedStock?.symbol

  const [loading, setLoading] = useState(false)
  const [row, setRow] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!symbol) return

    let cancelled = false
    setLoading(true)
    setError(null)

    // Use ticker-specific endpoint instead of fetching all 100 rankings
    alphaEngineService.getTickerExplainability(symbol)
      .then((data) => {
        if (cancelled) return
        // Transform explainability data to match expected row structure
        setRow({
          symbol,
          rank: data?.rank ?? null,
          peerCount: data?.peerCount ?? null,
          rankContext: data?.factors ? {
            basis: data?.factors?.map(f => f.description) || [],
            timing: [],
            risks: [],
            invalidators: []
          } : null
        })
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || 'Research unavailable')
        setRow(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [symbol])

  const rankContext = row?.rankContext && typeof row.rankContext === 'object' ? row.rankContext : null
  const basis = safeList(rankContext?.basis)
  const timing = safeList(rankContext?.timing)
  const risks = safeList(rankContext?.risks)
  const invalidators = safeList(rankContext?.invalidators)

  const lifecycle = useMemo(() => {
    return {
      status: titleCase(rankContext?.status),
      horizon: titleCase(rankContext?.horizon),
      fit: titleCase(rankContext?.fit),
      durability: titleCase(rankContext?.durability),
      freshness: titleCase(rankContext?.freshness),
      pressure: titleCase(rankContext?.pressure),
      trigger: titleCase(rankContext?.trigger),
    }
  }, [rankContext])

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Research</h3>
      </div>

      {!selectedStock ? (
        <div className="panel-empty">Select a stock to view research</div>
      ) : loading ? (
        <div className="panel-empty">Loading research...</div>
      ) : error ? (
        <div className="panel-empty">{error}</div>
      ) : (
        <div className="stack-md">
          {row ? (
            <>
              <div className="l-grid-4cols">
                <KV label="Rank" value={row.peerCount ? `${row.rank} / ${row.peerCount}` : row.rank} />
                <KV label="Status" value={lifecycle.status} />
                <KV label="Horizon" value={lifecycle.horizon} />
                <KV label="Fit" value={lifecycle.fit} />
              </div>

              <div className="l-grid-4cols">
                <KV label="Durability" value={lifecycle.durability} />
                <KV label="Freshness" value={lifecycle.freshness} />
                <KV label="Pressure" value={lifecycle.pressure} />
                <KV label="Trigger" value={lifecycle.trigger} />
              </div>

              {basis.length > 0 && (
                <div>
                  <div className="eyebrow mb-0">Why it ranks here</div>
                  <ul className="list mt-2 text-xs">
                    {basis.slice(0, 6).map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}

              {timing.length > 0 && (
                <div>
                  <div className="eyebrow mb-0">What changed</div>
                  <ul className="list mt-2 text-xs">
                    {timing.slice(0, 6).map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}

              {(risks.length > 0 || invalidators.length > 0) && (
                <div>
                  <div className="eyebrow mb-0">Risks & invalidators</div>
                  {risks.length > 0 && (
                    <ul className="list mt-2 text-xs">
                      {risks.slice(0, 6).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  )}
                  {invalidators.length > 0 && (
                    <div className="text-xs muted mt-2">
                      <span className="font-600">Invalidators:</span> {invalidators.slice(0, 6).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="muted text-xs">Ranking context not available for this ticker.</div>
          )}

        </div>
      )}
    </article>
  )
}
