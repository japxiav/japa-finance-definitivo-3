# Japa Finance v0.9 Alpha 5.3 — Relatório de implementação

Data: 31/07/2026

## Objetivo

Transformar a importação de extratos extensos em um fluxo multi-instituição e multi-moeda mais seguro, reduzindo revisão manual repetitiva sem esconder incertezas do usuário.

## Entregas

### Importação inteligente

- Detecção do formato Wise ou Revolut pelo nome do arquivo e pelos cabeçalhos.
- O parser deixou de depender da conta selecionada para decidir a instituição do arquivo.
- Detecção das moedas presentes antes da importação.
- Roteamento automático para contas da mesma instituição, como `Wise EUR`, `Wise BRL`, `Revolut EUR` e `Revolut BRL`.
- Criação ou ativação assistida de contas ausentes somente na confirmação.
- Prévia por destino, moeda e quantidade de movimentações.
- Um único lote de importação pode registrar múltiplas contas por meio de `accountIds`.

### Classificação e revisão

- Reconhecimento ampliado de descrições bancárias em português e inglês.
- Conversões com termos como `convertido`, `convertida` e variantes são excluídas do fluxo externo.
- Transferências com `enviado para`, `recebido de`, `sent to` e `received from` passam a ser reconhecidas tecnicamente.
- Créditos por cartão podem ser reconhecidos como reembolsos.
- Descrições bancárias extensas são reduzidas à identidade econômica do comerciante antes do agrupamento.
- A revisão continua baseada em grupos, preservando exceções e decisões manuais.
- Reembolsos sem vínculo não são mais tratados automaticamente como erro obrigatório de classificação.

### Identidade própria

- Novo perfil com nome, aliases, e-mails, IBANs e contas próprias.
- Identidade padrão inicial: `Diogo`.
- Frases direcionais fortes, como `Enviado para Diogo` ou `Recebido de Diogo`, podem ser reconhecidas como movimentação interna.
- O reconhecimento guarda confiança e evidências na própria movimentação.
- Nome isolado sem direção clara não é suficiente para uma decisão automática.
- Correção manual continua superior a qualquer inferência.

### Recorrência e finalidade

- Detecção conservadora de transferências recorrentes por destinatário, faixa de valor e intervalo entre datas.
- Exigência de histórico mínimo para propor um padrão.
- Finalidade, categoria, nome do grupo e pessoa relacionada são opcionais.
- Uma confirmação pode aplicar contexto a todas as movimentações ainda não detalhadas do grupo.
- Movimentações já detalhadas ajudam a sugerir finalidade para novas ocorrências.
- Exceções permanecem editáveis individualmente.

### Diagnóstico de contexto

Nova exportação JSON contendo:

- o que o aplicativo sabe;
- o que ele supõe;
- evidências e conflitos;
- lacunas de histórico;
- contas e cobertura de dados;
- grupos de revisão;
- recorrências;
- regras;
- sugestões de transferências internas;
- itens ainda sem contexto.

### Persistência e interface

- Estado atualizado para `schemaVersion: 10`.
- Migração automática a partir dos schemas 8 e 9.
- Migração reclassifica descrições antigas com o classificador técnico atualizado e reconstrói os grupos de revisão.
- Cabeçalho ajustado para manter marca, moeda e avatar na mesma região reservada, evitando sobreposição do conteúdo no iPhone.
- Cache do PWA atualizado para `japa-finance-shell-alpha5-3`.
- Versão do pacote atualizada para `0.9.0-alpha.5.3`.

## Validações executadas

Sem npm, Vite, Vitest, Supabase ou E2E.

Foram executados:

- compilação TypeScript estrita do núcleo modificado;
- verificação semântica estática dos 64 arquivos TypeScript/TSX não-testes com stubs somente para módulos externos;
- migração sintética de schema 9 para schema 10;
- normalização do backup real schema 8 com 281 movimentações;
- importação sintética Revolut contendo EUR e BRL no mesmo CSV;
- importação do fixture Wise BRL incluído no projeto;
- reconhecimento de comerciante em descrições bancárias extensas;
- identificação de conversão, reembolso e transferência para identidade própria;
- detecção de grupo mensal com valores próximos;
- reaproveitamento de finalidade confirmada anteriormente para novas ocorrências;
- geração do diagnóstico financeiro;
- comparação binária das migrations SQL e do cliente Supabase com a Alpha 5.2.

Resultados principais:

- núcleo TypeScript: aprovado;
- fontes não-testes: 64 arquivos sem erro semântico detectado;
- backup real: schema 10, 281 movimentações preservadas;
- CSV misto Revolut: EUR e BRL roteados para contas distintas, 0 bloqueios;
- fixture Wise BRL: parser Wise, 2 movimentações, 0 bloqueios;
- migrations SQL do Supabase: inalteradas.

## Limitações honestas

- O CSV original de dez meses usado pelo usuário não foi fornecido como arquivo nesta etapa. Portanto, o parser foi validado com fixtures e casos sintéticos representativos, mas ainda precisa do teste final com aquele arquivo exato.
- O sistema reduz revisão por agrupamento e regras explicáveis; ele não promete zerar revisões nem adivinhar finalidades sem evidência.
- A importação errada já feita antes desta versão não deve permanecer ativa durante a reimportação. O lote anterior precisa ser anulado no histórico de importações, ou deve ser restaurado um backup anterior, para não manter dados atribuídos à instituição errada e depois importar outra cópia correta.
- Linhas BRL rejeitadas por versões anteriores não existem no estado e só serão recuperadas ao reimportar o CSV original.
- Não houve teste interativo em Safari/iPhone real nesta execução.

## Supabase

Nenhuma migration SQL nova é necessária. O `schemaVersion: 10` pertence ao snapshot JSONB do aplicativo e é migrado pelo cliente.

## Procedimento recomendado após o deploy

1. Esperar o novo deploy ficar pronto.
2. Abrir o histórico de importações.
3. Anular o lote de dez meses que foi importado para a conta errada.
4. Importar novamente o CSV original.
5. Conferir a prévia de instituição, moedas e contas de destino antes de confirmar.
6. Exportar o diagnóstico financeiro após a importação para avaliar o contexto real.
