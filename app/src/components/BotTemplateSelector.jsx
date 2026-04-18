import { useState, useEffect } from 'react'
import { getBotCatalog } from '../api/services/botCatalogService.js'

export default function BotTemplateSelector({ onSelect, ticker, selectedTemplate }) {
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const data = await getBotCatalog()
        setCatalog(data)
      } catch (error) {
        console.error('Failed to load bot catalog:', error)
      } finally {
        setLoading(false)
      }
    }
    loadCatalog()
  }, [])

  const handleTemplateSelect = (template) => {
    const config = {
      ...template.config?.defaultBotConfig,
      tickers: [ticker] // Always use current ticker
    }
    
    onSelect({
      type: template.type, // Use backend truth
      template,
      config
    })
  }

  // Flatten catalog for simple display
  const allItems = [
    ...catalog.ruleBased.map(item => ({ ...item, type: 'RULE_BASED' })),
    ...catalog.strategyBased.map(item => ({ ...item, type: 'STRATEGY_BASED' }))
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
        Loading bot templates...
      </div>
    )
  }

  return (
    <div style={{ background: 'white', borderRadius: 12, padding: '1rem', border: '1px solid #e5e7eb' }}>
      <h3 style={{ marginBottom: '1rem', fontSize: '16px', fontWeight: 600 }}>
        Create Bot for {ticker}
      </h3>

      {/* Template List */}
      <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
        {allItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#666', fontSize: '14px' }}>
            No templates or strategies available
          </div>
        ) : (
          allItems.map((item) => (
            <div
              key={item.id}
              className={`pressable ${selectedTemplate?.id === item.id ? 'selected' : ''}`}
              onClick={() => handleTemplateSelect(item)}
              style={{
                background: selectedTemplate?.id === item.id ? '#f0fdf4' : '#f9fafb',
                border: selectedTemplate?.id === item.id ? '1px solid #0a7a47' : '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '0.75rem',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{item.name}</div>
                  <div style={{ color: '#666', fontSize: '12px' }}>
                    {item.category === 'alpha_engine' ? 'Alpha Engine' : item.category}
                    {item.metadata?.cadence && ` · ${item.metadata.cadence}`}
                  </div>
                </div>
                {item.metadata?.edge && (
                  <div style={{ color: '#0a7a47', fontWeight: 600, fontSize: '13px' }}>
                    {item.metadata.edge}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {selectedTemplate && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>
            <strong>Selected:</strong> {selectedTemplate.name}
          </div>
          <div style={{ fontSize: '13px', color: '#666', marginTop: '0.25rem' }}>
            Will trade {ticker} with {selectedTemplate.config?.defaultBotConfig?.quantity || 10} shares
          </div>
        </div>
      )}
    </div>
  )
}
