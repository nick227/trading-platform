import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url) })

const SYMBOLS = (process.env.REGIME_SYMBOLS ?? 'SPY').split(',').map(s => s.trim()).filter(Boolean)

async function main() {
  const { fetchAlphaEngineRegime, runRegimeSnapshot } = await import('../src/jobs/regimeSnapshotJob.js')

  for (const symbol of SYMBOLS) {
    const resp = await fetchAlphaEngineRegime(symbol)
    if (resp.ok) {
      console.log(`[dryRun] raw response (${symbol.toUpperCase()}):`)
      console.log(resp.rawText)
    } else {
      console.log(`[dryRun] error response (${symbol.toUpperCase()}): status=${resp.status}`)
      console.log(resp.rawText)
    }
  }

  // No DB writes when REGIME_DEBUG=true.
  const results = await runRegimeSnapshot(SYMBOLS)
  console.log(JSON.stringify({ results }, null, 2))
}

main().catch((err) => {
  console.error('[regimeSnapshotDryRun] error:', err)
  process.exit(1)
})
