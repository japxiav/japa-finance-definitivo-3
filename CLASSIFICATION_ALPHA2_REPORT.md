# Japa Finance v0.9 Classification Alpha 2

## Objetivo da entrega

A Alpha 2 consolida a nova arquitetura de classificação para que o aplicativo possa ser usado mesmo quando nem todas as movimentações possuem categoria financeira.

O fluxo implementado permanece:

```text
CSV → normalização → identificação técnica → agrupamento → sugestões → revisão → regras → insights
```

A categoria deixou de ser tratada como condição para o cálculo financeiro. O sistema primeiro identifica o que aconteceu no banco e só depois oferece uma classificação financeira opcional.

## Correção crítica em relação à Alpha 1

Na Alpha 1, a natureza ampla `transfer` ainda fazia com que todas as transferências fossem ignoradas pela análise. Isso excluía incorretamente transferências externas recebidas e enviadas, mesmo quando representavam entrada ou saída real de dinheiro.

A Alpha 2 corrige essa fronteira:

- transferência externa recebida entra como fluxo positivo;
- transferência externa enviada entra como fluxo negativo;
- transferência interna permanece fora de receita e despesa;
- conversão de moeda permanece fora de receita e despesa;
- reembolso reduz as saídas conforme a lógica financeira existente.

Assim, o aplicativo não depende de uma categoria para reconhecer o efeito financeiro de uma transferência externa.

## Modelo de domínio

Cada movimentação passa a possuir dimensões separadas.

### `technicalType`

Representa o fato bancário identificado, como:

- salário;
- outra entrada;
- pagamento com cartão;
- saque;
- débito direto;
- tarifa bancária;
- reembolso;
- transferência recebida;
- transferência enviada;
- transferência interna;
- conversão de moeda;
- ajuste;
- desconhecida.

### `kind`

Continua representando a natureza financeira ampla necessária para compatibilidade com o motor existente. Ele não substitui o tipo técnico.

### `categoryId`

É opcional. Uma movimentação pode permanecer sem categoria e ainda participar corretamente do fluxo, desde que seu tipo técnico esteja identificado.

### `categoryReviewStatus`

A revisão de categoria agora possui estado próprio:

- `pending`;
- `deferred`;
- `resolved`;
- `not_applicable`.

Isso evita usar a ausência de categoria como sinônimo de erro técnico.

## Revisão por grupos

A Central de Revisão passa a trabalhar com grupos formados por comerciante, moeda, direção e tipo técnico.

Cada grupo permite:

- aplicar uma categoria a várias movimentações;
- selecionar somente parte das movimentações;
- criar uma regra para ocorrências futuras;
- manter o grupo sem categoria;
- resolver depois;
- abrir movimentações individuais e aplicar exceções;
- consultar o histórico da decisão;
- desfazer uma decisão anterior.

O estado da revisão fica nas movimentações, não apenas no grupo calculado. Por isso, uma nova movimentação pode aparecer como pendente mesmo que ocorrências antigas do mesmo padrão tenham sido adiadas anteriormente.

## Regras e exceções

As regras pessoais podem considerar:

- comerciante normalizado;
- moeda;
- direção;
- tipo técnico.

Decisões manuais continuam prevalecendo. Quando uma movimentação é tratada como exceção, ela não é silenciosamente sobrescrita por uma regra em massa.

## Impacto nos insights e na Home

Pendências técnicas continuam tornando o resultado provisório. Grupos que apenas aguardam uma categoria opcional não invalidam o fluxo financeiro.

A Home agora distingue:

- problemas que comprometem o cálculo;
- oportunidades de melhorar categorias, gráficos e descobertas.

Isso mantém a promessa central: o aplicativo funciona sem exigir que o usuário classifique cada linha de um extrato histórico.

## Persistência e migração

O estado foi elevado para `schemaVersion: 7`.

A migração:

- infere tipos técnicos em estados antigos;
- separa transferências externas das internas;
- reativa no fluxo transferências externas que antes estavam excluídas;
- preserva categorias, regras, decisões e dados existentes;
- preserva grupos adiados por meio do estado individual das movimentações;
- normaliza a categoria padrão Família para aceitar entradas e saídas.

A migração v5 → v6 continua existindo como etapa intermediária histórica. O estado final carregado pela Alpha 2 é sempre validado como versão 7.

## Verificação realizada

Por solicitação expressa, esta entrega não executou:

- npm;
- Vitest;
- build do Vite;
- Supabase;
- E2E.

Foram executadas somente verificações estáticas:

- transpilação sintática de 54 arquivos TypeScript/TSX, sem diagnósticos;
- verificação estrita dos módulos internos de domínio, persistência, CSV, classificação, finanças, métricas e insights;
- revisão estática das construções de movimentações;
- revisão da migração v6 → v7;
- revisão do cálculo de transferências externas, internas e conversões.

## Escopo ainda não incluído

Esta Alpha 2 não tenta implementar todo o roadmap posterior. Permanecem para evoluções futuras:

- correção em massa do tipo técnico de grupos ainda desconhecidos;
- regra permanente de “nunca perguntar categoria para este padrão”;
- linha do tempo financeira;
- comparação avançada entre períodos;
- simulador financeiro completo;
- extrato próprio em PDF/CSV;
- pesquisa em linguagem natural;
- árvore de causas;
- notificações;
- IA opcional para conversa e explicação.

Esses itens devem ser construídos depois que a importação, a identificação técnica, o agrupamento, a revisão e as regras estiverem estabilizados com uso real.
