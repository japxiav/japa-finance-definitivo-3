# Changelog

## 0.9.0-alpha.5.3 - 2026-07-31

- Importação bancária passa a detectar Wise ou Revolut pelo arquivo, sem depender da conta escolhida anteriormente.
- Arquivos com mais de uma moeda são separados automaticamente entre contas da mesma instituição, incluindo EUR e BRL, com criação ou ativação assistida das contas ausentes.
- Prévia de importação mostra destinos por instituição, conta e moeda antes de gravar qualquer fato financeiro.
- Classificador técnico reconhece descrições bancárias extensas em português, conversões, transferências enviadas/recebidas e reembolsos por cartão.
- Agrupamento usa identidade normalizada do comerciante, reduzindo centenas de descrições verbosas a poucos grupos úteis de revisão.
- Adicionado perfil de identidade própria com nome, aliases, e-mails, IBANs e contas do titular.
- Transferências explicitamente enviadas para ou recebidas de uma identidade própria reconhecida podem ser excluídas do fluxo externo com evidência auditável; correções manuais continuam soberanas.
- Adicionada detecção conservadora de grupos recorrentes de transferências por destinatário, faixa de valor e frequência, com finalidade opcional aplicada ao grupo e preservação de exceções.
- Adicionado diagnóstico financeiro exportável com fatos, hipóteses, conflitos, lacunas, regras, recorrências e sugestões de vínculos internos.
- Estado migrado para `schemaVersion: 10`; backups schema 8 e 9 continuam migrando automaticamente.
- Cabeçalho e área rolável receberam ajustes para impedir sobreposição do seletor de moeda e avatar no iPhone.
- Nenhuma migration SQL do Supabase foi alterada; o novo contexto permanece dentro do snapshot JSONB existente.
- Validação feita por compilação TypeScript direta, verificação semântica estática e smoke tests determinísticos, sem npm, Vitest, Vite, Supabase ou E2E.

## 0.9.0-alpha.5 - 2026-07-31

- Adicionado saldo atual por conta e consolidado por moeda, com estado confirmado, estimado, desatualizado ou incompleto.
- Criada ponte auditável entre saldo reconciliado, fluxo externo, transferências/conversões, taxas, ajustes e saldo calculado.
- Adicionados dinheiro realmente livre, compromissos até a próxima receita e limite diário seguro.
- Reorganizada a navegação em Início, Movimentos, Planejar, Descobertas e Mais, com shell fixo e safe areas para PWA instalado no iPhone.
- Wise e Revolut permanecem instituições distintas; filtros e resumos preservam conta, instituição, moeda e origem do arquivo.
- Criada detecção de transferências entre contas próprias por valor, moeda, data e evidências de descrição, sempre sujeita a confirmação humana.
- Adicionados painel de moedas, taxas explícitas por instituição, volume convertido e câmbio efetivo para conversões vinculadas.
- Transferências externas podem ser divididas por finalidade, categoria, pessoa relacionada, nota e recorrência; a soma é validada contra o lançamento original.
- Itens recorrentes dentro de transferências podem gerar compromissos futuros e representar assinaturas compartilhadas.
- Descobertas foram separadas em Agora, Oportunidades e Padrões; linguagem causal e rótulos inadequados foram reduzidos.
- Adicionado painel de integridade com cobertura histórica, confiança do saldo, pendências, pares internos e conversões sem vínculo.
- Criada recuperação segura de tela por Error Boundary e proteção de mutações de categoria/tipo com preservação do estado anterior.
- Todos os botões receberam tipo explícito, evitando submissões acidentais de formulário e interações aparentemente aleatórias.
- Estado migrado para `schemaVersion: 9`, com migração automática de backups schema 8.
- Cache do service worker atualizado para Alpha 5.
- Validação feita por compilação TypeScript direta do núcleo, verificação semântica com stubs externos, transpilação estática e smoke tests determinísticos; npm, Vitest, Vite, Supabase e E2E não foram executados.

## 0.9.0-alpha.4 - 2026-07-31

- Adicionada busca ampliada e filtros por conta, categoria, intervalo, valor, direção, tipo técnico, origem e pendência.
- Adicionada exportação CSV do conjunto exatamente visível após os filtros.
- Filtros numéricos e intervalos inválidos agora são explicados e bloqueiam exportações/regras até a correção.
- Criadas regras de classificação em massa com prévia, escopo opcional, preservação de escolhas manuais e desfazer pelo histórico.
- Adicionada comparação entre período atual e anterior equivalente, incluindo entradas, despesas líquidas e resultado do fluxo.
- Criadas explicações determinísticas das variações, com destaque para a categoria de maior impacto.
- Comparações sem variação passam a ser apresentadas como estáveis, sem falso sinal positivo.
- Adicionada linha do tempo de importações, reconciliações, classificações, movimentações manuais e planejamentos.
- Mantido `schemaVersion: 8`; nenhuma migração de dados foi necessária.
- Cache do service worker atualizado para a nova entrega.
- Validação feita por typecheck direto, transpilação estática e smoke tests determinísticos, sem npm, Vitest, Vite, Supabase ou E2E.

## 0.9.0-alpha.3 - 2026-07-31

- Corrigido o filtro “Todos”: a lista e os indicadores agora usam o mesmo intervalo completo do extrato, em vez de a lista mostrar tudo e as métricas silenciosamente usarem apenas 30 dias.
- O cartão principal passou a se chamar “Resultado do fluxo”, exibe o intervalo exato e deixa explícito que fluxo não é saldo bancário.
- O parser Revolut reconhece `Comissão`/`Commission` e materializa taxas adicionais como movimentações separadas `bank_fee`, inclusive quando a operação principal é uma conversão excluída da análise; formatos cujo valor já é líquido não duplicam a taxa.
- Movimentações bancárias `REVERTIDA`/estornadas recebem status `reverted`, movimento líquido zero e não contaminam despesas, saldo ou revisão.
- A prévia de importação reconcilia livros separados por moeda e produto bancário, impedindo a mistura entre `Atual` e `Poupanças`.
- Pendências antigas fora do intervalo deixam de tornar o fluxo atual “provisório”; continuam visíveis como revisão histórica separada.
- A interface traduz o agrupamento analítico `uncategorized` para “Sem categoria” e exibe transações revertidas com valor riscado e sem edição financeira.
- Estado migrado para `schemaVersion: 8`, preservando backups v7 e criando fatos de taxa de forma determinística.
- Cache do service worker atualizado para evitar a permanência da interface anterior no iPhone.
- Validação feita por transpilação estática, typecheck direto do núcleo e smoke tests determinísticos, sem npm, Vitest, Vite, Supabase ou E2E.

## 0.9.0-alpha.2 - 2026-07-30

- Corrigida a exclusão indevida de transferências externas nos cálculos: recebidas contam como entrada e enviadas contam como saída.
- Mantida a exclusão somente para transferências internas e conversões de moeda.
- Tornada a categoria financeira efetivamente opcional, sem transformar o fluxo válido em resultado provisório.
- Adicionados `technicalType` e `categoryReviewStatus` ao estado persistido e às validações do domínio.
- Revisão por grupos agora guarda o estado em cada movimentação, permitindo adiar, reabrir e receber novas ocorrências do mesmo padrão corretamente.
- Adicionada ação “Manter sem categoria” para resolver grupos sem inventar uma classificação financeira.
- Regras, sugestões e exceções passam a respeitar o tipo técnico da movimentação.
- Histórico e desfazer restauram também o estado de revisão de categoria.
- Home e Motor de Insights distinguem pendências técnicas de oportunidades opcionais de categorização.
- Importação e migração reconhecem transferências recebidas, enviadas, internas e conversões de forma separada.
- Estado migrado para `schemaVersion: 7`.
- Cache do service worker atualizado para a nova entrega.
- Validação limitada a verificações estáticas, sem npm, Vitest, Vite, Supabase ou E2E.

## 0.9.0-alpha.1 - 2026-07-30

- Separado o tipo técnico da movimentação da categoria financeira opcional.
- Removida a categoria artificial `uncategorized` do domínio persistido; “Sem categoria” passa a ser apenas uma visão analítica.
- Criado pipeline explícito de identificação técnica, agrupamento, sugestões, revisão e regras.
- Adicionados `ReviewGroup`, sugestões com confiança, explicação e evidências.
- Adicionada revisão em massa por comerciante com seleção de movimentações e exceções individuais.
- Regras aprendidas agora podem ser limitadas por moeda, direção e tipo técnico.
- Adicionados “Resolver depois”, histórico de decisões e desfazer com restauração de categorias, regras e trilha de auditoria.
- Backups migrados para `schemaVersion: 6`, preservando dados legados e convertendo a antiga categoria “Sem categoria” em ausência real de categoria.
- Analytics e insights continuam operando mesmo quando parte das movimentações não tem categoria.
- Roadmap de inteligência financeira permanece explicitamente fora desta implementação.

## 0.8.0-rc.1 - 2026-07-30

- Adicionada Home orientada a decisões, com posição reconciliada, limite seguro, próximo compromisso, fluxo do período, qualidade dos dados e descobertas prioritárias.
- Criado Motor de Insights determinístico com prioridade, confiança, evidências, deduplicação, cooldown e linguagem sem causalidade falsa.
- Adicionada camada de métricas por período, categoria, comerciante, dia da semana, faixa horária, ticket médio, maior compra e sequência sem gastos.
- Criada tela Descobertas com detalhes, ações, dispensa temporária e feedback.
- Categorias padrão consolidadas em grupos amplos e suporte a criar, renomear, arquivar e restaurar categorias pessoais.
- Regras de comerciantes passam a ser aprendidas após confirmação e aplicadas sobre nomes normalizados.
- Importação Revolut reconhece carregamentos e levantamentos de subconta, carregamentos próprios, conversões e devoluções sem contaminar receitas e despesas.
- Prévia de importação separa classificações automáticas, transferências internas, reembolsos e itens que precisam de ajuda.
- Fluxos de reserva mínima e compromissos planejados deixaram de usar `window.prompt()` e receberam modais completos.
- Transações recentes passaram a usar ordenação decrescente explícita e a revisão mantém foco apenas nas pendências.
- `schemaVersion` atualizado para 5 com migração automática e preservação de contas e categorias personalizadas.
- Nenhuma chave, projeto ou migration nova do Supabase é necessária; os novos dados permanecem no snapshot JSONB existente.
- Adicionadas verificações específicas do Motor de Insights e validação agregada com CSV Revolut real.

## 0.7.0-rc.15 - 2026-07-30

- Corrigido isolamento de sessão com remontagem obrigatória do `FinanceApp` por `user.id`.
- Instância financeira vinculada ao usuário original como defesa adicional contra regressões.
- Filas de salvamento são interrompidas quando a instância é desmontada.
- Corrigida corrida entre carregamento inicial da sessão e eventos de autenticação mais recentes.
- Interface passou a exigir `current_user_is_allowed()` antes de carregar qualquer cache ou estado financeiro.
- Identidade é confirmada no servidor antes e depois da verificação da allowlist.
- Ausência de `VITE_ALLOWED_EMAIL`, falha de rede, RPC ausente ou retorno ambíguo não abrem mais o cofre.
- Adicionadas 13 verificações específicas de autorização, troca de usuário e particionamento do estado.
- `verify:all` passou a representar a bateria completa, incluindo testes, build e RLS; `verify:code` preserva o fluxo sem dependências externas.
- Corrigida a contagem documental da RC14 para 60/60 testes operacionais.

## 0.7.0-rc.14 - 2026-07-30

- Compra imediata e compra futura usam ordem intradiária conservadora, sem antecipar renda do mesmo dia nem ignorar saídas ativas ainda pendentes na data da reconciliação.
- Limite até a próxima renda considera despesas do dia do crédito antes da entrada.
- Recorrências sem término funcionam dentro do horizonte, intervalos abusivos são rejeitados e expansões além do limite civil encerram sem exceção.
- Transferências são isoladas corretamente por moeda e conjunto de contas.
- Reconciliação exige lote completo, timestamps canônicos e aceita saldos negativos válidos.
- Eventos com valor zero, datas impossíveis ou conta inativa são rejeitados ou enviados para revisão antes de contaminar o forecast.
- Backups recebem validação cruzada de conta, moeda, direção, tipo, datas, recorrências e referências.
- Datas civis locais e `datetime-local` são validadas sem normalização silenciosa.
- Parser do assistente prioriza valores monetários explícitos e evita adivinhar entre números ambíguos.
- Evidências do limite obedecem à mesma fronteira conservadora do cálculo e não exibem entradas intradiárias ignoradas.
- Backups rejeitam timestamps civis impossíveis, preservando compatibilidade com ISO UTC sem milissegundos.
- Suíte operacional ampliada para 60 cenários.
- Auditoria profissional adicionada com 2.000 cenários e decisões determinísticas/aleatórias.

## 0.6.0 - 2026-07-27

- Estado financeiro migrado para schema v4.
- Snapshots reconciliados de saldo por conta.
- Reserva mínima persistente por moeda.
- Eventos financeiros futuros e recorrentes.
- Projeção diária de caixa por moeda.
- Simulação determinística de saídas sem alterar o estado real.
- Cálculo de limite até ao próximo pagamento.
- Assistente ligado ao motor de previsão, com escopo de evidência explícito.
- Controles básicos no webapp para atualizar saldo, reserva e eventos futuros.
- Testes do motor de previsão e do assistente atualizados.

## 0.4.0

- coluna `revision` adicionada ao snapshot remoto;
- gravação remota alterada de `upsert` cego para compare-and-swap atômico;
- estado local guarda a revisão e o hash SHA-256 da última sincronização concluída;
- inicialização distingue: somente nuvem mudou, somente aparelho mudou e ambos mudaram;
- divergência sem metadados antigos vira conflito, nunca escolha silenciosa;
- modal de conflito compara contagem local/remota e permite backup antes da decisão;
- checkpoints criados antes de substituir qualquer uma das versões;
- 8 testes adicionados para sincronização e concorrência;
- migração incremental `002_optimistic_concurrency.sql` incluída.

## 0.3.0

- autenticação por e-mail e senha com Supabase Auth;
- persistência privada em `app_states` com RLS por usuário;
- fila serializada de salvamento para evitar gravações fora de ordem;
- cache local de emergência e checkpoints locais;
- quatro contas padrão: Revolut EUR/BRL e Wise EUR/BRL;
- seleção da conta de destino antes da importação;
- bloqueio de moeda incompatível com a conta;
- parser Wise adicionado;
- SHA-256 substitui FNV-1a como identidade forte do arquivo;
- FNV-1a permanece apenas para sinalizar semelhança revisável;
- linhas problemáticas persistidas em `importIssues`;
- importação parcial exige consentimento explícito;
- parser CSV rejeita colunas excedentes e aspas quebradas;
- parser monetário rejeita lixo misturado e aceita uma casa decimal;
- `categorySource: system` para classificações automáticas reais;
- transação manual e criação de contas adicionadas;
- restauração de backup JSON com validação;
- `balanceByAccount` documentado como movimento líquido importado;
- suíte ampliada para 27 testes.

## 0.2.0

- datas DD/MM corrigidas;
- duas compras iguais preservadas;
- deduplicação ambígua virou revisão;
- undo reversível;
- transferências separadas de despesas;
- reembolsos sem vínculo não alteram categorias;
- testes iniciais do Core e parser.
