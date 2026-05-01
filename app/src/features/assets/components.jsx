import { useRef, useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { TABLE_ROW_H } from './constants.js'
import { throttle } from './utils.js'

export function VirtualRows({
  items,
  rowHeight = TABLE_ROW_H,
  height = 520,
  renderRow,
  renderHeader,
  headerHeight = 0,
  scrollerRef: externalScrollerRef = null
}) {
  const internalScrollerRef = useRef(null)
  const scrollerRef = externalScrollerRef ?? internalScrollerRef
  const [scrollTop, setScrollTop] = useState(0)

  const throttleRef = useRef(null)
  if (!throttleRef.current) {
    throttleRef.current = throttle((value) => setScrollTop(value), 16)
  }

  useEffect(() => {
    return () => {
      if (throttleRef.current?.cancel) {
        throttleRef.current.cancel()
      }
    }
  }, [])

  const totalHeight = items.length * rowHeight
  const effectiveScrollTop = scrollTop
  const startIndex = Math.max(0, Math.floor(effectiveScrollTop / rowHeight) - 6)
  const endIndex = Math.min(items.length, Math.ceil((effectiveScrollTop + height) / rowHeight) + 6)
  const slice = useMemo(() => items.slice(startIndex, endIndex), [items, startIndex, endIndex])

  return (
    <div
      ref={scrollerRef}
      style={{ height, overflow: 'auto', position: 'relative' }}
      onScroll={(e) => throttleRef.current(e.currentTarget.scrollTop)}
    >
      {renderHeader ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 3 }}>
          {renderHeader()}
        </div>
      ) : null}

      <div style={{ height: totalHeight, position: 'relative' }}>
        {slice.map((item, i) => {
          const idx = startIndex + i
          return (
            <div
              key={item?.ticker || item?.symbol || item?.id || idx}
              style={{
                position: 'absolute',
                top: idx * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight
              }}
            >
              {renderRow(item, idx)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SkeletonRows({ count = 10, rowHeight = TABLE_ROW_H }) {
  return (
    <div className="data-rows">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="data-row-asset data-row-action" style={{ height: rowHeight }}>
          <div className="skeleton-block" style={{ height: 12, width: 60 }} />
          <div className="skeleton-block" style={{ height: 12, width: '70%' }} />
          <div className="skeleton-block" style={{ height: 12, width: 90, justifySelf: 'end' }} />
        </div>
      ))}
    </div>
  )
}

export function TickerRow3({
  ticker,
  to,
  onOpen,
  price,
  special,
  specialClassName = 'muted text-ellipsis-one-line',
  priceClassName = 'muted text-right text-nowrap',
  divider = true,
  className = '',
  style,
  ...rest
}) {
  const tkr = String(ticker ?? '').toUpperCase()
  const href = to ?? `/orders?ticker=${encodeURIComponent(tkr)}`
  const dividerClass = divider ? 'data-row-divider' : ''

  return (
    <Link
      className={`btn-reset data-row-asset data-row-ticker3 data-row-action pressable ${dividerClass} ${className}`.trim()}
      to={href}
      onClick={onOpen}
      style={style}
      {...rest}
    >
      <strong className="text-nowrap">{tkr || '—'}</strong>
      <span className={priceClassName}>{price ?? '—'}</span>
      <span className={specialClassName} style={{ minWidth: 0 }}>
        {special ?? ' '}
      </span>
    </Link>
  )
}
