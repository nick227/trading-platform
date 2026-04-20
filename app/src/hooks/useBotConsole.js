import { useState, useCallback } from 'react'
import { get, post } from '../api/client.js'
import { usePolling } from './usePolling.js'

/**
 * Encapsulates bot status polling and bot control actions.
 * Extracted from Portfolio.jsx to keep it a pure display component.
 *
 * onAction — optional callback invoked after run-once or toggle, e.g. to refetch portfolio.
 */
export function useBotConsole({ onAction } = {}) {
  const [botStatus, setBotStatus] = useState('idle')
  const [todayPNL,  setTodayPNL]  = useState(0)

  const fetchBotData = useCallback(async () => {
    const [statusRes, pnlRes] = await Promise.allSettled([
      get('/bot/status'),
      get('/performance/today'),
    ])
    if (statusRes.status === 'fulfilled') setBotStatus(statusRes.value?.status ?? 'idle')
    if (pnlRes.status   === 'fulfilled') setTodayPNL(pnlRes.value?.pnl ?? 0)
  }, [])

  usePolling(fetchBotData, 30000)

  const runOnce = useCallback(async () => {
    try {
      await post('/bot/run-once')
      onAction?.()
    } catch (err) {
      console.error('Run once failed:', err)
    }
  }, [onAction])

  const toggleBot = useCallback(async () => {
    try {
      await post(botStatus === 'running' ? '/bot/stop' : '/bot/start')
      onAction?.()
    } catch (err) {
      console.error('Toggle bot failed:', err)
    }
  }, [botStatus, onAction])

  return { botStatus, todayPNL, runOnce, toggleBot }
}
