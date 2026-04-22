import { useEffect, useState } from 'react'

export default function BankrollDisplay() {
  const [bankroll, setBankroll] = useState({
    cash: 10000,
    queuedFunds: 0,
    total: 10000,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadBankroll = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500))
        setBankroll({
          cash: 10000,
          queuedFunds: 2500,
          total: 12500,
        })
      } catch (error) {
        console.error('Failed to load bankroll:', error)
      } finally {
        setLoading(false)
      }
    }

    loadBankroll()
  }, [])

  const positionSizing = useMemo(() => {
    const low = Math.round(bankroll.total * 0.01)
    const high = Math.round(bankroll.total * 0.02)
    return { low, high }
  }, [bankroll.total])

  if (loading) {
    return <div className="panel-empty">Loading account balance…</div>
  }

  return (
    <article className="subcard">
      <div className="panel-header">
        <h4 className="panel-title">Your Available Capital</h4>
      </div>

      <div className="stack-sm text-sm">
        <div className="kv">
          <span className="kv-key">Available cash</span>
          <span className="font-600">${bankroll.cash.toLocaleString()}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Queued funds</span>
          <span className="font-600">${bankroll.queuedFunds.toLocaleString()}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Total capital</span>
          <span className="font-700">${bankroll.total.toLocaleString()}</span>
        </div>
      </div>

      <div className="alert alert-warn mt-4">
        <div className="alert-title">Position sizing guide</div>
        <div className="text-sm">
          For ${bankroll.total.toLocaleString()} total capital, consider ${positionSizing.low.toLocaleString()}-${positionSizing.high.toLocaleString()} per
          trade (1-2% risk).
        </div>
      </div>
    </article>
  )
}
