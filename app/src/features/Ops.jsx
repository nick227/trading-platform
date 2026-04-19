import { useEffect, useState } from 'react'
import opsService from '../api/services/opsService.js'

function formatAge(value) {
  if (!value) return 'n/a'
  const delta = Date.now() - new Date(value).getTime()
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

function statusTone(status) {
  if (status === 'up' || status === 'ready') return '#0a7a47'
  if (status === 'failed' || status === 'degraded') return '#c0392b'
  return '#8a6d1f'
}

export default function Ops() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const data = await opsService.getOverview()
      if (mounted) {
        setOverview(data)
        setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, 5_000)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  const summary = overview?.summary ?? {}
  const workers = overview?.workers ?? []
  const staleWorkers = overview?.staleWorkers ?? []
  const partialFills = overview?.partialFills ?? []
  const audits = overview?.recentAudits ?? []

  return (
    <div className="page container" style={{ maxWidth: 1320, margin: '0 auto', padding: '1.5rem' }}>
      <header style={{
        marginBottom: '1.5rem',
        padding: '1.25rem 1.5rem',
        borderRadius: '18px',
        background: 'linear-gradient(135deg, #102038 0%, #17395c 55%, #235d7a 100%)',
        color: 'white',
        boxShadow: '0 18px 40px rgba(16, 32, 56, 0.22)'
      }}>
        <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.72)', marginBottom: '0.5rem' }}>Operator Console</div>
        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 700 }}>Execution Ops</h1>
        <p style={{ margin: '0.5rem 0 0', maxWidth: 720, color: 'rgba(255,255,255,0.82)' }}>
          Queue health, active fills, worker heartbeats, and the latest immutable execution audit trail.
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '0.9rem', marginBottom: '1.5rem' }}>
        {[
          ['Workers', summary.workerCount ?? 0, 'live worker heartbeats'],
          ['Stale', summary.staleWorkerCount ?? 0, 'rows outside freshness window'],
          ['Queue Lag', `${Math.round((summary.queueLagMs ?? 0) / 1000)}s`, 'oldest queued execution'],
          ['Active', summary.activeExecutions ?? 0, 'queued + processing + submitted'],
          ['Partial Fills', summary.partialFills ?? 0, 'orders aging mid-fill'],
          ['Rejects Today', summary.rejectedToday ?? 0, 'broker or risk blocks']
        ].map(([label, value, hint]) => (
          <article key={label} style={{
            padding: '1rem',
            borderRadius: '16px',
            background: 'white',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
          }}>
            <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.45rem' }}>{label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{value}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>{hint}</div>
          </article>
        ))}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1rem' }}>
        <section style={{ display: 'grid', gap: '1rem' }}>
          <article style={{ background: 'white', borderRadius: '18px', padding: '1rem 1.1rem', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem' }}>Worker Health</h2>
              <span className="muted" style={{ fontSize: '0.8rem' }}>{loading ? 'Refreshing...' : 'Auto-refresh 5s'}</span>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {workers.length === 0 ? (
                <div className="muted">No worker heartbeat rows yet.</div>
              ) : workers.map((worker) => (
                <div key={worker.id} style={{
                  padding: '0.85rem 0.95rem',
                  borderRadius: '14px',
                  background: '#f7fafc',
                  border: '1px solid #e8eef5'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <strong>{worker.id}</strong>
                    <span className="muted">{formatAge(worker.lastSeen)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                    {Object.entries(worker.health ?? {}).map(([key, value]) => (
                      <span key={key} style={{
                        padding: '0.28rem 0.55rem',
                        borderRadius: '999px',
                        background: `${statusTone(value)}14`,
                        color: statusTone(value),
                        fontSize: '0.78rem',
                        fontWeight: 600
                      }}>
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem', fontSize: '0.82rem' }}>
                    <span>Queue lag: {Math.round((worker.queueLagMs ?? 0) / 1000)}s</span>
                    <span>REST: {formatAge(worker.lastRestOkAt)}</span>
                    <span>WS: {formatAge(worker.lastWsOkAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          {staleWorkers.length > 0 ? (
            <article style={{ background: 'white', borderRadius: '18px', padding: '1rem 1.1rem', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' }}>
              <h2 style={{ margin: '0 0 0.9rem', fontSize: '1rem' }}>Stale Workers</h2>
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {staleWorkers.map((worker) => (
                  <div key={worker.id} style={{
                    padding: '0.75rem 0.85rem',
                    borderRadius: '14px',
                    background: '#fff7f0',
                    border: '1px solid #f0d7bd'
                  }}>
                    <strong>{worker.id}</strong>
                    <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                      Last seen {formatAge(worker.lastSeen)}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <article style={{ background: 'white', borderRadius: '18px', padding: '1rem 1.1rem', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' }}>
            <h2 style={{ margin: '0 0 0.9rem', fontSize: '1rem' }}>Recent Execution Audits</h2>
            <div style={{ display: 'grid', gap: '0.6rem', maxHeight: 520, overflowY: 'auto' }}>
              {audits.map((audit) => (
                <div key={audit.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 1fr',
                  gap: '0.8rem',
                  padding: '0.75rem 0.85rem',
                  borderRadius: '14px',
                  background: '#fbfdff',
                  border: '1px solid #edf2f7'
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {audit.eventType.replaceAll('_', ' ')}
                    </div>
                    <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{formatAge(audit.createdAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{audit.detail}</div>
                    <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.28rem' }}>
                      {audit.executionId} {audit.workerId ? `• ${audit.workerId}` : ''}
                    </div>
                    {audit.metadata ? (
                      <pre style={{
                        margin: '0.5rem 0 0',
                        padding: '0.65rem',
                        borderRadius: '12px',
                        background: '#0f172a',
                        color: '#d8e7ff',
                        fontSize: '0.72rem',
                        overflowX: 'auto'
                      }}>
                        {JSON.stringify(audit.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section>
          <article style={{ background: 'white', borderRadius: '18px', padding: '1rem 1.1rem', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' }}>
            <h2 style={{ margin: '0 0 0.9rem', fontSize: '1rem' }}>Aging Partial Fills</h2>
            <div style={{ display: 'grid', gap: '0.7rem' }}>
              {partialFills.length === 0 ? (
                <div className="muted">No partially filled executions are currently aging.</div>
              ) : partialFills.map((execution) => (
                <div key={execution.id} style={{
                  padding: '0.85rem 0.95rem',
                  borderRadius: '14px',
                  background: '#fffaf1',
                  border: '1px solid #f2dfb0'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <strong>{execution.ticker}</strong>
                    <span>{formatAge(execution.createdAt)}</span>
                  </div>
                  <div className="muted" style={{ marginTop: '0.45rem', fontSize: '0.82rem' }}>
                    {execution.id} • {execution.direction} • {execution.filledQuantity ?? 0}/{execution.quantity}
                  </div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.84rem' }}>
                    Broker status: <strong>{execution.brokerStatus ?? execution.status}</strong>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}
