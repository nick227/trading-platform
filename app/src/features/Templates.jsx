import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBotCatalog } from '../api/services/botCatalogService.js'

export default function Templates() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState('all')

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

  // Memoized catalog processing with Object.assign optimization
  const catalogItems = useMemo(() => {
    const items = []
    
    if (catalog?.ruleBased) {
      for (const item of catalog.ruleBased) {
        items.push(Object.assign({}, item, { type: 'RULE_BASED' }))
      }
    }
    
    if (catalog?.strategyBased) {
      for (const item of catalog.strategyBased) {
        items.push(Object.assign({}, item, { type: 'STRATEGY_BASED' }))
      }
    }
    
    return items
  }, [catalog])

  const filteredItems = useMemo(() => 
    selectedCategory === 'all' ? catalogItems : catalogItems.filter((item) => item.category === selectedCategory),
    [catalogItems, selectedCategory]
  )

  const categories = useMemo(() => {
    const categorySet = new Set(['all'])
    for (const item of catalogItems) {
      if (item.category) categorySet.add(item.category)
    }
    return Array.from(categorySet)
  }, [catalogItems])

  const toSlug = useCallback((name) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''), [])

  const handleCategorySelect = useCallback((category) => {
    setSelectedCategory(category)
  }, [])

  const handleViewDetails = useCallback((slug) => {
    navigate(`/templates/${slug}`)
  }, [navigate])

  const handleUseTemplate = useCallback((item) => {
    navigate('/bots/create', { 
      state: { 
        defaultTemplate: item,
        defaultConfig: { tickers: ['SPY'] }
      } 
    })
  }, [navigate])

  return (
    <div className="l-page">
      <div className="container">
        <header className="stack-sm mb-6">
          <h1 className="hero mb-2">Bot Templates</h1>
          <p className="muted measure-md text-md mb-3">
            Browse and discover proven strategies to deploy as automated bots.
          </p>

          <div className="wrap">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={selectedCategory === category ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
                onClick={() => handleCategorySelect(category)}
              >
                {category === 'all' ? 'All Templates' : category}
              </button>
            ))}
          </div>
        </header>

        <section className="section">
          {loading ? (
            <div className="panel-empty">Loading templates…</div>
          ) : filteredItems.length === 0 ? (
            <div className="panel-empty">No templates found in this category.</div>
          ) : (
            <div className="stack-lg">
              {filteredItems.map((item) => {
                const typeLabel = item.type === 'RULE_BASED' ? 'Rules' : 'Strategy'
                const typeBadge = item.type === 'RULE_BASED' ? 'badge badge-positive badge-xs' : 'badge badge-soft badge-xs'

                return (
                  <article key={item.id} className="card card-pad-md card-outline">
                    <div className="panel-header">
                      <div className="hstack">
                        <h3 className="panel-title">{item.name}</h3>
                        <span className={typeBadge}>{typeLabel}</span>
                      </div>
                      <div className="btn-group">
                        <button
                          type="button"
                          className="btn btn-xs btn-primary"
                          onClick={() => handleViewDetails(toSlug(item.id))}
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => handleUseTemplate(item)}
                        >
                          Use Template
                        </button>
                      </div>
                    </div>

                    <p className="muted text-sm m-0 mb-3">
                      {item.description || 'A proven trading strategy designed for automated execution.'}
                    </p>

                    <div className="meta-row">
                      <span>Category: {item.category}</span>
                      {item.metadata?.cadence && <span>Cadence: {item.metadata.cadence}</span>}
                      {item.metadata?.edge && <span className="text-positive font-600">Edge: {item.metadata.edge}</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

