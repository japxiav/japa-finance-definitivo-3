import type { AppState } from '../core/types';

export interface SecurityStatusItem {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'info';
  detail: string;
}

export interface RuntimeSecurityStatus {
  score: number;
  label: string;
  items: SecurityStatusItem[];
}

export function buildRuntimeSecurityStatus(input: {
  state: AppState;
  userId: string;
  supabaseConfigured: boolean;
  accessAuthorized: boolean;
  syncMode: 'loading' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict';
  aiConfigured: boolean;
}): RuntimeSecurityStatus {
  const items: SecurityStatusItem[] = [
    {
      id: 'session',
      label: 'Sessão autenticada',
      status: input.userId && input.accessAuthorized ? 'ok' : 'warning',
      detail: input.userId && input.accessAuthorized ? 'A sessão foi validada antes de carregar os dados.' : 'A sessão ou a autorização ainda não foi confirmada.',
    },
    {
      id: 'supabase',
      label: 'Cofre remoto configurado',
      status: input.supabaseConfigured ? 'ok' : 'warning',
      detail: input.supabaseConfigured ? 'O estado remoto usa o usuário autenticado como chave de isolamento.' : 'Sem Supabase configurado, os dados ficam limitados ao aparelho.',
    },
    {
      id: 'sync',
      label: 'Sincronização',
      status: input.syncMode === 'saved' ? 'ok' : input.syncMode === 'offline' ? 'info' : input.syncMode === 'conflict' || input.syncMode === 'error' ? 'warning' : 'info',
      detail: input.syncMode === 'saved' ? 'A última versão foi salva na nuvem.' : input.syncMode === 'offline' ? 'O cache local está aberto; a nuvem não foi confirmada.' : input.syncMode === 'conflict' ? 'Existem duas versões preservadas aguardando decisão.' : input.syncMode === 'error' ? 'A sincronização falhou, mas o estado local foi preservado.' : 'Sincronização em andamento.',
    },
    {
      id: 'ai',
      label: 'IA opcional',
      status: input.aiConfigured ? 'info' : 'ok',
      detail: input.aiConfigured ? 'A IA só é chamada por ação explícita e recebe contexto resumido, não o CSV bruto.' : 'Nenhuma chave de IA está configurada no navegador; o núcleo funciona sem chamadas externas.',
    },
    {
      id: 'ownership',
      label: 'Contas próprias identificadas',
      status: input.state.ownerIdentity.ownAccountIds.length ? 'ok' : 'warning',
      detail: `${input.state.ownerIdentity.ownAccountIds.length} conta(s) estão vinculadas ao perfil do usuário.`,
    },
  ];
  const warnings = items.filter((item) => item.status === 'warning').length;
  const score = Math.max(0, 100 - warnings * 20);
  return { score, label: warnings ? 'Proteção funcional com ressalvas' : 'Proteção funcional', items };
}
