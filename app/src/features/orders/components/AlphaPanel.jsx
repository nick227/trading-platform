function safeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

export default function AlphaPanel({ explainability, loading, selectedStock, compact = false }) {
  const shellClass = `card ${compact ? 'card-pad-sm' : 'card-pad-md'}`

  if (!selectedStock) {
    return (
      <article className={shellClass}>
        <div className="panel-empty">Select a stock to view engine rationale</div>
      </article>
    )
  }

  const alpha = explainability && typeof explainability === 'object' ? explainability : null
  const explanation = typeof alpha?.explanation === 'string' ? alpha.explanation : null
  const factors = safeList(alpha?.factors)
  const signals = safeList(alpha?.signals)

  const hasAny = Boolean(explanation) || factors.length > 0 || signals.length > 0

  return (
    <article className={shellClass}>
      <div className="panel-header">
        <h3 className="panel-title">Engine Rationale</h3>
      </div>

      {loading ? (
        <div className="panel-empty">Loading analysis...</div>
      ) : hasAny ? (
        <div className="stack-sm">
          {explanation ? (
            <div className="text-xs" style={{ lineHeight: 1.5 }}>
              {explanation}
            </div>
          ) : null}

          {factors.length > 0 ? (
            <div>
              <div className="eyebrow mb-0">Key factors</div>
              <div className="data-rows mt-2">
                {factors.slice(0, compact ? 4 : 8).map((f, idx) => (
                  <div key={idx} className="data-row-3 data-row-divider">
                    <span className="muted">{f.name ?? f.factor ?? f.key ?? 'Factor'}</span>
                    <span className="font-600">{f.value ?? f.score ?? '—'}</span>
                    <span className="muted text-right">{f.direction ?? f.signal ?? ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {signals.length > 0 ? (
            <div>
              <div className="eyebrow mb-0">Signals</div>
              <div className="text-xs muted mt-2">{signals.slice(0, compact ? 6 : 12).join(' · ')}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="panel-empty">No engine rationale available.</div>
      )}
    </article>
  )
}
