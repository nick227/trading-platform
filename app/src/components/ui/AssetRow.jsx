import { LineChart } from './LineChart'
import { Button } from './Button'

export function AssetRow({ asset, onOpen, onBot }) {
  const miniPoints = (asset.mini || []).map((y, index) => ({ x: String(index), y }))

  return (
    <article className="asset-row">
      <button className="asset-main" onClick={() => onOpen(asset.symbol)}>
        <div>
          <div className="asset-symbol">{asset.symbol}</div>
          <div className="muted">{asset.name}</div>
        </div>
        <div className="asset-mini">
          <LineChart points={miniPoints} compact />
        </div>
        <div className="asset-metrics">
          <strong>{asset.price}</strong>
          <span className="muted">{asset.change}</span>
        </div>
      </button>

      <div className="asset-actions">
        <Button variant="ghost" onClick={() => onOpen(asset.symbol)}>Open</Button>
        <Button onClick={() => onBot(asset.symbol)}>Bot</Button>
      </div>
    </article>
  )
}
