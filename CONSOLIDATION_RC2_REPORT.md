# Japa Finance — Consolidation RC2 Technical Report

Version: 0.7.0-rc.2  
Date: 2026-07-27  
Node: v22.16.0  
npm: 10.9.2

## Implemented in this work package

- Explicit fee semantics through `FeeTreatment`.
- Signed `reportedAmountCents` and `netMovementCents`.
- Reconciliation now consumes `netMovementCents` and does not reinterpret fees.
- Anonymous Revolut regression fixture with a € 2,20 additional fee.
- Structured purchase-decision evidence.
- Purchase result now exposes minimum balance, date, reserve, evidence and applied rules.
- Domain import contracts for preview, normalized movement, duplicate kinds and batch lifecycle.
- Import reconciliation helper using integer cents only.
- Added `typecheck` script.
- Updated package version to `0.7.0-rc.2`.

## Commands actually executed

### Consolidation verification

```sh
tsc --outDir consolidation_build --strict --target ES2022 --module CommonJS --moduleResolution Node \
  scripts/verify-consolidation.ts \
  src/domain/model.ts src/domain/dates.ts src/domain/validation.ts \
  src/domain/forecast.ts src/domain/decisions.ts src/domain/imports.ts

node consolidation_build/scripts/verify-consolidation.js
```

Result: **15/15 passed**

Covered:
- invalid and incomplete states;
- reconciliation batches;
- account and currency forecasts;
- transfers and fees;
- reserve requirements;
- additional fee normalization;
- zero reconciliation difference;
- structured decision evidence;
- amount validation independent of locale formatting.

### Domain strict TypeScript compilation

Result: **passed**

### Legacy CSV parser strict TypeScript compilation

Result: **passed**

### Structural synchronization verification

```sh
node scripts/verify-sync-structure.mjs
```

Result: **11/11 passed**

## npm installation and production build

Attempted:

```sh
npm install --package-lock-only --ignore-scripts --offline
```

Result: **not executed successfully**.

Reason: the configured npm registry was unavailable and the package metadata was not present in the local npm cache (`ENOTCACHED`).

Consequences:

- `package-lock.json` was **not fabricated** and is not included.
- `npm ci` was not validated.
- Vitest was not executed.
- Vite production build was not executed.
- Browser E2E was not executed.

## Important integration status

This work package fixes the fee contract in the parser still used by the web application and extends the new domain. It does **not** yet complete the final cutover of the React UI to a single `FinancialDecisionFacade`.

The legacy modules and new domain still coexist. Therefore this package is an internal consolidation work package, not a production-ready financial release.

## Remaining acceptance blockers

1. Generate a real `package-lock.json` with registry access.
2. Run clean `npm ci`.
3. Run full Vitest suite and fix any failures.
4. Run Vite production build.
5. Connect import preview and confirmed `ImportBatch` to persistence.
6. Create `ReconciliationBatch` from confirmed zero-difference reconciliation.
7. Connect the React UI to one financial facade.
8. Remove or isolate legacy forecast and assistant rules.
9. Add browser E2E for the golden path, duplicate import and two-tab conflict.
10. Update the final test report only after those commands execute.

## Contract note

All downstream financial consumers must use `netMovementCents`. `reportedAmountCents` and `feeCents` remain audit fields only.
