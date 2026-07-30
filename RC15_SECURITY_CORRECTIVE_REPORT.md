# Correção de isolamento e autorização — Japa Finance v0.7 RC15

Data: 30/07/2026

## Escopo

Correção exclusivamente do código existente. Não foram executados `npm install`, build Vite, navegador/E2E ou conexão com Supabase real.

## Defeitos corrigidos

### Isolamento entre sessões

- `FinanceApp` agora é remontado com `key={session.user.id}`.
- Cada instância fixa o `userId` do proprietário no primeiro render e bloqueia uma eventual divergência de sessão.
- Filas de salvamento deixam de continuar após desmontagem da instância.
- A resposta inicial de `getSession()` não pode sobrescrever um evento de autenticação mais recente.
- Cache, checkpoints, metadados de sincronização e estado remoto permanecem vinculados ao `userId` fixado.

### Autorização fail closed

- A interface não monta `FinanceApp` antes da confirmação remota.
- A autorização chama `current_user_is_allowed()` e exige retorno booleano literal `true`.
- A identidade autenticada é confirmada antes e depois da RPC e precisa coincidir com o usuário esperado.
- Falha de rede, RPC ausente, sessão trocada, identidade ausente ou retorno falso mantêm o cofre fechado.
- `VITE_ALLOWED_EMAIL` passou a ser somente uma barreira adicional; sua ausência nunca autoriza alguém por conta própria.

### Processo de verificação

- Adicionada suíte específica de autorização e isolamento.
- `verify:code` identifica a bateria que não depende de navegador ou serviços externos.
- `verify:local` inclui Vitest, verificadores de código e build.
- `verify:all` inclui também o teste RLS com dois usuários, deixando explícita a dependência de ambiente Supabase.
- A contagem histórica da RC14 foi corrigida de `58/59` para `60/60` testes operacionais.

## Verificações executadas nesta correção

- 60/60 testes operacionais aprovados.
- 13/13 verificações de autorização e isolamento aprovadas.
- Verificador de arquitetura aprovado.
- 11/11 verificações estruturais de sincronização aprovadas.
- Verificador de segurança endurecido e aprovado.
- Verificador estrutural de PWA aprovado.
- Arquivos alterados passaram por análise sintática TypeScript e checagem isolada de tipos com o compilador já disponível.

## Limites

Não foram executados instalação de dependências, build Vite, Vitest oficial, E2E, RPC real, RLS real ou deploy. A correção certifica o comportamento e as travas do código dentro do escopo local solicitado.

## Parecer

Os dois defeitos prioritários, mistura potencial de estado entre usuários e abertura da interface sem autorização remota, foram corrigidos no código e receberam travas específicas contra regressão.
