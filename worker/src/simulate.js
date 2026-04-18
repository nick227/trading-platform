import { runFailureHarness } from './testing/failureHarness.js'

const results = await runFailureHarness()
let failed = false

for (const result of results) {
  const prefix = result.pass ? 'PASS' : 'FAIL'
  console.log(`${prefix} ${result.name}: ${result.output}`)
  if (!result.pass) failed = true
}

if (failed) {
  process.exit(1)
}
