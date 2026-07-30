# Vercel Deploy

1. Importe este diretório como projeto Vite.
2. Use Node 22, instalação `npm install --no-audit --no-fund`, build `npm run build` e saída `dist`.
3. Configure em Production, Preview e Development conforme necessário:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_ALLOWED_EMAIL` (opcional)
4. Faça redeploy após alterar variáveis.
5. No Supabase Auth, inclua a URL publicada como Site URL/Redirect URL.
6. Abra a URL e confirme login, refresh, segundo navegador e conflito explícito.

O `vercel.json` contém fallback SPA e impede cache persistente de `sw.js`.
