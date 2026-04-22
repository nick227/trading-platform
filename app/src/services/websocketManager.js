import { useState, useEffect, useRef } from 'react'

// WebSocket Connection Pooling for Real-time Optimization
// Manages multiple WebSocket connections efficiently

class WebSocketManager {
  constructor() {
    this.connections = new Map()
    this.subscribers = new Map()
    this.reconnectAttempts = new Map()
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000
    this.heartbeatInterval = 30000
    this.heartbeatTimers = new Map()
    
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      totalMessages: 0,
      totalSubscribers: 0,
      reconnects: 0
    }
  }

  // Get or create WebSocket connection for a channel
  getConnection(channel) {
    if (!this.connections.has(channel)) {
      this.createConnection(channel)
    }
    return this.connections.get(channel)
  }

  // Create new WebSocket connection
  createConnection(channel) {
    const wsUrl = `${this.getWebSocketURL()}/${channel}`
    const ws = new WebSocket(wsUrl)
    
    ws.onopen = () => {
      console.log(`WebSocket connected: ${channel}`)
      this.stats.activeConnections++
      this.reconnectAttempts.set(channel, 0)
      
      // Start heartbeat
      this.startHeartbeat(channel)
      
      // Notify subscribers
      this.notifySubscribers(channel, { type: 'connected', channel })
    }
    
    ws.onmessage = (event) => {
      this.stats.totalMessages++
      
      try {
        const data = JSON.parse(event.data)
        this.broadcast(channel, data)
      } catch (error) {
        console.error(`Failed to parse WebSocket message: ${error}`)
      }
    }
    
    ws.onclose = (event) => {
      console.log(`WebSocket disconnected: ${channel} (${event.code})`)
      this.stats.activeConnections--
      
      // Clear heartbeat
      this.clearHeartbeat(channel)
      
      // Attempt reconnection
      if (event.code !== 1000) { // Not a normal closure
        this.attemptReconnection(channel)
      }
      
      // Notify subscribers
      this.notifySubscribers(channel, { type: 'disconnected', channel, code: event.code })
    }
    
    ws.onerror = (error) => {
      console.error(`WebSocket error for ${channel}:`, error)
      this.notifySubscribers(channel, { type: 'error', channel, error })
    }
    
    this.connections.set(channel, ws)
    this.stats.totalConnections++
    
    return ws
  }

  // Get WebSocket URL
  getWebSocketURL() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws`
  }

  // Subscribe to a channel
  subscribe(channel, callback, options = {}) {
    const subscriberId = this.generateSubscriberId()
    
    // Create subscriber set if it doesn't exist
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Map())
    }
    
    // Add subscriber
    this.subscribers.get(channel).set(subscriberId, {
      callback,
      options,
      subscribedAt: Date.now()
    })
    
    this.stats.totalSubscribers++
    
    // Get connection and subscribe if needed
    const ws = this.getConnection(channel)
    if (ws.readyState === WebSocket.OPEN) {
      this.sendSubscriptionMessage(ws, channel, 'subscribe', options)
    }
    
    // Return unsubscribe function
    return () => this.unsubscribe(channel, subscriberId)
  }

  // Unsubscribe from a channel
  unsubscribe(channel, subscriberId) {
    const channelSubscribers = this.subscribers.get(channel)
    if (channelSubscribers && channelSubscribers.has(subscriberId)) {
      channelSubscribers.delete(subscriberId)
      this.stats.totalSubscribers--
      
      // If no more subscribers, close connection
      if (channelSubscribers.size === 0) {
        this.closeConnection(channel)
      } else {
        // Send unsubscribe message
        const ws = this.connections.get(channel)
        if (ws && ws.readyState === WebSocket.OPEN) {
          this.sendSubscriptionMessage(ws, channel, 'unsubscribe', { subscriberId })
        }
      }
    }
  }

  // Send subscription message
  sendSubscriptionMessage(ws, channel, action, options) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscription',
        action,
        channel,
        ...options
      }))
    }
  }

  // Broadcast message to all subscribers of a channel
  broadcast(channel, data) {
    const channelSubscribers = this.subscribers.get(channel)
    if (channelSubscribers) {
      channelSubscribers.forEach((subscriber, id) => {
        try {
          subscriber.callback(data)
        } catch (error) {
          console.error(`Subscriber callback error for ${channel}:`, error)
        }
      })
    }
  }

  // Notify subscribers of connection events
  notifySubscribers(channel, event) {
    const channelSubscribers = this.subscribers.get(channel)
    if (channelSubscribers) {
      channelSubscribers.forEach((subscriber) => {
        if (subscriber.options.notifyOnConnectionEvents) {
          try {
            subscriber.callback(event)
          } catch (error) {
            console.error(`Connection event callback error for ${channel}:`, error)
          }
        }
      })
    }
  }

  // Attempt to reconnect
  attemptReconnection(channel) {
    const attempts = this.reconnectAttempts.get(channel) || 0
    
    if (attempts < this.maxReconnectAttempts) {
      this.reconnectAttempts.set(channel, attempts + 1)
      this.stats.reconnects++
      
      const delay = this.reconnectDelay * Math.pow(2, attempts) // Exponential backoff
      
      setTimeout(() => {
        console.log(`Attempting to reconnect to ${channel} (attempt ${attempts + 1})`)
        this.createConnection(channel)
      }, delay)
    } else {
      console.error(`Max reconnection attempts reached for ${channel}`)
      this.notifySubscribers(channel, { 
        type: 'reconnect_failed', 
        channel, 
        attempts 
      })
    }
  }

  // Start heartbeat for connection
  startHeartbeat(channel) {
    const ws = this.connections.get(channel)
    if (!ws) return
    
    const heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }))
      } else {
        this.clearHeartbeat(channel)
      }
    }, this.heartbeatInterval)
    
    this.heartbeatTimers.set(channel, heartbeatTimer)
  }

  // Clear heartbeat for connection
  clearHeartbeat(channel) {
    const timer = this.heartbeatTimers.get(channel)
    if (timer) {
      clearInterval(timer)
      this.heartbeatTimers.delete(channel)
    }
  }

  // Close specific connection
  closeConnection(channel) {
    const ws = this.connections.get(channel)
    if (ws) {
      this.clearHeartbeat(channel)
      ws.close(1000, 'Connection closed by client')
      this.connections.delete(channel)
      this.subscribers.delete(channel)
      this.reconnectAttempts.delete(channel)
    }
  }

  // Close all connections
  closeAll() {
    this.connections.forEach((ws, channel) => {
      this.closeConnection(channel)
    })
  }

  // Generate unique subscriber ID
  generateSubscriberId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Get connection statistics
  getStats() {
    return {
      ...this.stats,
      channels: Array.from(this.connections.keys()),
      subscribersPerChannel: Array.from(this.subscribers.entries()).map(([channel, subs]) => ({
        channel,
        count: subs.size
      }))
    }
  }

  // Get connection health
  getConnectionHealth() {
    const health = {}
    
    this.connections.forEach((ws, channel) => {
      const subscribers = this.subscribers.get(channel)
      const reconnectAttempts = this.reconnectAttempts.get(channel) || 0
      
      health[channel] = {
        state: ws.readyState,
        stateText: this.getReadyStateText(ws.readyState),
        subscribers: subscribers ? subscribers.size : 0,
        reconnectAttempts,
        healthy: ws.readyState === WebSocket.OPEN && reconnectAttempts < this.maxReconnectAttempts
      }
    })
    
    return health
  }

  // Get WebSocket ready state text
  getReadyStateText(state) {
    const states = {
      [WebSocket.CONNECTING]: 'CONNECTING',
      [WebSocket.OPEN]: 'OPEN',
      [WebSocket.CLOSING]: 'CLOSING',
      [WebSocket.CLOSED]: 'CLOSED'
    }
    return states[state] || 'UNKNOWN'
  }
}

// React hook for WebSocket management
export function useWebSocketManager() {
  const manager = useRef(new WebSocketManager()).current
  
  useEffect(() => {
    return () => {
      manager.closeAll()
    }
  }, [manager])
  
  return manager
}

// Market data WebSocket hook
export function useMarketDataWebSocket(tickers = []) {
  const manager = useWebSocketManager()
  const [data, setData] = useState({})
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  
  useEffect(() => {
    const unsubscribes = []
    
    tickers.forEach(ticker => {
      const unsubscribe = manager.subscribe(
        `market-data-${ticker}`,
        (message) => {
          if (message.type === 'data') {
            setData(prev => ({
              ...prev,
              [ticker]: message.data
            }))
          } else if (message.type === 'connected') {
            setConnected(true)
            setError(null)
          } else if (message.type === 'disconnected') {
            setConnected(false)
          } else if (message.type === 'error') {
            setError(message.error)
          }
        },
        { notifyOnConnectionEvents: true }
      )
      unsubscribes.push(unsubscribe)
    })
    
    return () => {
      unsubscribes.forEach(unsub => unsub())
    }
  }, [manager, tickers])
  
  return { data, connected, error }
}

// Bot status WebSocket hook
export function useBotStatusWebSocket(botIds = []) {
  const manager = useWebSocketManager()
  const [status, setStatus] = useState({})
  const [connected, setConnected] = useState(false)
  
  useEffect(() => {
    const unsubscribe = manager.subscribe(
      'bot-status',
      (message) => {
        if (message.type === 'status_update') {
          setStatus(prev => ({
            ...prev,
            [message.botId]: message.status
          }))
        } else if (message.type === 'connected') {
          setConnected(true)
        } else if (message.type === 'disconnected') {
          setConnected(false)
        }
      },
      { 
        notifyOnConnectionEvents: true,
        filter: { botIds } // Server-side filtering
      }
    )
    
    return unsubscribe
  }, [manager, botIds])
  
  return { status, connected }
}

// Execution updates WebSocket hook
export function useExecutionWebSocket(portfolioId) {
  const manager = useWebSocketManager()
  const [executions, setExecutions] = useState([])
  const [connected, setConnected] = useState(false)
  
  useEffect(() => {
    if (!portfolioId) return
    
    const unsubscribe = manager.subscribe(
      `executions-${portfolioId}`,
      (message) => {
        if (message.type === 'execution_update') {
          setExecutions(prev => [message.execution, ...prev.slice(0, 99)]) // Keep last 100
        } else if (message.type === 'connected') {
          setConnected(true)
        } else if (message.type === 'disconnected') {
          setConnected(false)
        }
      },
      { notifyOnConnectionEvents: true }
    )
    
    return unsubscribe
  }, [manager, portfolioId])
  
  return { executions, connected }
}

export default WebSocketManager
