import { useEffect, useMemo, useState } from 'react'
import { get } from '../../../api/client.js'

function fmtPct(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  return `${num.toFixed(1)}%`
}

function normalizePct(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num <= 1) return num * 100
  return num
}

export default function TopTemplatesPanel({ selectedStock, user }) {
  const symbol = selectedStock?.symbol

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!symbol || !user) return

    let cancelled = false
    setLoading(true)
    setError(null)

    get('/bots/catalog')
      .then(async (catalog) => {
        if (cancelled) return
        const grouped = catalog?.data ?? catalog
        const list = [
          ...(Array.isArray(grouped?.ruleBased) ? grouped.ruleBased : []),
          ...(Array.isArray(grouped?.strategyBased) ? grouped.strategyBased : [])
        ]

        const templates = list
          .map((t) => ({
            id: t.id ?? t.templateId ?? t.slug ?? null,
            name: t.name ?? t.title ?? 'Template',
            botType: t.botType ?? null,
          }))
          .filter((t) => Boolean(t.id))
          .slice(0, 12)

        const metrics = await Promise.allSettled(
          templates.map((t) => get(`/metrics/templates/${encodeURIComponent(t.id)}`).catch(() => null))
        )

        const enriched = templates.map((t, idx) => {
          const m = metrics[idx].status === 'fulfilled' ? metrics[idx].value : null
          const winRate = m?.metrics?.winRate ?? null
          const totalTrades = m?.metrics?.totalTrades ?? null
          const dataQuality = m?.dataQuality ?? null

          return {
            ...t,
            winRate: normalizePct(winRate),
            totalTrades,
            dataQuality
          }
        })

        // Sort: prefer templates with a real winRate, then by totalTrades.
        enriched.sort((a, b) => {
          const aw = a.winRate == null ? -1 : Number(a.winRate)
          const bw = b.winRate == null ? -1 : Number(b.winRate)
          if (bw !== aw) return bw - aw
          const at = a.totalTrades == null ? -1 : Number(a.totalTrades)
          const bt = b.totalTrades == null ? -1 : Number(b.totalTrades)
          return bt - at
        })

        setRows(enriched.slice(0, 5))
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || 'Templates unavailable')
        setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [symbol, user])

  const subtitle = useMemo(() => {
    if (!symbol) return ''
    return `for ${symbol}`
  }, [symbol])

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Top Templates</h3>
        <span className="text-xs muted">{subtitle}</span>
      </div>

      {!selectedStock ? (
        <div className="panel-empty">Select a stock to view templates</div>
      ) : !user ? (
        <div className="panel-empty">Sign in to view templates</div>
      ) : loading ? (
        <div className="panel-empty">Loading templates…</div>
      ) : error ? (
        <div className="panel-empty">{error}</div>
      ) : rows.length === 0 ? (
        <div className="panel-empty">No templates available</div>
      ) : (
        <div className="data-rows mt-2">
          {rows.map((t, idx) => (
            <div key={t.id} className="data-row-3 data-row-divider">
              <span>
                <span className="font-600">{t.name}</span>
                {idx === 0 ? <span className="muted text-xs ml-1">· Most used</span> : null}
              </span>
              <span className="muted">
                {(() => {
                  const quality = t.dataQuality ? String(t.dataQuality) : null
                  const hasHistory = t.totalTrades == null ? true : Number(t.totalTrades) > 0
                  const qualityAllowsRate = !quality || quality === 'sufficient' || quality === 'good' || quality === 'ok'

                  // Only show a WR if we have at least some trade history count.
                  // If the backend doesn't provide `totalTrades`, avoid showing "0.0% WR" which reads like a real stat.
                  if (t.totalTrades == null) return quality ? quality : '—'
                  if (!hasHistory) return quality ? quality : 'No history'
                  if (!qualityAllowsRate) return quality
                  if (t.winRate == null) return quality ? quality : '—'
                  return `${fmtPct(Number(t.winRate)) ?? '—'} WR`
                })()}
              </span>
              <span className="muted text-right text-nowrap">
                {t.totalTrades != null ? `${t.totalTrades} trades` : ' '}
              </span>
            </div>
          ))}
          <div className="muted text-xs mt-2">
            Note: template metrics are global unless a ticker-specific template endpoint is added.
          </div>
        </div>
      )}
    </article>
  )
}
