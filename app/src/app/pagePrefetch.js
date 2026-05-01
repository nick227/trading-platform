import { get } from '../api/client.js'
import { alphaFetch } from '../api/services/alphaEngineService.js'
import { getAvailableStocks } from '../services/marketData.js'
import { prefetchPageData } from '../hooks/usePageData.js'

const POPULAR = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'BRK.B', 'SPY', 'QQQ', 'IWM']

function prefetchAssets() {
  return prefetchPageData({
    key: 'assets-page',
    fetcher: async () => {
      const quotesUrl = `/api/quotes?symbols=${POPULAR.join(',')}`
      await alphaFetch(quotesUrl)
      return true
    }
  }).catch(() => null)
}

function prefetchPortfolio() {
  return prefetchPageData({
    key: 'portfolio-page-prefetch',
    fetcher: async () => true
  }).catch(() => null)
}

function prefetchOrders() {
  return prefetchPageData({
    key: 'orders-page',
    fetcher: async () => {
      await Promise.allSettled([
        getAvailableStocks(),
        get('/alpaca/account'),
        get('/alpaca/market-clock'),
      ])
      return true
    }
  }).catch(() => null)
}

export function prefetchByPath(path) {
  if (path === '/assets') return prefetchAssets()
  if (path === '/portfolio') return prefetchPortfolio()
  if (path === '/orders') return prefetchOrders()
  return null
}
