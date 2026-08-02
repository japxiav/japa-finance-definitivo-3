interface VercelRequest { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface VercelResponse { status(code: number): VercelResponse; json(value: unknown): void }

const MAX_BODY_BYTES = 280_000;

function header(req: VercelRequest, name: string): string {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function verifyUser(req: VercelRequest): Promise<boolean> {
  const auth = header(req, 'authorization');
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!auth.startsWith('Bearer ') || !url || !key) return false;
  const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { authorization: auth, apikey: key },
  });
  return response.ok;
}

function outputText(response: any): string {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

const auditSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    proposals: {
      type: 'array', maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['reclassify_technical','link_internal_transfer','link_compound_event','set_category','create_memory_entity','merge_accounts','archive_account','review_only'] },
          severity: { type: 'string', enum: ['critical','warning','info'] },
          title: { type: 'string' }, explanation: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
          transactionIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
          accountIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          confidence: { type: 'string', enum: ['high','medium','low'] },
          payload: {
            type: 'object', additionalProperties: false,
            properties: {
              action: { type: ['string','null'] }, technicalType: { type: ['string','null'] },
              categoryId: { type: ['string','null'] }, entityDisplayName: { type: ['string','null'] },
              contextLabel: { type: ['string','null'] }, suggestionKey: { type: ['string','null'] },
              sourceUrl: { type: ['string','null'] },
            },
            required: ['action','technicalType','categoryId','entityDisplayName','contextLabel','suggestionKey','sourceUrl'],
          },
        },
        required: ['type','severity','title','explanation','evidence','transactionIds','accountIds','confidence','payload'],
      },
    },
  },
  required: ['summary','proposals'],
};

async function callAudit(input: {
  apiKey: string;
  model: string;
  instructions: string;
  payload: unknown;
  tools?: Array<{ type: 'web_search' }>;
}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      instructions: input.instructions,
      input: JSON.stringify(input.payload),
      ...(input.tools ? { tools: input.tools } : {}),
      store: false,
      text: { format: { type: 'json_schema', name: 'financial_audit', strict: true, schema: auditSchema } },
    }),
  });
  const raw = await response.json();
  if (!response.ok) throw Object.assign(new Error(raw?.error?.message ?? 'Falha na OpenAI.'), { status: response.status });
  const text = outputText(raw);
  if (!text) throw Object.assign(new Error('A auditoria não retornou conteúdo estruturado.'), { status: 502 });
  try {
    return JSON.parse(text) as { summary: string; proposals: unknown[] };
  } catch {
    throw Object.assign(new Error('A auditoria retornou JSON inválido.'), { status: 502 });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await verifyUser(req))) return res.status(401).json({ error: 'Sessão inválida.' });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'OPENAI_API_KEY não configurada no servidor.' });

  const encoded = JSON.stringify(req.body ?? {});
  if (new TextEncoder().encode(encoded).byteLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Panorama financeiro grande demais para a auditoria.' });
  }
  const body = req.body as { context?: unknown; allowWebSearch?: boolean; question?: string };
  if (!body.context || typeof body.context !== 'object' || Array.isArray(body.context)) {
    return res.status(400).json({ error: 'Contexto financeiro ausente.' });
  }

  const model = process.env.OPENAI_FINANCIAL_MODEL ?? 'gpt-5.6-luna';
  const context = body.context as Record<string, unknown>;
  const publicCandidates = Array.isArray(context.publicLookupCandidates)
    ? context.publicLookupCandidates.slice(0, 30)
    : [];
  const categorySummary = Array.isArray(context.categorySummary) ? context.categorySummary : [];
  const question = body.question?.trim();

  const privateInstructions = `Você é o auditor do Japa Finance. Examine somente o panorama estruturado fornecido.

Regras invioláveis:
- valores, datas, moedas, saldos e IDs bancários são fatos imutáveis;
- não recalcule o livro-caixa nem invente transações;
- proponha correções, nunca afirme que as aplicou;
- não use pesquisa externa nesta etapa;
- não produza observações óbvias. Uma conclusão deve revelar inconsistência, consequência, mudança relevante ou decisão útil;
- transferências entre pessoas já estão completas sem categoria ou finalidade; falta de contexto pessoal não é erro nem pendência;
- não proponha create_memory_entity apenas porque uma pessoa apareceu sem contexto. Só faça isso quando a pergunta do usuário pedir enriquecimento contextual;
- evidências devem apontar para IDs e contagens presentes no contexto;
- use somente IDs de categoria existentes em categorySummary.

Responda em português do Brasil e no JSON exigido.`;

  const publicInstructions = `Você é o resolvedor público de comerciantes do Japa Finance.

Regras invioláveis:
- pesquise somente nomes presentes em publicLookupCandidates;
- os candidatos foram derivados apenas de pagamentos a possíveis comerciantes ou empresas;
- nunca pesquise pessoas particulares, destinatários de transferências, IBANs, e-mails ou dados pessoais;
- use fontes públicas para identificar empresa, atividade e categoria provável;
- não altere fatos bancários;
- use somente IDs de categoria existentes em categorySummary;
- toda proposta baseada na web deve incluir sourceUrl e confiança;
- quando não houver evidência suficiente, devolva review_only.

Responda em português do Brasil e no JSON exigido.`;

  try {
    const base = await callAudit({
      apiKey,
      model,
      instructions: privateInstructions,
      payload: {
        question: question || null,
        panoramaFinanceiro: context,
      },
    });

    let webResult: { summary: string; proposals: unknown[] } | undefined;
    if (body.allowWebSearch && publicCandidates.length) {
      webResult = await callAudit({
        apiKey,
        model,
        instructions: publicInstructions,
        payload: { publicLookupCandidates: publicCandidates, categorySummary },
        tools: [{ type: 'web_search' }],
      });
    }

    return res.status(200).json({
      summary: webResult?.summary ? `${base.summary}\n\nPesquisa pública: ${webResult.summary}` : base.summary,
      proposals: [...(base.proposals ?? []), ...(webResult?.proposals ?? [])].slice(0, 30),
      model,
      usedWebSearch: Boolean(webResult),
    });
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 502;
    return res.status(status).json({ error: error instanceof Error ? error.message : 'Falha na auditoria.' });
  }
}
