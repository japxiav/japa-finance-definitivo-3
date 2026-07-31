# Japa Finance v0.9 Alpha 5 Foundation

## Objetivo desta entrega

Abrir a Alpha 5 pelo portão de estabilidade antes de ampliar o produto.

## Implementado

- Error Boundary global para impedir tela preta silenciosa em falhas de renderização.
- Tela segura de recuperação, sem apagar o estado local.
- Proteção contra toques repetidos e mutações concorrentes ao trocar categoria.
- App shell com altura `100dvh`, cabeçalho e navegação fixos e rolagem isolada no conteúdo.
- Safe areas do iPhone respeitadas.
- Redução de sobreposição de elementos flutuantes e de gestos acidentais.
- Versão marcada como `0.9.0-alpha.5-foundation`.

## Limite honesto desta entrega

Isto é a fundação da Alpha 5, não a implementação completa do escopo de saldo, Wise/Revolut, moedas, câmbio, finalidades e descobertas acionáveis.

A falha de tela preta não pôde ser reproduzida de forma determinística a partir das capturas. A proteção adicionada evita que uma exceção de renderização deixe a tela totalmente preta e reduz uma causa provável: alterações rápidas concorrentes na mesma categoria. O erro técnico passará a ficar visível na tela de recuperação.

## Validação executada

- Verificações estáticas das inserções e referências.
- Inspeção das rotas de alteração de categoria e montagem da aplicação.

Não foram executados npm, Vitest, Vite, Supabase ou E2E, conforme a regra do projeto.
