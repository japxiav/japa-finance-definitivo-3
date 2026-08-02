interface VercelRequest { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface VercelResponse { status(code: number): VercelResponse; json(value: unknown): void }

const MAX_BODY_BYTES = 220_000;

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

const analystSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'array', maxItems: 20, items: { type: 'string' } },
    limitations: { type: 'array', maxItems: 10, items: { type: 'string' } },
    hypotheses: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          explanation: { type: 'string' },
          evidence: { type: 'array', maxItems: 10, items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          confirmationQuestion: { type: ['string', 'null'] },
        },
        required: ['title', 'explanation', 'evidence', 'confidence', 'confirmationQuestion'],
      },
    },
  },
  required: ['answer', 'confidence', 'evidence', 'limitations', 'hypotheses'],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await verifyUser(req))) return res.status(401).json({ error: 'Sessão inválida.' });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'OPENAI_API_KEY não configurada no servidor.' });
  const encoded = JSON.stringify(req.body ?? {});
  if (new TextEncoder().encode(encoded).byteLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Panorama financeiro grande demais.' });
  const body = req.body as { context?: unknown; question?: string; mode?: string };
  if (!body.context || typeof body.context !== 'object' || Array.isArray(body.context)) return res.status(400).json({ error: 'Contexto financeiro ausente.' });
  const question = body.question?.trim();
  if (!question) return res.status(400).json({ error: 'Pergunta ausente.' });
  if (question.length > 1_000) return res.status(400).json({ error: 'Pergunta longa demais.' });
  const mode = body.mode === 'panorama' || body.mode === 'hypotheses' ? body.mode : 'question';
  const model = process.env.OPENAI_FINANCIAL_MODEL ?? 'gpt-5.6-luna';
  const instructions = `Você é o analista do Japa Finance. Responda em português do Brasil usando SOMENTE o panorama estruturado fornecido.

Regras invioláveis:
- o extrato e os cálculos determinísticos do panorama são a fonte oficial;
- não recalcule saldos, somas, percentuais ou previsões; use os valores já fornecidos;
- não invente transações, pessoas, relações, causas ou eventos;
- não altere dados e não gere ações executáveis;
- transferências entre pessoas já estão completas sem categoria, finalidade ou contexto;
- diferencie fato, interpretação e hipótese;
- um insight só merece aparecer se aumentar claramente a compreensão ou apoiar uma decisão;
- não diga apenas que o usuário gastou ou recebeu mais; explique o impacto, a mudança relevante ou o limite da evidência;
- quando faltar contexto humano, formule no máximo uma hipótese cautelosa com pergunta de confirmação;
- nunca trate ausência de categoria de transferência como erro;
- cite evidências presentes no panorama, usando datas, contagens e valores sem refazer a matemática;
- em modo panorama, sintetize as mudanças e consequências mais importantes;
- em modo hipóteses, priorize padrões que o banco não consegue explicar sozinho;
- em modo pergunta, responda diretamente ao que foi perguntado e declare limitações reais.

Devolva apenas o JSON exigido.`;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        instructions,
        input: JSON.stringify({ mode, question, panoramaFinanceiro: body.context }),
        text: { format: { type: 'json_schema', name: 'financial_analyst', strict: true, schema: analystSchema } },
        max_output_tokens: 3_500,
      }),
    });
    const raw = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: raw?.error?.message ?? 'Falha na OpenAI.' });
    const text = outputText(raw);
    if (!text) return res.status(502).json({ error: 'O analista não retornou conteúdo estruturado.' });
    const parsed = JSON.parse(text);
    return res.status(200).json({ ...parsed, model });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Falha no analista.' });
  }
}
