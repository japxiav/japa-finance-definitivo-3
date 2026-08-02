# Japa Finance Alpha 8 — Compreensão Financeira

Entrega: `0.9.0-alpha.8`  
Estado persistido: `schemaVersion: 13`  
Migration SQL: nenhuma

## Objetivo

A Alpha 7 resolveu a obrigação de classificar transferências. A Alpha 8 usa essa base para entregar compreensão sem devolver trabalho manual ao usuário:

- responder perguntas objetivas diretamente do livro;
- mostrar relações financeiras sem exigir categoria;
- reconstruir mudanças observáveis ao longo do tempo;
- permitir interpretação por IA sem transformar a IA em fonte oficial, calculadora ou agente de alteração.

## 1. Perguntar aos números

Foi criada uma área única para dois níveis de resposta:

### Motor determinístico

Responde localmente e com evidências a perguntas sobre:

- quanto foi enviado ou recebido de uma contraparte;
- quem mais recebeu transferências;
- quem mais enviou dinheiro;
- primeiro movimento reconhecido na Wise ou Revolut;
- taxas explícitas de conversão;
- compras, reembolsos e impacto líquido por comerciante;
- saldo reconciliado;
- limite até a próxima receita;
- simulação de compra;
- duplicatas e composição geral de gastos.

Nomes abreviados podem encontrar um relacionamento consolidado quando o token é distintivo. Assim, “Hannah” localiza o relacionamento salvo com o nome bancário completo, sem criar uma regra frágil para qualquer palavra curta.

### Analista por IA

Quando o usuário pede panorama, explicação aberta ou hipóteses, o frontend chama `/api/financial-assistant`.

A rota:

- valida o bearer token no Supabase Auth;
- lê `OPENAI_API_KEY` apenas no servidor;
- usa `store: false`;
- limita o corpo a 220 kB, a pergunta a 1.000 caracteres e a saída a 3.500 tokens;
- exige Structured Output em JSON;
- não habilita pesquisa web;
- não devolve ações executáveis.

O app continua funcionando sem chave da OpenAI. Nesse caso, somente panorama e hipóteses por IA ficam indisponíveis.

## 2. Panorama financeiro privado

A IA não recebe CSV bruto nem objetos completos de transação. O contexto enviado contém apenas dados consolidados:

- princípios permanentes;
- saúde da base sem IDs internos;
- resumo do período atual e comparação equivalente;
- categorias e comerciantes agregados;
- relacionamentos com totais, contagens e cadência;
- taxas e conversões agregadas;
- panorama mensal;
- eventos da história financeira;
- compromissos planejados;
- memória financeira confirmada.

Foram removidos do panorama:

- `descriptionOriginal`;
- `originalData`;
- `bankTransactionId`;
- `transactionIds`;
- `accountIds`;
- evidências internas baseadas em IDs de movimentação ou snapshot.

Nomes e anotações de relacionamentos podem ser enviados porque são justamente o contexto privado necessário para a interpretação. Essa chamada nunca recebe ferramenta web.

## 3. História Financeira

Foi criado um motor derivado, sem novos campos persistidos, que reconhece eventos observáveis:

- primeiro movimento por instituição;
- mudança da instituição mais usada;
- troca da principal origem de transferências recebidas;
- despesa muito acima da mediana histórica;
- primeira conversão reconhecida;
- primeira posição de saldo reconciliada.

Cada evento preserva os IDs locais das linhas que o sustentam para permitir abrir os movimentos no app, mas esses IDs não são enviados ao analista por IA.

Também foi criado um panorama mensal com:

- entradas externas;
- saídas externas;
- compras e despesas;
- transferências enviadas;
- transferências recebidas;
- taxas explícitas;
- quantidade de conversões e movimentos.

## 4. Inteligência por relacionamento

Cada relacionamento agora deriva automaticamente:

- participação no total enviado e recebido;
- média enviada e recebida;
- meses de maior envio e recebimento;
- quantidade de meses ativos;
- cadência: pontual, ocasional, regular, recorrente ou frequente;
- fatos explicativos sem presumir finalidade.

Foram adicionados insights de concentração e fluxo nos dois sentidos. Eles não pedem classificação nem chamam ausência de contexto de erro.

## 5. Anotação opcional

O painel deixou de apresentar “completar contexto” como tarefa. Há apenas uma anotação livre.

Correções de integridade aplicadas:

- salvar uma anotação preserva relação, direção e intervalo temporal já existentes na Memória Financeira;
- apagar a anotação limpa somente `contextLabel` e `notes`;
- a entidade e seus aliases não são excluídos;
- uma anotação vazia não cria uma entidade fantasma;
- nenhuma anotação altera valor, saldo, moeda, data, tipo técnico ou categoria.

## 6. Navegação e interface

Na área Insights foram acrescentados atalhos para:

- História financeira;
- Perguntar aos números;
- Auditoria.

Na área Mais foram acrescentados acessos permanentes para História e Perguntas.

A barra inferior considera História, Perguntas e Auditoria como subáreas de Insights.

A interface móvel recebeu:

- cards de relacionamento com totais e cadência;
- modal de análise do relacionamento;
- painel mensal responsivo;
- linha do tempo rolável acima da barra inferior;
- aviso de privacidade antes das chamadas de IA.

## 7. Separação entre as duas IAs

A Alpha 8 mantém duas superfícies distintas:

1. `/api/financial-assistant`: contexto financeiro privado, sem web, somente leitura;
2. `/api/financial-audit`: auditoria e pesquisa pública opcional, com chamada web separada recebendo apenas candidatos públicos de comerciante.

Pessoas particulares continuam proibidas de entrar na chamada com pesquisa web.

## 8. Persistência e compatibilidade

Não foi criado novo schema porque:

- inteligência, história e panorama são derivados;
- respostas de IA são efêmeras;
- anotações usam a Memória Financeira existente;
- nenhum campo novo precisa ser salvo no JSONB.

Backups Alpha 7 continuam válidos sem migração. Decisões manuais, categorias, notas, regras e checkpoints permanecem intactos.

## 9. Resultado nos extratos reais

Com os arquivos fornecidos:

- 994 fatos bancários importados;
- 221 transferências entre pessoas;
- 0 grupos de revisão de transferência;
- 9 relacionamentos EUR;
- 16 relacionamentos BRL;
- Hannah consolidada em 69 movimentos;
- 6 eventos relevantes na História Financeira EUR;
- 11 panoramas mensais EUR;
- contexto enviado à IA com aproximadamente 10,9 kB.

Respostas determinísticas confirmadas:

- total enviado para Hannah pelo primeiro nome;
- principal destinatário de transferências;
- primeiro uso da Revolut em 22/05/2026;
- Vinted: compras, reembolsos e impacto líquido.

## 10. Limites honestos

Não foram executados:

- npm;
- Vitest;
- build do Vite;
- navegador real;
- Supabase remoto;
- Vercel real;
- OpenAI real;
- E2E.

A validação realizada está descrita em `ALPHA8_VALIDATION.md` e no log bruto entregue junto com o pacote.
