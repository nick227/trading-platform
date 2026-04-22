import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getBotCatalog } from '../api/services/botCatalogService.js'

export default function TemplateDetails() {
  const navigate = useNavigate()
  const { templateSlug } = useParams()
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const data = await getBotCatalog()
        const allItems = [
          ...(Array.isArray(data?.ruleBased) ? data.ruleBased : []).map((item) => ({ ...item, type: 'RULE_BASED' })),
          ...(Array.isArray(data?.strategyBased) ? data.strategyBased : []).map((item) => ({ ...item, type: 'STRATEGY_BASED' })),
        ]

        const found = allItems.find((item) => {
          const slug = item.id.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
          return slug === templateSlug
        })

        setTemplate(found ?? null)
      } catch (error) {
        console.error('Failed to load template:', error)
        setTemplate(null)
      } finally {
        setLoading(false)
      }
    }
    loadTemplate()
  }, [templateSlug])

  if (loading) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">Loading template details…</div>
        </div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">
            <h2 className="m-0 mb-2">Template Not Found</h2>
            <p className="muted m-0 mb-3">The requested template could not be found.</p>
            <button className="btn btn-sm btn-primary" type="button" onClick={() => navigate('/templates')}>
              Browse Templates
            </button>
          </div>
        </div>
      </div>
    )
  }

  const typeLabel = template.type === 'RULE_BASED' ? 'Rules-Based' : 'Strategy-Based'
  const typeBadge = template.type === 'RULE_BASED' ? 'badge badge-positive' : 'badge badge-soft'

  return (
    <div className="l-page">
      <div className="container">
        <header className="stack-sm mb-6">
          <button className="btn btn-xs btn-ghost" type="button" onClick={() => navigate('/templates')}>
            ← Back to Templates
          </button>

          <div className="hstack">
            <h1 className="hero m-0">{template.name}</h1>
            <span className={typeBadge}>{typeLabel}</span>
          </div>

          <p className="muted text-md m-0 measure-md">
            {template.description || 'A proven trading strategy designed for automated execution.'}
          </p>
        </header>

        <div className="l-grid-2wide">
          <section className="stack-lg">
            <article className="card card-pad-md">
              <div className="panel-header">
                <h2 className="panel-title">Strategy Overview</h2>
              </div>
              <p className="text-sm m-0 mb-4">
                This template uses <span className="font-600">{template.category}</span> signals to identify trading
                opportunities with <span className="font-600">{template.metadata?.edge || 'a measurable edge'}</span>.
              </p>

              <div>
                <div className="text-sm font-600 mb-2">Key features</div>
                <ul className="list text-sm">
                  <li>Automated signal generation</li>
                  <li>Risk management parameters</li>
                  <li>Performance tracking</li>
                  <li>Customizable configuration</li>
                  {template.metadata?.cadence && <li>Execution cadence: {template.metadata.cadence}</li>}
                </ul>
              </div>
            </article>

            <article className="card card-pad-md">
              <div className="panel-header">
                <h2 className="panel-title">Performance Metrics</h2>
              </div>

              <div className="l-grid-auto-200">
                <div className="tile">
                  <div className="tile-value text-positive">+12.4%</div>
                  <div className="tile-label">Avg Annual Return</div>
                </div>
                <div className="tile">
                  <div className="tile-value">68%</div>
                  <div className="tile-label">Win Rate</div>
                </div>
                <div className="tile">
                  <div className="tile-value muted">1.8</div>
                  <div className="tile-label">Sharpe Ratio</div>
                </div>
              </div>
            </article>
          </section>

          <aside className="stack-lg">
            <article className="card card-pad-md">
              <div className="panel-header">
                <h3 className="panel-title">Template Info</h3>
              </div>

              <div className="stack-sm text-sm">
                <div className="kv">
                  <span className="kv-key">Category</span>
                  <span className="font-600">{template.category}</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Type</span>
                  <span className="font-600">{template.type.replace('_', ' ')}</span>
                </div>
                {template.metadata?.cadence && (
                  <div className="kv">
                    <span className="kv-key">Cadence</span>
                    <span className="font-600">{template.metadata.cadence}</span>
                  </div>
                )}
                {template.metadata?.edge && (
                  <div className="kv">
                    <span className="kv-key">Edge</span>
                    <span className="font-600 text-positive">{template.metadata.edge}</span>
                  </div>
                )}
              </div>
            </article>

            <article className="card card-inverse card-pad-md">
              <div className="stack-sm">
                <h3 className="m-0">Ready to deploy?</h3>
                <p className="text-sm opacity-84 m-0">
                  Configure this template with your preferred assets and risk parameters to create your automated trading
                  bot.
                </p>
              </div>
              <button
                className="btn btn-sm btn-primary btn-block mt-4"
                type="button"
                onClick={() =>
                  navigate('/bots/create', {
                    state: {
                      defaultTemplate: template,
                      defaultConfig: { tickers: ['SPY'] },
                    },
                  })
                }
              >
                Create Bot from Template
              </button>
            </article>
          </aside>
        </div>
      </div>
    </div>
  )
}

