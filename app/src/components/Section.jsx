import useSectionData from '../hooks/useSectionData.js'
import SectionState from './SectionState.jsx'
import SectionHeader from './SectionHeader.jsx'
import { useEffect } from 'react'

export default function Section({ title, fetcher, render, skeleton, emptyMessage = 'No data available.', right, onData }) {
  const { data, loading, isRefreshing, error, retry } = useSectionData(fetcher)

  useEffect(() => {
    if (typeof onData === 'function' && data != null) {
      onData(data)
    }
  }, [data, onData])

  return (
    <article className="card card-pad-sm">
      <SectionHeader title={title} right={right || ''} />
      <SectionState
        loading={loading}
        isRefreshing={isRefreshing}
        error={error}
        onRetry={retry}
        skeleton={skeleton}
      >
        {!data || (Array.isArray(data) && data.length === 0) ? (
          <div className="muted mt-2">{emptyMessage}</div>
        ) : (
          render(data)
        )}
      </SectionState>
    </article>
  )
}
