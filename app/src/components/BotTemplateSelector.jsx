import { useEffect, useState } from 'react'
import { getBotCatalog } from '../api/services/botCatalogService.js'

export default function BotTemplateSelector({ onSelect, selectedTemplate }) {
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const data = await getBotCatalog()
        setCatalog({
          ruleBased: Array.isArray(data?.ruleBased) ? data.ruleBased : [],
          strategyBased: Array.isArray(data?.strategyBased) ? data.strategyBased : [],
        })
      } catch (error) {
        console.error('Failed to load bot catalog:', error)
        setCatalog({ ruleBased: [], strategyBased: [] })
      } finally {
        setLoading(false)
      }
    }

    loadCatalog()
  }, [])

  const allItems = [
    ...(catalog?.ruleBased || []).map((item) => ({ ...item, type: 'RULE_BASED' })),
    ...(catalog?.strategyBased || []).map((item) => ({ ...item, type: 'STRATEGY_BASED' })),
  ]

  if (loading) {
    return <div className="panel-empty">Loading bot templates…</div>
  }

  if (allItems.length === 0) {
    return <div className="panel-empty">No templates or strategies available</div>
  }

  return (
    <div className="stack-sm">
      {allItems.map((item) => {
        const selected = selectedTemplate?.id === item.id
        const meta = [item.category === 'alpha_engine' ? 'Alpha Engine' : item.category, item.metadata?.cadence]
          .filter(Boolean)
          .join(' · ')

        return (
          <button
            key={item.id}
            type="button"
            className={`menu-item ${selected ? 'menu-item-selected' : ''}`}
            onClick={() => onSelect(item)}
          >
            <div className="stack-sm">
              <div className="text-sm font-600">{item.name}</div>
              <div className="text-xs muted">{meta}</div>
            </div>
            <div className="text-right">
              {item.metadata?.edge && <div className="text-xs font-600 text-positive">{item.metadata.edge}</div>}
              <div className="text-xs muted">{item.type === 'RULE_BASED' ? 'Rules' : 'Strategy'}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

