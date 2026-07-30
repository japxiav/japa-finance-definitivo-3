# RC9 Strict Corrective Report

Version: 0.7.0-rc.9
Commit: not available (ZIP working copy)
Date: 2026-07-29
Node: v22.16.0
npm: 10.9.2

## Scope

Strictly corrective release. No new product features, historical reports, currency conversion, or financial-rule expansion.

## Corrections

1. Immediate purchases now include the balance immediately after the proposed purchase in the minimum-balance calculation, before future forecast points.
2. Recurrences without `until` or `maxOccurrences` are accepted and expanded only within the requested forecast horizon.
3. The next recurring income is exposed as structured evidence with its effective occurrence date.
4. Currency-specific state adaptation includes only transfers whose source and destination accounts both belong to the selected currency/account set.
5. Assistant civil-date defaults use local calendar date instead of slicing a UTC ISO timestamp.

## Commands executed

- `npm run verify:operational`
- `npm run verify:consolidation`
- `npm run verify:architecture`
- `npm run verify:sync`
- `npm run verify:security`
- `npm run verify:pwa`
- `npm run verify:supabase`
- `rm -rf node_modules package-lock.json && npm install --no-audit --no-fund`

## Results

- operational tests: 20/20 passed
- consolidation invariants: 16/16 passed
- architecture verifier: passed
- sync verifier: 11/11 passed
- security verifier: passed (static)
- PWA verifier: passed (static)
- Supabase verifier: passed (structural/static)
- npm install: failed before dependency installation with registry `E404` for `@supabase/supabase-js@2.55.0`

## Newly covered regressions

- €1,000 reconciled balance, €500 reserve, €900 immediate purchase, €2,000 income tomorrow => purchase is unsafe because immediate balance is €100.
- monthly recurrence without termination produces a decision and exposes the next income date.
- BRL forecast ignores an unrelated EUR-only transfer.
- local civil-date helper does not derive “today” by truncating a UTC ISO string.

## Not executed

- package-lock generation
- npm ci
- full project typecheck
- Vitest suite
- Vite production build
- browser E2E
- real Supabase migrations/RLS test
- public deploy

## Known operational blocker

The configured npm registry in this environment does not contain `@supabase/supabase-js@2.55.0`. A real lockfile must be generated on a machine with access to the public npm registry or a complete mirror. No lockfile was written manually.
