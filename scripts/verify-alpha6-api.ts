import handler from '../api/financial-audit';

interface CapturedResponse { statusCode: number; payload: any }

function makeResponse(): { response: any; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, payload: undefined };
  const response = {
    status(code: number) { captured.statusCode = code; return response; },
    json(value: unknown) { captured.payload = value; },
  };
  return { response, captured };
}

async function main() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.OPENAI_FINANCIAL_MODEL = 'gpt-5.6-luna';

  const calls: Array<{ url: string; body?: any }> = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, body });
    const output = calls.length === 1
      ? { summary: 'Auditoria privada concluída.', proposals: [] }
      : { summary: 'Comerciante público identificado.', proposals: [] };
    return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { response, captured } = makeResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
    body: {
      allowWebSearch: true,
      context: {
        schemaVersion: 12,
        categorySummary: [{ id: 'groceries', name: 'Mercado', type: 'expense' }],
        memorySummary: [{ displayName: 'Pessoa Privada Teste', relationship: 'sister' }],
        publicLookupCandidates: [{ normalizedName: 'dunnes stores', sample: 'DUNNES STORES', count: 3, transactionIds: ['tx-1'] }],
      },
    },
  } as any, response);

  if (captured.statusCode !== 200) throw new Error(`Rota retornou ${captured.statusCode}: ${JSON.stringify(captured.payload)}`);
  if (calls.length !== 2) throw new Error(`Esperadas duas chamadas OpenAI, recebidas ${calls.length}.`);
  const [privateCall, publicCall] = calls;
  if (privateCall!.body.tools) throw new Error('Auditoria privada recebeu ferramenta web.');
  if (privateCall!.body.store !== false || publicCall!.body.store !== false) throw new Error('store:false ausente.');
  if (!Array.isArray(publicCall!.body.tools) || publicCall!.body.tools[0]?.type !== 'web_search') throw new Error('Segunda chamada não recebeu web_search.');
  const publicPayload = JSON.parse(publicCall!.body.input);
  if ('memorySummary' in publicPayload) throw new Error('Contexto pessoal vazou para a chamada com web search.');
  if (JSON.stringify(publicPayload).includes('Pessoa Privada Teste')) throw new Error('Nome particular vazou para a chamada com web search.');
  if (!captured.payload.usedWebSearch) throw new Error('Resposta não registrou pesquisa web.');

  console.log(JSON.stringify({
    status: captured.statusCode,
    openAiCalls: calls.length,
    privateCallHasWebTool: Boolean(privateCall!.body.tools),
    publicCallHasWebTool: Boolean(publicCall!.body.tools),
    storeDisabled: privateCall!.body.store === false && publicCall!.body.store === false,
    privateNameSentToWebCall: JSON.stringify(publicPayload).includes('Pessoa Privada Teste'),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
