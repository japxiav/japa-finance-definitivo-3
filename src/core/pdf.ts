import { previewBankCsv, type Preview } from './csv';
import type { AppState } from './types';

interface PositionedText {
  text: string;
  x: number;
  y: number;
}

interface PdfRow {
  date: string;
  description: string;
  details: string[];
  withdrawn?: string;
  received?: string;
  balance?: string;
  fee?: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', janeiro: '01', fev: '02', fevereiro: '02', mar: '03', março: '03', marco: '03',
  abr: '04', abril: '04', mai: '05', maio: '05', jun: '06', junho: '06', jul: '07', julho: '07',
  ago: '08', agosto: '08', set: '09', setembro: '09', out: '10', outubro: '10', nov: '11', novembro: '11',
  dez: '12', dezembro: '12',
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function toIsoDate(raw: string): string | undefined {
  const match = normalize(raw).match(/^(\d{1,2}) de ([a-z]+)\.? de (\d{4})$/);
  if (!match) return undefined;
  const month = MONTHS[match[2]];
  if (!month) return undefined;
  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
}

function join(items: PositionedText[]): string {
  return items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
}

function groupLines(items: PositionedText[]): PositionedText[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2.8);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.sort((a, b) => b[0].y - a[0].y);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function moneyForCsv(raw: string | undefined, negative: boolean): string {
  if (!raw) return '';
  const cleaned = raw.replace(/[^0-9,.-]/g, '').replaceAll('.', '').replace(',', '.');
  return `${negative ? '-' : ''}${cleaned.replace(/^-/, '')}`;
}

function typeFor(description: string): string {
  const text = normalize(description);
  if (text.includes('conversao cambial')) return 'Câmbio';
  if (text.startsWith('transferencia')) return 'Transferência';
  if (text.includes('carregamento') || text.includes('levantamento de subconta')) return 'Transferência';
  return 'Pagamento com cartão';
}

function buildCsv(rows: PdfRow[], currency: string): string {
  const headers = ['Tipo', 'Produto', 'Data de início', 'Data de Conclusão', 'Descrição', 'Montante', 'Comissão', 'Moeda', 'Estado', 'Saldo'];
  const body = rows.map((row) => {
    const amount = row.withdrawn ? moneyForCsv(row.withdrawn, true) : moneyForCsv(row.received, false);
    return [
      typeFor(row.description),
      'Atual',
      row.date,
      row.date,
      row.description,
      amount,
      moneyForCsv(row.fee, false),
      currency,
      'CONCLUÍDA',
      moneyForCsv(row.balance, false),
    ].map(csvCell).join(',');
  });
  return [headers.map(csvCell).join(','), ...body].join('\n');
}

async function extractRows(file: File): Promise<{ rows: PdfRow[]; currency: string }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const rows: PdfRow[] = [];
  let currency = 'EUR';
  let insideTransactions = false;
  let current: PdfRow | undefined;

  const flush = () => {
    if (!current) return;
    if ((current.withdrawn || current.received) && current.balance && current.description) rows.push(current);
    current = undefined;
  };

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned: PositionedText[] = (content.items as Array<{ str?: string; transform?: number[] }>)
      .filter((item) => item.str && item.transform)
      .map((item) => ({ text: item.str!, x: item.transform![4], y: item.transform![5] }));

    for (const lineItems of groupLines(positioned)) {
      const lineText = join(lineItems);
      const normalized = normalize(lineText);
      if (normalized.includes('extrato de brl')) currency = 'BRL';
      if (normalized.startsWith('transacoes de cofres pessoais')) {
        flush();
        return { rows, currency };
      }
      if (normalized.startsWith('operacoes da conta')) {
        insideTransactions = true;
        continue;
      }
      if (!insideTransactions) continue;
      if (normalized.startsWith('data descricao dinheiro') || normalized.startsWith('extrato de ') || normalized.startsWith('pagina ')) continue;
      if (normalized.includes('revolut sociedade') || normalized.startsWith('comunicar perda') || normalized.startsWith('obter ajuda') || normalized.startsWith('leia o codigo')) continue;

      const dateText = join(lineItems.filter((item) => item.x < 120));
      const isoDate = toIsoDate(dateText);
      const descriptionColumn = join(lineItems.filter((item) => item.x >= 120 && item.x < 330));
      const withdrawn = join(lineItems.filter((item) => item.x >= 330 && item.x < 415));
      const received = join(lineItems.filter((item) => item.x >= 415 && item.x < 525));
      const balance = join(lineItems.filter((item) => item.x >= 525));

      if (isoDate) {
        flush();
        current = {
          date: isoDate,
          description: descriptionColumn,
          details: [],
          withdrawn: withdrawn || undefined,
          received: received || undefined,
          balance: balance || undefined,
        };
        continue;
      }

      if (!current || !descriptionColumn) continue;
      if (/^(para|de|referencia|cartao|taxa de cambio):/i.test(normalize(descriptionColumn))) {
        current.details.push(descriptionColumn);
      } else if (/^comissao:/i.test(normalize(descriptionColumn))) {
        current.fee = descriptionColumn.match(/[0-9][0-9.,]*\s*[€R$]*/)?.[0];
        current.details.push(descriptionColumn);
      } else if (/^[0-9][0-9.,]*\s*r\$$/i.test(descriptionColumn.trim())) {
        current.details.push(descriptionColumn);
      } else {
        current.description = `${current.description} ${descriptionColumn}`.replace(/\s+/g, ' ').trim();
      }
    }
  }
  flush();
  return { rows, currency };
}

export async function previewRevolutPdf(file: File, state: AppState, accountId: string): Promise<Preview> {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account || account.institution !== 'revolut') throw new Error('PDF Revolut só pode ser importado para uma conta Revolut.');
  const { rows, currency } = await extractRows(file);
  if (!rows.length) {
    throw new Error('Este PDF parece ser digitalizado ou não é compatível. Exporte um extrato digital ou use CSV.');
  }
  const csv = buildCsv(rows, currency);
  const preview = await previewBankCsv(csv, file.name, state, accountId);
  return {
    ...preview,
    batch: { ...preview.batch, parserName: 'revolut_pdf', parserVersion: '0.1.0' },
    newTransactions: preview.newTransactions.map((transaction) => ({ ...transaction, source: 'revolut_pdf' })),
    possibleDuplicates: preview.possibleDuplicates.map((duplicate) => ({
      ...duplicate,
      transaction: { ...duplicate.transaction, source: 'revolut_pdf' },
    })),
  };
}
