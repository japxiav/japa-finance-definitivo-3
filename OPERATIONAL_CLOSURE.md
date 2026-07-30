# OPERATIONAL CLOSURE — Japa Finance 0.7.0-rc.5

This package prepares RC4 for reproducible installation, Supabase authentication/persistence, RLS, Vercel deployment and iPhone PWA installation without changing approved financial rules.

## Implemented

- Supabase publishable-key environment contract with explicit validation and legacy anon-key fallback.
- Optional `VITE_ALLOWED_EMAIL` application gate.
- Existing email/password auth and persisted session retained.
- Existing per-user remote state and revision compare-and-swap retained.
- Migration 003 aligns schema default to v4, forces RLS and recreates CRUD ownership policies.
- Reproducible two-user RLS test script.
- PWA manifest, iPhone metadata, icons and network-first service worker.
- Vercel SPA/build configuration and no-cache service-worker header.
- Static checks for repository secrets, PWA assets and Supabase contract.

## Operational gates still requiring an external environment

1. Run `npm install` with registry access and retain the npm-generated `package-lock.json`.
2. Delete `node_modules`; run `npm ci`, typecheck, tests, build, verifiers and `npm audit`.
3. Apply migrations to a real Supabase project.
4. Run `npm run test:rls` with two real test accounts.
5. Run the browser E2E against that Supabase project.
6. Deploy to Vercel and verify the public URL.
7. Install from Safari on a physical iPhone and confirm standalone mode.

The delivery is deployment-ready source, not a claim that external deployment, RLS isolation or iPhone installation was executed.
