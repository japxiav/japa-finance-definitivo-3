# RC7 Corrective Closure Report

Version: 0.7.0-rc.7
Date: 2026-07-29
Source: Japa Finance RC6 ZIP

## Scope
Only the RC6 audit findings were addressed: same-day decisions after reconciliation, category totals with fees, RC5 event migration, reconciled-position query, valid monthly ranges, and atomic reconciliation UI.

## Implemented
- Same-day purchase decisions now use the reconciled snapshot as the current position and project only movements from the following civil day.
- `getReconciledPosition()` answers current-balance questions without invoking forecast.
- `expenseByCategory()` uses `signedNetMovement()`; additional fees remain assigned to the source transaction category.
- RC5 events without `accountId` are migrated:
  - one active account in the currency: automatically assigned;
  - ambiguous account set: event is disabled and marked `needsAccountReview`, without rejecting the whole state.
- Monthly ranges use the real final day of the month.
- Balance reconciliation uses one atomic modal with a shared `logicalAsOf`, all selected accounts, and one confirmation.

## Commands actually executed
- `npm run verify:consolidation` — passed, 16/16
- `npm run verify:operational` — passed, 14/14
- `npm run verify:architecture` — passed
- `npm run verify:sync` — passed, 11/11
- `npm run verify:security` — passed (static)
- `npm run verify:pwa` — passed (static)
- `npm run verify:supabase` — passed (structural only)
- `rm -rf node_modules package-lock.json && npm install --no-audit --no-fund` — failed
- `npm run typecheck` — failed because dependencies were unavailable
- `npm test` — failed because Vitest was unavailable/not executable
- `npm run build` — failed because dependencies were unavailable

## npm installation failure
The configured environment registry returned:

`E404 Not Found ... @supabase/supabase-js@2.55.0`

No `package-lock.json` was generated. No lockfile was written manually.

## Not executed
- clean `npm ci`
- full Vitest suite
- production Vite build
- browser E2E
- real Supabase migration/RLS test
- public deploy
- iPhone PWA installation

## Known limitations
The package is not a release candidate for v1.0 until dependency installation, complete typecheck/tests/build, browser E2E, and real Supabase isolation tests are reproduced in an environment with registry and service access.
