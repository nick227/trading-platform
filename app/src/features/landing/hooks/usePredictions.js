import { useEffect, useMemo, useState } from 'react'
import { get } from '../../../api/client.js'
import { buildPredictionCard } from '../../../utils/predictions.js'
import { API, DEFER_MS, MAX_PREDICTION_CARDS } from '../constants.js'

export function usePredictions({ defer = DEFER_MS.predictions } = {}) {
  const [index, setIndex] = useState({ loading: false, error: null, items: [] })
  const [contexts, setContexts] = useState({ loading: false, error: null, items: [] })

  // Fetch the predictions index (light — just IDs + confidence scores)
  useEffect(() => {
    let cancelled = false
    setIndex({ loading: true, error: null, items: [] })
    const load = () => {
      get(API.PREDICTIONS)
        .then((rows) => {
          if (cancelled) return
          setIndex({ loading: false, error: null, items: Array.isArray(rows) ? rows : [] })
        })
        .catch((error) => {
          if (cancelled) return
          setIndex({ loading: false, error: error?.message || 'Failed to load predictions', items: [] })
        })
    }
    const t = setTimeout(load, defer)
    return () => { cancelled = true; clearTimeout(t) }
  }, [defer])

  // Pick the top N IDs by confidence, stable identity for the context-fetch effect
  const idsToLoad = useMemo(() => {
    const sorted = [...(index.items ?? [])].sort((a, b) => {
      const cd = (Number(b?.confidence ?? 0) || 0) - (Number(a?.confidence ?? 0) || 0)
      if (cd !== 0) return cd
      return (Number(b?.predictedAt ?? b?.createdAt ?? 0) || 0) -
             (Number(a?.predictedAt ?? a?.createdAt ?? 0) || 0)
    })
    const ids = []
    for (const row of sorted) {
      const id = String(row?.id ?? '').trim()
      if (!id || ids.includes(id)) continue
      ids.push(id)
      if (ids.length >= MAX_PREDICTION_CARDS) break
    }
    return ids
  }, [index.items])

  // Fetch full context for each selected prediction
  useEffect(() => {
    if (idsToLoad.length === 0) {
      const msg = index.loading ? null
        : index.error        ? index.error
        : 'No predictions available'
      setContexts({ loading: false, error: msg, items: [] })
      return
    }
    let cancelled = false
    setContexts((prev) => ({ ...prev, loading: true, error: null }))
    Promise.allSettled(
      idsToLoad.map((id) => get(API.PREDICTION_CONTEXT(id)).then((ctx) => ({ id, ctx })))
    ).then((results) => {
      if (cancelled) return
      const items = results
        .filter((r) => r.status === 'fulfilled' && r.value?.ctx)
        .map((r) => ({ id: r.value.id, ...r.value.ctx }))
      setContexts({
        loading: false,
        error: items.length ? null : 'No prediction context available',
        items,
      })
    }).catch((error) => {
      if (cancelled) return
      setContexts({ loading: false, error: error?.message || 'Failed to load predictions', items: [] })
    })
    return () => { cancelled = true }
  }, [idsToLoad.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const predictionCards = useMemo(() =>
    contexts.items
      .map(buildPredictionCard)
      .filter((c) => c.ticker)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, MAX_PREDICTION_CARDS),
    [contexts.items]
  )

  return {
    predictionCards,
    loading: index.loading || contexts.loading,
    error:   contexts.error,
  }
}
