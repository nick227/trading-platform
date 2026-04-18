import { priceCache } from './priceCache.js'

// Single Alpaca WebSocket connection shared across the entire worker process.
// Manages subscribe/unsubscribe deltas — never rebuilds the full subscription list.

let socket = null
let currentTickers = new Set()
let quoteHandler = null
let barHandler   = null
let rawClient = null
let connected = false

export function initDataStream(alpacaRawClient) {
  rawClient = alpacaRawClient
  socket = alpacaRawClient.data_stream_v2

  socket.onConnect(() => {
    connected = true
    console.log('[dataStream] connected to Alpaca market data stream')
    // Re-subscribe to any tickers that were registered before connect
    if (currentTickers.size > 0) {
      socket.subscribeForQuotes([...currentTickers])
    }
  })

  socket.onStockQuote((quote) => {
    const ticker = quote.S ?? quote.Symbol
    if (!ticker) return
    priceCache.set(ticker, {
      bid:  quote.bp ?? quote.BidPrice,
      ask:  quote.ap ?? quote.AskPrice,
      last: quote.ap ?? quote.AskPrice  // best available proxy for last
    })
    if (quoteHandler) quoteHandler(ticker, priceCache.get(ticker))
  })

  socket.onStockBar((bar) => {
    const ticker = bar.S ?? bar.Symbol
    if (!ticker) return
    // Mutate last price in-place — avoids spread + object allocation per tick
    priceCache.updateLast(ticker, bar.c ?? bar.ClosePrice)
    if (barHandler) barHandler(ticker, bar)
  })

  socket.onError((err) => {
    console.error('[dataStream] stream error:', err.message ?? err)
  })

  socket.onDisconnect(() => {
    connected = false
    console.warn('[dataStream] disconnected — will reconnect on next market open')
  })

  socket.connect()
}

// Called by botEngine.reloadBots() with the delta from the previous tick set
export function subscribe(tickers) {
  if (!tickers.length) return
  tickers.forEach(t => currentTickers.add(t))
  if (socket) socket.subscribeForQuotes(tickers)
  console.log(`[dataStream] subscribed: ${tickers.join(', ')}`)
}

export function unsubscribe(tickers) {
  if (!tickers.length) return
  tickers.forEach(t => currentTickers.delete(t))
  if (socket) socket.unsubscribeFromQuotes(tickers)
  console.log(`[dataStream] unsubscribed: ${tickers.join(', ')}`)
}

export function onQuote(handler) { quoteHandler = handler }
export function onBar(handler)   { barHandler   = handler }

export function disconnect() {
  connected = false
  if (socket) socket.disconnect()
  socket = null
  currentTickers.clear()
}

export function ensureConnected() {
  if (connected || !rawClient) return
  initDataStream(rawClient)
}

export function isConnected() {
  return connected
}
