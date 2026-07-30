# RC10 Professional Audit Report

Version: `0.7.0-rc.10`  
Date: 2026-07-29

## Scope

This release was produced by auditing and correcting the RC9 source code, with emphasis on deterministic financial decisions, invalid-state containment, multi-account/multi-currency isolation, recurrence, reconciliation, migration, synchronization, and UI-to-domain input boundaries.

## Corrected behavior

- Immediate purchases include the post-purchase balance and any still-active outflows due on the reconciliation day before future income.
- Future purchases do not assume income from the same day arrived first.
- Spending limits include same-day outflows before the next income.
- Open-ended recurring events are supported within the forecast horizon.
- Recurrence intervals are bounded, and date expansion stops safely at the civil-date limit instead of throwing.
- Currency forecasts receive only accounts, events, and transfers from the selected currency scope.
- The newest complete reconciliation batch is selected; later partial batches do not corrupt the forecast.
- Reconciliation validates account coverage, duplicates, canonical timestamps, chronology, currency, and signed safe-integer balances.
- Planned events reject zero/negative values and impossible civil dates before persistence.
- Events tied to inactive or invalid accounts are suspended for review rather than silently reassigned.
- Backup normalization validates cross-entity references, currencies, transaction direction/type, timestamps, dates, recurrence, and transfer integrity.
- Local civil dates and `datetime-local` values are handled without UTC-day or DST normalization surprises.
- Assistant amount extraction prioritizes explicit monetary values and declines ambiguous bare-number guesses.
- UI state selectors repair themselves after restore/sync changes instead of retaining stale account/currency references.

## Executed verification

- Consolidation invariants: **16/16 passed**.
- Operational regression suite: **39/39 passed**.
- Professional deterministic/property audit:
  - **500** forecast conservation and consolidation scenarios;
  - **1,000** future purchase decisions;
  - **500** immediate purchase decisions.
- Architecture verification: passed.
- Synchronization structure: **11/11 passed**.
- Security static scan: passed.
- PWA static verification: passed.
- Supabase structural verification: passed.

## Environment boundary

The public npm registry could not be resolved from the execution environment. Consequently, a clean dependency installation, the official Vitest runner, the Vite production build, browser E2E, and a live Supabase/Vercel deployment were not executed here. `vercel.json` uses `npm install --no-audit --no-fund` because this archive does not contain a generated lockfile.

## Verdict

No remaining source-code defect was found within the audited and executed scope. This statement is evidence-based, not a claim that any non-trivial software can be proven to contain zero bugs. The next appropriate step is dependency installation, official test/build execution, and real-data beta use rather than another feature expansion.
