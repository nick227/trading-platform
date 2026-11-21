# Alpha Engine recommendation contract v2: TradeLoom integration

The canonical contract and verified-defect inventory are in the sibling Alpha Engine repository: [recommendation-contract-v2.md](../../alpha-engine/docs/internal/recommendation-contract-v2.md).

## Required changes

- Recommendation `confidence`, `successProbability`, `entryZone`, `risk`, and `expectedReturn` can be null. Do not convert absence to zero or Medium risk.
- Use `score` for relative ranking and `heuristicConfidence` only as a clearly labeled score, never as a percentage success probability.
- Render `explanations` as deterministic score explanations. `thesis` and `avoidIf` are empty when unavailable.
- Use `referencePrice` for observed price display. It is not an entry instruction; `referencePriceAsOf` identifies its source timestamp.
- `actionable=false` means research only. Suppressed rows use `action=WATCH`. Global health does not override individual row suppression.
- Lists preserve useful research and carry quality metadata; `/best` returns 503 with `suppressionReasons` when an eligible pick is unavailable. Short or empty under-price/long-only lists are valid.
- Preserve quality metadata through normalization and fallback merging. Derived ranking rows remain WATCH, with no confidence or entry band.
- `asOf` is recommendation build time, not proof that source data is fresh. Cached research must not become execution guidance.

## Adapter behavior

`server/src/clients/engine.js#getActiveSignals` requires explicit healthy global and row metadata, evaluated within 60 seconds, an explicit BUY/SELL direction, and available empirically calibrated `successProbability` in [0,1]. Legacy `confidence` is not an acceptable substitute. Alpha Engine currently supplies no calibrated probability, so its heuristic recommendations produce no active order signals through this adapter.

This is a consumer-contract boundary correction. Broker execution code, live trading settings, and strategy code are unchanged. The synthetic calibrated fixture in the existing integration suite verifies compatibility of the future contract; it is not evidence that calibration currently exists.

Recommendation panels, Asset, Home, Opportunities, common unavailable-value displays, and order-bootstrap normalization were adjusted for null semantics and research-only status. Generic prediction/calendar displays outside these recommendation flows remain a separate migration; raw model scores must not be interpreted as calibrated probabilities.

## Verification

Run from the indicated repository subdirectory:

```sh
# server/
npm test -- test/clients/recommendationIntegrity.test.js test/clients/engineClient.test.js test/integration/intelligenceTradingContract.test.js

# app/
npm test -- src/utils/__tests__/recommendationIntegrity.test.jsx
npm run build
```

All execution integration tests use mocked broker/database services. No live order was submitted or enabled.
