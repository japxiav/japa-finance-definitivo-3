# Japa Finance v0.9 Alpha 4 — Histórico e explicabilidade

Web app financeiro pessoal orientado a decisões. Ele não serve apenas para dizer quanto entrou e saiu. A proposta é responder, com dados verificáveis:

- **Como está meu dinheiro hoje?**
- **Quanto posso gastar sem atingir minha reserva?**
- **O que mudou no meu comportamento financeiro?**
- **Quais movimentações ainda precisam da minha ajuda?**

A versão 0.8 adiciona uma camada de análise local e determinística sobre o motor financeiro existente. Não há dependência de IA ou API paga para gerar os insights.



## Histórico e explicabilidade v0.9 Alpha 4

- busca por descrição, comerciante, nota e identificador bancário;
- filtros por conta, categoria, período, valor, direção, tipo técnico, origem e pendência;
- regras de classificação em massa com prévia, preservação de escolhas manuais e desfazer;
- comparação entre o período atual e o período anterior equivalente;
- explicações determinísticas para as principais variações;
- linha do tempo derivada de importações, reconciliações, classificações e planejamentos;
- exportação CSV exatamente do conjunto filtrado na tela.

A Alpha 4 não altera o schema persistido. As novas análises e a linha do tempo são derivadas do estado auditável já existente.

## Classificação v0.9 Alpha 3

A camada de classificação foi reorganizada para impedir que o banco, a categoria financeira e a revisão manual disputem o mesmo campo como três pessoas tentando dirigir o mesmo carro.

Fluxo atual:

```text
CSV → normalização → identificação técnica → agrupamento → sugestões → revisão → regras → insights
```

Principais mudanças:

- `technicalType` guarda o fato bancário: salário, cartão, saque, débito direto, transferência recebida ou enviada, transferência interna, conversão, reembolso e outros;
- `kind` permanece como natureza financeira ampla, sem substituir o tipo técnico;
- `categoryId` é opcional e o aplicativo funciona com movimentações sem categoria;
- transferências externas entram no fluxo pela direção; apenas transferências internas e conversões ficam fora de receitas e despesas;
- movimentações são agrupadas por comerciante, moeda, direção e tipo técnico;
- sugestões informam confiança, explicação e evidências;
- a revisão permite aplicação em massa, exceções individuais, “manter sem categoria” e “resolver depois”;
- regras aprendidas possuem escopo técnico e aceitam exceções;
- decisões de revisão são registradas e podem ser desfeitas;
- grupos sem categoria melhoram gráficos e insights, mas não tornam o fluxo financeiro inválido;
- o estado usa `schemaVersion: 8`, com migração automática das versões anteriores.

## Correções de auditoria da Alpha 3

- “Todos” agora representa o histórico completo tanto na lista quanto nos indicadores;
- o fluxo mostra seu intervalo exato e não usa mais a expressão ambígua “O que sobrou”;
- taxas adicionais do Revolut são fatos financeiros separados do movimento principal, sem duplicar formatos já líquidos;
- operações revertidas têm efeito líquido zero;
- `Atual` e `Poupanças` são reconciliados como livros distintos;
- pendências fora do intervalo não rebaixam a confiança do período atual;
- “Sem categoria” é exibido em português, embora a chave analítica interna continue estável.

## Principais novidades da v0.8

### Home orientada a decisões

- posição reconciliada por moeda;
- limite seguro calculado pelo motor financeiro;
- próximo compromisso planejado;
- fluxo do período separado do saldo da conta;
- resultado provisório quando existem pendências;
- explicação de como cada número foi calculado;
- três descobertas priorizadas em vez de um mural de gráficos decorativos.

### Motor de Insights

O módulo `src/insights` recebe métricas estruturadas e gera análises auditáveis, com prioridade, confiança, evidências e deduplicação.

Entre as famílias implementadas estão:

- aumento ou redução das despesas;
- mudanças por categoria;
- concentração por categoria e comerciante;
- dias e horários de maior gasto;
- maior transação e variação do ticket médio;
- sequência de dias sem despesas variáveis;
- comportamento após entradas;
- assinaturas recorrentes;
- evolução da posição reconciliada e da reserva;
- pressão dos compromissos futuros;
- qualidade e cobertura dos dados;
- combinações cuidadosas de fatos, sem afirmar causalidade que os dados não provam.

Cada descoberta pode mostrar a base utilizada, por exemplo: período atual, período anterior, número de transações e valores comparados.

### Descobertas

A nova tela reúne análises relevantes e permite:

- abrir a evidência de cada cálculo;
- navegar para os movimentos envolvidos;
- dispensar um insight por 30 dias;
- marcar a análise como útil ou não útil.

### Categorias amplas e personalizadas

A versão inclui categorias padrão como Mercado, Alimentação, Compras, Transporte, Assinaturas, Moradia, Lazer, Saúde, Família, Educação, Música, Trabalho e Outros.

Também é possível:

- criar categorias próprias;
- renomear;
- arquivar e restaurar;
- manter o histórico das transações ligadas a uma categoria arquivada.

As análises são genéricas. Uma categoria criada pelo usuário passa a participar automaticamente dos filtros, resumos e insights, sem exigir uma regra especial escrita à mão.

### Aprendizado de comerciantes

Quando o usuário corrige uma classificação, o app pode guardar uma regra pessoal para o comerciante:

```text
Vinted → Compras
Spotify → Assinaturas
Irish Rail → Transporte
```

Variações do nome são normalizadas antes da aplicação da regra. Movimentações duvidosas continuam pedindo confirmação, em vez de o software inventar uma certeza com a serenidade típica de computadores e consultores.

### Importação Revolut revisada

- carregamentos e levantamentos de subconta reconhecidos como transferências internas;
- carregamentos próprios reconhecidos como transferência, não renda;
- devoluções de cartão reconhecidas como reembolso;
- resumo da prévia mostra classificadas automaticamente, transferências, reembolsos e itens que precisam de ajuda;
- movimentos recentes são exibidos do mais novo para o mais antigo;
- transferências externas contam como entradas ou saídas de caixa;
- transferências internas e conversões não contaminam receitas e despesas.

## Arquitetura da análise

```text
Estado financeiro validado
        ↓
Métricas derivadas
        ↓
Famílias de regras
        ↓
Validação de amostra e confiança
        ↓
Prioridade, deduplicação e cooldown
        ↓
Templates de linguagem
        ↓
Home e Descobertas
```

O motor de insights não altera saldos, previsões, reservas ou movimentações. Ele apenas lê os resultados do núcleo financeiro e os explica.

## Persistência e migração

- a v0.8 introduziu `schemaVersion: 5`; a Alpha 1 usou a versão 6, a Alpha 2 a versão 7 e a Alpha 3 migra o estado para `schemaVersion: 8`;
- migração automática dos estados v2, v3 e v4;
- categorias antigas `clothing` e `games` são remapeadas para `shopping`;
- contas e categorias personalizadas existentes são preservadas;
- regras pessoais de comerciantes e feedback dos insights são salvos no mesmo estado JSONB.

**Não é necessário trocar chaves, criar outro projeto, refazer autenticação ou aplicar uma migration nova no Supabase para esta versão.** A coluna existente de versão do estado aceita o novo número e o conteúdo continua no snapshot JSONB já usado pelo app.

## Atualizar o mesmo repositório

Trabalhe em uma branch para manter a versão publicada intacta enquanto a prévia da Vercel compila:

```bash
git checkout -b feature/insight-engine
# copie os arquivos desta entrega sobre o projeto atual
git add .
git commit -m "Adiciona motor de insights e nova experiência"
git push -u origin feature/insight-engine
```

Depois de validar a prévia, faça o merge para a branch ligada à produção. Não crie outro repositório e não altere as variáveis existentes da Vercel ou do Supabase.

## Rodar localmente

```bash
npm install
npm test
npm run build
npm run dev
```

O projeto exige Node 22.

## Verificações desta entrega

A Alpha 3 foi revisada sem executar npm, Vitest, build Vite, Supabase ou E2E.

Foram realizados:

- transpilação sintática de 54 arquivos TypeScript/TSX, com 0 diagnósticos;
- verificação estrita dos módulos internos de domínio, persistência, CSV, classificação, finanças, métricas e insights;
- busca estática por construções antigas sem `technicalType` ou `categoryReviewStatus`;
- revisão da migração v6 → v7;
- revisão do tratamento de transferências externas, internas e conversões no fluxo financeiro.

Essa validação confirma a consistência estática da implementação, mas não substitui a prévia no ambiente normal do projeto.

## Arquivos de referência

- `V0.8_INSIGHTS_IMPLEMENTATION_REPORT.md`
- `CLASSIFICATION_ALPHA2_REPORT.md`
- `CHANGELOG.md`
- `SUPABASE_SETUP.md`
- `VERCEL_DEPLOY.md`
- `PWA_IPHONE.md`
