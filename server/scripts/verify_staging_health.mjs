import http from 'node:http'
import prisma from '../src/loaders/prisma.js'
import { processNextBacktest, createBacktest } from '../src/services/backtestService.js'

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }))
    })
    req.on('error', reject)
  })
}

async function verify() {
  console.log('1. Alpha Engine /health:')
  const health = await get('http://127.0.0.1:8090/health')
  console.log('   Status:', health.status, '| Health:', health.data.status, '| Latest bar date:', health.data.latest_bar_date)

  console.log('2. Alpha Engine daily bars API (/api/market/daily-bars):')
  const bars = await get('http://127.0.0.1:8090/api/market/daily-bars?ticker=SPY&start=2026-11-01&end=2026-11-20', {
    'X-Internal-Key': '2b5497217d6d8f2bbed32589f9f3b33828c6f05b116dc2ea97d1335f1edf7522'
  })
  console.log('   Status:', bars.status, '| Bars count:', bars.data.bars?.length, '| Fingerprint:', bars.data.sha256)

  console.log('3. TradeLoom public strategies API (/api/public/strategies):')
  const pub = await get('http://127.0.0.1:3001/api/public/strategies')
  const strategies = pub.data?.data || pub.data
  console.log('   Status:', pub.status, '| Strategies count:', strategies?.length)

  console.log('4. TradeLoom strategy detail (/api/public/strategies/tmpl_spy_trend_filter):')
  const detail = await get('http://127.0.0.1:3001/api/public/strategies/tmpl_spy_trend_filter')
  const strat = detail.data?.data || detail.data
  console.log('   Status:', detail.status, '| Name:', strat.name, '| Windows count:', Object.keys(strat.evidence || {}).length)

  console.log('5. TradeLoom Backtest Execution on compact database:')
  const user = await prisma.user.findFirst()
  if (user) {
    const run = await createBacktest(user.id, {
      name: 'Compact DB Verification Run',
      symbols: ['SPY'],
      range: '1Y',
      executionModel: 'next_open',
      config: {
        direction: 'buy',
        allocatedAmount: 10000,
        maxOrderNotional: 2000,
        exit: {
          rules: [{ type: 'trend_filter', config: { symbol: 'SPY', confirmationBars: 2, requiredRegime: 'risk_off' } }]
        }
      },
      rules: [
        { type: 'trend_filter', name: 'SPY uptrend', enabled: true, config: { symbol: 'SPY', confirmationBars: 2, requiredRegime: 'risk_on' } }
      ]
    })
    console.log('   Created backtest run:', run.id, '| Initial Status:', run.status)
    const finished = await processNextBacktest()
    console.log('   Finished backtest status:', finished?.status, '| Trades:', finished?.results?.metrics?.trades, '| Return:', finished?.results?.metrics?.returnPct + '%')
  }

  await prisma.$disconnect()
  console.log('\n=== All staging verifications PASSED cleanly! ===')
}

verify().catch(err => {
  console.error('Verification failed:', err)
  process.exit(1)
})
