import handler from '../api/financial-assistant';

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
    return new Response(JSON.stringify({ output_text: JSON.stringify({
      answer: 'Panorama interpretado sem alterar os dados.',
      confidence: 'high',
      evidence: ['O panorama informou os valores usados.'],
      limitations: ['Não conheço o motivo humano sem confirmação.'],
      hypotheses: [{ title: 'Possível mudança de origem', explanation: 'A origem principal mudou.', evidence: ['Dois períodos diferentes.'], confidence: 'medium', confirmationQuestion: 'Isso foi uma mudança no recebimento do salário?' }],
    }) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { response, captured } = makeResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
    body: {
      mode: 'panorama',
      question: 'Faça um panorama.',
      context: { currency: 'EUR', principles: ['extrato é a fonte oficial'], relationships: [{ name: 'Pessoa Privada', sentCents: 1000 }] },
    },
  } as any, response);

  if (captured.statusCode !== 200) throw new Error(`Rota retornou ${captured.statusCode}: ${JSON.stringify(captured.payload)}`);
  if (calls.length !== 1) throw new Error(`Esperada uma chamada OpenAI, recebidas ${calls.length}.`);
  const call = calls[0]!;
  if (call.body.tools) throw new Error('Analista privado recebeu ferramenta web.');
  if (call.body.store !== false) throw new Error('store:false ausente.');
  if (call.body.text?.format?.type !== 'json_schema') throw new Error('Structured Output ausente.');
  if (!String(call.body.instructions).includes('não altere dados')) throw new Error('Regra de somente leitura ausente.');
  if (call.body.max_output_tokens !== 3_500) throw new Error('Limite de saída ausente.');

  console.log(JSON.stringify({
    status: captured.statusCode,
    openAiCalls: calls.length,
    hasWebTool: Boolean(call.body.tools),
    storeDisabled: call.body.store === false,
    structuredOutput: call.body.text?.format?.type,
    model: call.body.model,
    maxOutputTokens: call.body.max_output_tokens,
    answer: captured.payload.answer,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
