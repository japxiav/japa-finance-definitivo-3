/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ALLOWED_EMAIL?: string;
  readonly VITE_OPENAI_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
