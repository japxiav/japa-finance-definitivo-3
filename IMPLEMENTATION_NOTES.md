# Japa Finance v0.5

Implementado nesta entrega:

- Home e navegação mobile próximas do protótipo.
- Abas Início, Movimentos, Assistente, Contas e Revisar.
- Assistente determinístico baseado no Finance Core.
- CSV oficial Revolut em português e inglês.
- Importação local de PDF digital da Revolut usando `pdfjs-dist`.
- PDF não é enviado nem armazenado no Supabase.
- Parser ignora a seção “Transações de Cofres Pessoais e de Grupo”.
- Importação PDF reutiliza o mesmo fluxo de prévia, reconciliação, duplicatas, revisão e confirmação do CSV.

Limitações atuais do PDF:

- Suporta inicialmente o layout de extrato Revolut em português.
- PDF escaneado/fotografado não é aceito.
- Mudanças futuras no layout do banco podem exigir nova versão do parser.

Antes de publicar, executar:

```bash
npm install
npm test
npm run build
```
