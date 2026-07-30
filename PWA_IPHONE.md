# PWA no iPhone

Pré-requisito: URL HTTPS publicada.

1. Abra a URL no Safari.
2. Toque em Compartilhar.
3. Escolha **Adicionar à Tela de Início**.
4. Ative **Abrir como App da Web**, quando exibido.
5. Abra pelo ícone Japa Finance.
6. Confirme que não há barra do Safari e que o app abre em modo standalone.
7. Entre, feche o app e abra novamente para validar sessão e recuperação remota.

A PWA usa cache somente do shell e de assets do mesmo domínio. Chamadas Supabase e dados financeiros não são adicionados ao cache pelo service worker. Navegação usa rede primeiro, reduzindo risco de manter JavaScript antigo.
