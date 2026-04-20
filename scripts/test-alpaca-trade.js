import { AlpacaClient } from '../worker/src/broker/alpacaClient.js'
import dotenv from 'dotenv'

dotenv.config()

async function testAlpacaTrade() {
  console.log('🧪 Testing Alpaca Paper Trade...')
  
  // Use paper trading credentials from environment
  const apiKey = process.env.ALPACA_PAPER_API_KEY
  const apiSecret = process.env.ALPACA_PAPER_API_SECRET
  
  if (!apiKey || !apiSecret) {
    console.error('❌ Missing Alpaca credentials. Set ALPACA_PAPER_API_KEY and ALPACA_PAPER_API_SECRET')
    process.exit(1)
  }
  
  const client = new AlpacaClient({
    apiKey,
    apiSecret,
    paper: true
  })
  
  try {
    // 1. Check account status
    console.log('📊 Checking account...')
    const account = await client.getAccount()
    console.log(`✅ Account: $${parseFloat(account.buying_power).toLocaleString()} buying power`)
    
    // 2. Check market clock
    console.log('🕐 Checking market status...')
    const clock = await client.getClock()
    console.log(`✅ Market ${clock.is_open ? 'OPEN' : 'CLOSED'}`)
    
    // 3. Get current positions
    console.log('📈 Checking positions...')
    const positions = await client.getPositions()
    console.log(`✅ Current positions: ${positions.length}`)
    
    // 4. Place a small test order (buy 1 share of SPY if market is open)
    if (clock.is_open) {
      console.log('💰 Placing test order...')
      
      const order = await client.submitOrder({
        ticker: 'SPY',
        side: 'buy',
        qty: 1,
        type: 'market',
        clientOrderId: `test_${Date.now()}`
      })
      
      console.log(`✅ Order placed: ${order.alpacaOrderId} (status: ${order.status})`)
      
      // 5. Check order status after a delay
      console.log('⏳ Checking order status...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const updatedOrder = await client.getOrder(order.alpacaOrderId)
      console.log(`✅ Order status: ${updatedOrder.status}, filled: ${updatedOrder.filledQty}`)
      
    } else {
      console.log('⚠️  Market closed - skipping order test')
    }
    
    console.log('🎉 Alpaca trade test completed successfully!')
    
  } catch (error) {
    console.error('❌ Trade test failed:', error.message)
    if (error.retryable) {
      console.log('🔄 This error is retryable')
    } else {
      console.log('🛑 This error is not retryable')
    }
    process.exit(1)
  }
}

testAlpacaTrade()
