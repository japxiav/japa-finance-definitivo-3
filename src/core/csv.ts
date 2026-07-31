import { addCents, subtractCents } from '../domain/arithmetic';
import { parseBankDate } from './date';
import { sha256Hex, stableHash } from './hash';
import { matchRule, normalizeMerchant } from './merchant';
import { identifyTechnicalMovement, isCategoryReviewApplicable } from '../classification/technicalClassifier';
import { isCategoryCompatible } from '../classification/categoryCompatibility';
import { parseMoneyToCents, parseSignedMoneyToCents } from './money';
import type {
  Account,
  AppState,
  Direction,
  FeeTreatment,
  ImportBatch,
  ImportIssue,
  ParserName,
  PossibleDuplicate,
  ReviewReason,
  Transaction,
  TransactionStatus,
} from './types';

export const PARSER_VERSION = '0.7.0';

export interface CurrencyPreview {
  key: string;
  currency: string;
  product?: string;
  label: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  statementEndBalanceCents?: number;
  calculatedEndBalanceCents?: number;
  reconciliationDifferenceCents?: number;
  reconciliation: 'reconciled' | 'mismatch' | 'unavailable';
}

export interface Preview {
  batch: ImportBatch;
  account: Account;
  newTransactions: Transaction[];
  possibleDuplicates: PossibleDuplicate[];
  confirmedDuplicateIds: string[];
  issues: ImportIssue[];
  currencies: CurrencyPreview[];
  blockingIssueCount: number;
}

interface CsvDocument {
  headers: string[];
  rows: Record<string, string>[];
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return countDelimiterOutsideQuotes(firstLine, ';') > countDelimiterOutsideQuotes(firstLine, ',') ? ';' : ',';
}

function parseCsvDocument(text: string): CsvDocument {
  const source = text.replace(/^\uFEFF/, '');
  if (!source.trim()) throw new Error('CSV vazio');
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }

  if (quoted) throw new Error('CSV contém aspas não fechadas');
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV sem transações');

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('CSV contém cabeçalho vazio');
  if (new Set(headers.map(normalizedHeader)).size !== headers.length) throw new Error('CSV contém cabeçalhos duplicados');

  const mapped = rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`Linha ${index + 2} possui ${values.length} colunas; eram esperadas ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
  });
  return { headers, rows: mapped };
}

/** Compatibilidade com testes e ferramentas externas. */
export function parseCsvTable(text: string): Record<string, string>[] {
  return parseCsvDocument(text).rows;
}

function normalizedHeader(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');
}

function get(row: Record<string, string>, names: string[]): string {
  const wanted = new Set(names.map(normalizedHeader));
  const key = Object.keys(row).find((candidate) => wanted.has(normalizedHeader(candidate)));
  return key ? row[key] : '';
}

function hasAnyHeader(headers: string[], names: string[]): boolean {
  const normalized = new Set(headers.map(normalizedHeader));
  return names.some((name) => normalized.has(normalizedHeader(name)));
}

function parserNameFor(account: Account): ParserName {
  if (account.institution === 'wise') return 'wise_csv';
  return 'revolut_csv';
}

function validateKnownFormat(headers: string[], parserName: ParserName) {
  const amountNames = parserName === 'wise_csv'
    ? ['Amount', 'Value', 'Valor', 'Source amount', 'Target amount', 'Valor de origem', 'Valor de destino']
    : ['Amount', 'Total amount', 'Value', 'Valor', 'Montante'];
  const dateNames = parserName === 'wise_csv'
    ? ['Date', 'Data', 'Created on', 'Created at', 'Finished on', 'Transfer date', 'Data de criação', 'Data da transferência']
    : ['Completed Date', 'Started Date', 'Date', 'Finished at', 'Data', 'Data de conclusão', 'Data de início'];
  const descriptionNames = parserName === 'wise_csv'
    ? ['Description', 'Merchant', 'Counterparty', 'Recipient', 'Name', 'Details', 'Type', 'Descrição', 'Comerciante', 'Contraparte', 'Beneficiário', 'Nome', 'Detalhes', 'Tipo']
    : ['Description', 'Merchant', 'Counterparty', 'Name', 'Descrição', 'Comerciante', 'Contraparte', 'Nome', 'Detalhes'];

  const missing: string[] = [];
  if (!hasAnyHeader(headers, amountNames)) missing.push('valor');
  if (!hasAnyHeader(headers, dateNames)) missing.push('data');
  if (!hasAnyHeader(headers, descriptionNames)) missing.push('descrição');
  if (missing.length) {
    throw new Error(`Formato ${parserName === 'wise_csv' ? 'Wise' : 'Revolut'} não reconhecido. Faltam campos de ${missing.join(', ')}. Cabeçalhos encontrados: ${headers.join(', ')}`);
  }
}

function directionFromHint(raw: string): Direction | undefined {
  const value = raw.toLowerCase();
  if (/out|sent|debit|withdraw|payment|fee|charged|saída|saida|enviado|débito|debito|saque|pagamento|taxa|cobrado/.test(value)) return 'outflow';
  if (/in|received|credit|deposit|salary|refund|cashback|entrada|recebido|crédito|credito|depósito|deposito|salário|salario|reembolso/.test(value)) return 'inflow';
  return undefined;
}

function resolveWiseAmount(row: Record<string, string>, account: Account): { signedCents: number; currency: string } {
  const directAmount = get(row, ['Amount', 'Value', 'Valor']);
  const directCurrency = get(row, ['Currency', 'Amount currency', 'Moeda', 'Moeda do valor']);
  const directionHint = directionFromHint(`${get(row, ['Direction', 'Direção'])} ${get(row, ['Type', 'Tipo'])}`);

  if (directAmount) {
    let signedCents = parseSignedMoneyToCents(directAmount);
    if (signedCents >= 0 && directionHint === 'outflow') signedCents = -signedCents;
    return { signedCents, currency: (directCurrency || account.currency).toUpperCase() };
  }

  const sourceCurrency = get(row, ['Source currency', 'SourceCurrency', 'Moeda de origem']).toUpperCase();
  const targetCurrency = get(row, ['Target currency', 'TargetCurrency', 'Moeda de destino']).toUpperCase();
  const sourceAmount = get(row, ['Source amount', 'SourceAmount', 'Valor de origem']);
  const targetAmount = get(row, ['Target amount', 'TargetAmount', 'Valor de destino']);

  if (sourceCurrency === account.currency && sourceAmount) {
    return { signedCents: -parseMoneyToCents(sourceAmount), currency: sourceCurrency };
  }
  if (targetCurrency === account.currency && targetAmount) {
    return { signedCents: parseMoneyToCents(targetAmount), currency: targetCurrency };
  }
  throw new Error(`Não encontrei um valor em ${account.currency} nesta linha da Wise`);
}

function fingerprintBase(transaction: Pick<Transaction,
  'accountId' | 'reportingDate' | 'startedAt' | 'completedAt' | 'amountCents'
  | 'direction' | 'descriptionOriginal' | 'bankType' | 'bankProduct' | 'currency'
  | 'balanceAfterCents'
>): string {
  return stableHash(JSON.stringify([
    transaction.accountId,
    transaction.reportingDate,
    transaction.startedAt ?? '',
    transaction.completedAt ?? '',
    transaction.amountCents,
    transaction.direction,
    normalizeMerchant(transaction.descriptionOriginal),
    transaction.bankType ?? '',
    transaction.bankProduct ?? '',
    transaction.currency,
    transaction.balanceAfterCents ?? '',
  ]));
}

function addReason(reasons: ReviewReason[], reason: ReviewReason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function currencyPreviews(transactions: Transaction[]): CurrencyPreview[] {
  const ledgerMap = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const product = transaction.bankProduct?.trim() || 'Conta principal';
    const key = `${transaction.currency}|${product}`;
    const ledger = ledgerMap.get(key) ?? [];
    ledger.push(transaction);
    ledgerMap.set(key, ledger);
  }

  return [...ledgerMap.entries()].map(([key, ledger]): CurrencyPreview => {
    const relevant = ledger
      .filter((transaction) => transaction.status === 'completed' || transaction.status === 'reverted');
    const primaryRows = relevant
      .filter((transaction) => (transaction.sourceComponent ?? 'primary') === 'primary')
      .sort((a, b) => {
        const dateA = a.completedAt ?? a.startedAt ?? `${a.reportingDate}T00:00:00`;
        const dateB = b.completedAt ?? b.startedAt ?? `${b.reportingDate}T00:00:00`;
        return dateA.localeCompare(dateB) || (a.sourceRowNumber ?? 0) - (b.sourceRowNumber ?? 0);
      });
    const currency = primaryRows[0]?.currency ?? relevant[0]?.currency ?? key.split('|')[0]!;
    const product = primaryRows[0]?.bankProduct?.trim() || relevant[0]?.bankProduct?.trim() || undefined;
    const label = product ? `${currency} · ${product}` : currency;
    const movements = relevant
      .filter((transaction) => transaction.status === 'completed')
      .map((transaction) => transaction.netMovementCents
        ?? (transaction.direction === 'inflow' ? transaction.amountCents : -transaction.amountCents));
    const inflowCents = movements.filter((value) => value > 0).reduce((sum, value) => addCents(sum, value), 0);
    const outflowCents = movements.filter((value) => value < 0).reduce((sum, value) => addCents(sum, Math.abs(value)), 0);
    const netCents = movements.reduce((sum, value) => addCents(sum, value), 0);

    const balanceRows = primaryRows.filter((item) => item.status === 'completed' && item.balanceAfterCents !== undefined);
    if (!balanceRows.length) {
      return { key, currency, product, label, inflowCents, outflowCents, netCents, reconciliation: 'unavailable' };
    }

    const first = balanceRows[0]!;
    const last = balanceRows.at(-1)!;
    const firstRowMovement = relevant
      .filter((item) => item.status === 'completed'
        && item.sourceRowNumber === first.sourceRowNumber)
      .reduce((sum, item) => addCents(sum, item.netMovementCents
        ?? (item.direction === 'inflow' ? item.amountCents : -item.amountCents)), 0);
    const openingBalance = subtractCents(first.balanceAfterCents!, firstRowMovement);
    const calculatedEndBalanceCents = addCents(openingBalance, netCents);
    const statementEndBalanceCents = last.balanceAfterCents!;
    const reconciliationDifferenceCents = subtractCents(statementEndBalanceCents, calculatedEndBalanceCents);
    return {
      key,
      currency,
      product,
      label,
      inflowCents,
      outflowCents,
      netCents,
      statementEndBalanceCents,
      calculatedEndBalanceCents,
      reconciliationDifferenceCents,
      reconciliation: reconciliationDifferenceCents === 0 ? 'reconciled' : 'mismatch',
    };
  }).sort((a, b) => a.currency.localeCompare(b.currency) || a.label.localeCompare(b.label));
}

function transactionStatusFromBankState(raw: string): TransactionStatus {
  if (/revert|reversal|reversed|revertida|revertido|estornada|estornado/i.test(raw)) return 'reverted';
  if (/pending|processing|waiting|pendente|processando|aguardando/i.test(raw)) return 'pending';
  return 'completed';
}

function issue(params: Omit<ImportIssue, 'id' | 'createdAt' | 'status'> & { status?: ImportIssue['status'] }): ImportIssue {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: params.status ?? 'unresolved',
    ...params,
  };
}

export async function previewBankCsv(
  text: string,
  fileName: string,
  state: AppState,
  accountId: string,
): Promise<Preview> {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error('Conta de destino não encontrada');
  if (!['revolut', 'wise'].includes(account.institution)) throw new Error('Esta conta não aceita importação bancária');

  const parserName = parserNameFor(account);
  const importId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const fileHash = await sha256Hex(text);
  const document = parseCsvDocument(text);
  validateKnownFormat(document.headers, parserName);

  const parsedTransactions: Transaction[] = [];
  const issues: ImportIssue[] = [];
  const occurrenceByBase = new Map<string, number>();

  document.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const description = get(row, ['Description', 'Merchant', 'Counterparty', 'Recipient', 'Name', 'Details', 'Descrição', 'Comerciante', 'Contraparte', 'Beneficiário', 'Nome', 'Detalhes'])
        || get(row, ['Type', 'Tipo'])
        || 'Transação sem descrição';
      const rawStarted = get(row, ['Started Date', 'Started date', 'Started at', 'Created on', 'Created at', 'Data de início', 'Data de criação']);
      const rawCompleted = get(row, ['Completed Date', 'Completed date', 'Date', 'Finished at', 'Finished on', 'Transfer date', 'Data de conclusão', 'Data', 'Data da transferência']);
      const bankState = get(row, ['State', 'Status', 'Estado']);
      const bankType = get(row, ['Type', 'Direction', 'Tipo', 'Direção']);
      const bankProduct = get(row, ['Product', 'Produto']);
      if (!rawStarted && !rawCompleted) throw new Error('Data inicial e data concluída ausentes');

      const amount = parserName === 'wise_csv'
        ? resolveWiseAmount(row, account)
        : (() => {
          const raw = get(row, ['Amount', 'Total amount', 'Value', 'Valor', 'Montante']);
          if (!raw) throw new Error('Valor não encontrado');
          return {
            signedCents: parseSignedMoneyToCents(raw),
            currency: (get(row, ['Currency', 'Moeda']) || account.currency).toUpperCase(),
          };
        })();
      const amountCents = Math.abs(amount.signedCents);
      const reportedDirection: Direction = amount.signedCents < 0 ? 'outflow' : 'inflow';
      const parsedCompleted = rawCompleted ? parseBankDate(rawCompleted) : undefined;
      const parsedStarted = rawStarted ? parseBankDate(rawStarted) : undefined;
      const effectiveDate = parsedCompleted ?? parsedStarted;
      if (!effectiveDate) throw new Error('Não foi possível determinar a data da transação');

      if (amount.currency !== account.currency) {
        issues.push(issue({
          importId,
          accountId,
          kind: 'currency_mismatch',
          message: `Linha em ${amount.currency} não pode entrar na conta ${account.name} (${account.currency}).`,
          rowNumber,
          originalData: row,
        }));
        return;
      }

      const transactionStatus = transactionStatusFromBankState(bankState);
      if (transactionStatus === 'pending') {
        issues.push(issue({
          importId,
          accountId,
          kind: 'pending',
          message: 'Transação pendente no extrato; não foi gravada como fato concluído.',
          rowNumber,
          originalData: row,
        }));
        return;
      }

      const feeRaw = get(row, ['Fee', 'Commission', 'Source fee amount', 'Taxa', 'Comissão', 'Valor da taxa de origem']);
      const balanceRaw = get(row, ['Balance', 'Running balance', 'Saldo', 'Saldo corrente']);
      const feeCents = feeRaw.trim() ? parseMoneyToCents(feeRaw) : undefined;
      const feeTreatment = feeTreatmentForParser(parserName);
      const reportedAmountCents = amount.signedCents;
      const primaryNetMovementCents = transactionStatus === 'reverted' ? 0 : reportedAmountCents;
      const balanceAfterCents = balanceRaw.trim() ? parseSignedMoneyToCents(balanceRaw) : undefined;
      const direction: Direction = reportedDirection;
      const technical = identifyTechnicalMovement({ bankType, description, direction });
      const { kind, technicalType } = technical;
      const matchedRule = transactionStatus === 'completed' ? matchRule(description, state.rules, {
        currency: amount.currency,
        direction,
        kind,
        technicalType,
      }) : undefined;
      const ruleCategory = matchedRule
        ? state.categories.find((category) => category.id === matchedRule.categoryId)
        : undefined;
      const rule = matchedRule && ruleCategory && isCategoryCompatible(ruleCategory, { direction, kind, technicalType })
        ? matchedRule
        : undefined;
      const reviewReasons: ReviewReason[] = [];
      if (transactionStatus === 'completed') {
        if (technicalType === 'unknown') addReason(reviewReasons, 'unknown_kind');
        if (kind === 'refund') addReason(reviewReasons, 'unlinked_refund');
        if (amountCents === 0) addReason(reviewReasons, 'zero_amount');
      }

      const automaticIncome = transactionStatus === 'completed'
        && (technicalType === 'salary' || technicalType === 'other_income');
      const categoryId = transactionStatus === 'completed'
        ? (automaticIncome ? 'income' : rule?.categoryId)
        : undefined;
      const categorySource = categoryId ? (automaticIncome ? 'system' as const : 'rule' as const) : 'none' as const;
      const categoryReviewStatus = transactionStatus !== 'completed'
        ? 'not_applicable' as const
        : categoryId
          ? 'resolved' as const
          : isCategoryReviewApplicable(technicalType)
            ? 'pending' as const
            : 'not_applicable' as const;

      const seed = {
        accountId,
        reportingDate: effectiveDate.reportingDate,
        startedAt: parsedStarted?.canonicalAt,
        completedAt: parsedCompleted?.canonicalAt,
        amountCents,
        direction,
        descriptionOriginal: description,
        bankType,
        bankProduct,
        currency: amount.currency,
        balanceAfterCents,
      } as const;
      const base = fingerprintBase(seed);
      const occurrence = (occurrenceByBase.get(base) ?? 0) + 1;
      occurrenceByBase.set(base, occurrence);
      const dedupFingerprint = `${base}:${occurrence}`;
      const primaryId = crypto.randomUUID();

      parsedTransactions.push({
        id: primaryId,
        accountId,
        importId,
        bankTransactionId: get(row, ['Transaction ID', 'TransferWise ID', 'ID', 'Reference', 'Referência']) || undefined,
        dedupFingerprint,
        sourceFileHash: fileHash,
        sourceRowNumber: rowNumber,
        amountCents,
        reportedAmountCents,
        netMovementCents: primaryNetMovementCents,
        feeCents,
        feeTreatment,
        sourceFingerprint: `${fileHash}:${rowNumber}:primary`,
        sourceComponent: 'primary',
        semanticFingerprint: base,
        balanceAfterCents,
        currency: amount.currency,
        direction,
        source: parserName,
        status: transactionStatus,
        kind,
        technicalType,
        kindSource: kind === 'unknown' ? 'unknown' : 'bank',
        analysisExcluded: technical.analysisExcluded,
        descriptionOriginal: description,
        merchantNormalized: normalizeMerchant(description),
        bankType: bankType || undefined,
        bankProduct: bankProduct || undefined,
        bankState: bankState || undefined,
        startedAt: parsedStarted?.canonicalAt,
        completedAt: parsedCompleted?.canonicalAt,
        reportingDate: effectiveDate.reportingDate,
        categoryId,
        categorySource,
        categoryReviewStatus,
        transferGroupId: technical.internalTransfer ? `bank-internal:${base}` : undefined,
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        manualEditLog: [],
        originalData: row,
        createdAt,
        updatedAt: createdAt,
      });

      if (transactionStatus === 'completed' && feeTreatment === 'ADDITIONAL_TO_REPORTED_AMOUNT' && feeCents && feeCents > 0) {
        const feeBase = stableHash(`${base}|fee|${feeCents}`);
        const feeDescription = `Comissão de ${description}`;
        parsedTransactions.push({
          id: crypto.randomUUID(),
          accountId,
          importId,
          dedupFingerprint: `${feeBase}:1`,
          sourceFileHash: fileHash,
          sourceRowNumber: rowNumber,
          amountCents: feeCents,
          reportedAmountCents: -feeCents,
          netMovementCents: -feeCents,
          feeTreatment: 'INCLUDED_IN_REPORTED_AMOUNT',
          sourceFingerprint: `${fileHash}:${rowNumber}:fee`,
          sourceComponent: 'fee',
          feeOfTransactionId: primaryId,
          semanticFingerprint: feeBase,
          currency: amount.currency,
          direction: 'outflow',
          source: parserName,
          status: 'completed',
          kind: 'expense',
          technicalType: 'bank_fee',
          kindSource: 'bank',
          analysisExcluded: false,
          descriptionOriginal: feeDescription,
          merchantNormalized: normalizeMerchant(feeDescription),
          bankType: 'Comissão',
          bankProduct: bankProduct || undefined,
          bankState: bankState || undefined,
          startedAt: parsedStarted?.canonicalAt,
          completedAt: parsedCompleted?.canonicalAt,
          reportingDate: effectiveDate.reportingDate,
          categorySource: 'none',
          categoryReviewStatus: 'resolved',
          needsReview: false,
          reviewReasons: [],
          manualEditLog: [],
          originalData: row,
          createdAt,
          updatedAt: createdAt,
        });
      }
    } catch (error) {
      issues.push(issue({
        importId,
        accountId,
        kind: 'row_error',
        message: `Linha ${rowNumber}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        rowNumber,
        originalData: row,
      }));
    }
  });

  const existingBankIds = new Map(
    state.transactions
      .filter((transaction) => transaction.bankTransactionId)
      .map((transaction) => [`${transaction.accountId}|${transaction.bankTransactionId}`, transaction.id]),
  );
  const existingExactRows = new Map(
    state.transactions
      .filter((transaction) => transaction.sourceFileHash && transaction.sourceRowNumber)
      .map((transaction) => [`${transaction.accountId}|${transaction.sourceFileHash}|${transaction.sourceRowNumber}|${transaction.sourceComponent ?? 'primary'}`, transaction.id]),
  );
  const existingByFingerprint = new Map<string, string[]>();
  for (const transaction of state.transactions) {
    const semanticKey = transaction.semanticFingerprint ?? transaction.dedupFingerprint.replace(/:\d+$/, '');
    const ids = existingByFingerprint.get(semanticKey) ?? [];
    ids.push(transaction.id);
    existingByFingerprint.set(semanticKey, ids);
  }

  const seenBankIds = new Set<string>();
  const confirmedDuplicateIds: string[] = [];
  const confirmedDuplicateRows = new Set<number>();
  const newTransactions: Transaction[] = [];
  const possibleDuplicates: PossibleDuplicate[] = [];

  for (const transaction of parsedTransactions) {
    const bankKey = transaction.bankTransactionId ? `${transaction.accountId}|${transaction.bankTransactionId}` : undefined;
    const sourceKey = `${transaction.accountId}|${transaction.sourceFileHash}|${transaction.sourceRowNumber}|${transaction.sourceComponent ?? 'primary'}`;
    const existingBankMatch = bankKey ? existingBankIds.get(bankKey) : undefined;
    const repeatedBankIdInFile = bankKey ? seenBankIds.has(bankKey) : false;
    const exactSourceMatch = existingExactRows.get(sourceKey);
    if (bankKey) seenBankIds.add(bankKey);

    if (existingBankMatch || repeatedBankIdInFile || exactSourceMatch) {
      confirmedDuplicateIds.push(existingBankMatch ?? exactSourceMatch ?? transaction.id);
      if (transaction.sourceRowNumber) confirmedDuplicateRows.add(transaction.sourceRowNumber);
      continue;
    }

    const fingerprintMatches = existingByFingerprint.get(transaction.semanticFingerprint ?? transaction.dedupFingerprint.replace(/:\d+$/, '')) ?? [];
    if (fingerprintMatches.length) {
      const flagged: Transaction = {
        ...transaction,
        possibleDuplicateOfId: fingerprintMatches[0],
        needsReview: true,
        reviewReasons: [...new Set([...transaction.reviewReasons, 'possible_duplicate' as const])],
      };
      possibleDuplicates.push({
        transaction: flagged,
        matchedTransactionIds: fingerprintMatches,
        reason: 'Dados financeiros semelhantes, sem prova forte para descartar automaticamente.',
      });
      issues.push(issue({
        importId,
        accountId,
        kind: 'possible_duplicate',
        message: 'Possível duplicata. A transação não foi descartada automaticamente.',
        rowNumber: transaction.sourceRowNumber,
        transactionId: transaction.id,
        matchedTransactionIds: fingerprintMatches,
        originalData: transaction.originalData,
      }));
      continue;
    }
    newTransactions.push(transaction);
  }

  const reportingDates = parsedTransactions.map((transaction) => transaction.reportingDate).sort();
  const currencies = currencyPreviews(parsedTransactions);
  const blockingIssueCount = issues.filter((item) => item.kind === 'row_error' || item.kind === 'currency_mismatch' || item.kind === 'format_change').length;
  const batch: ImportBatch = {
    id: importId,
    accountId,
    fileName,
    fileHash,
    parserName,
    parserVersion: PARSER_VERSION,
    createdAt,
    status: 'active',
    rowsRead: document.rows.length,
    imported: newTransactions.filter((transaction) => (transaction.sourceComponent ?? 'primary') === 'primary').length,
    confirmedDuplicates: confirmedDuplicateRows.size,
    possibleDuplicates: new Set(possibleDuplicates.map((item) => item.transaction.sourceRowNumber).filter((row): row is number => Boolean(row))).size,
    pendingRows: issues.filter((item) => item.kind === 'pending').length,
    rejected: issues.filter((item) => item.kind === 'row_error' || item.kind === 'currency_mismatch').length,
    currencies: [...new Set(currencies.map((item) => item.currency))],
    firstReportingDate: reportingDates[0],
    lastReportingDate: reportingDates.at(-1),
  };

  return { batch, account, newTransactions, possibleDuplicates, confirmedDuplicateIds, issues, currencies, blockingIssueCount };
}

/** Compatibilidade com a API antiga. */
export function previewRevolutCsv(text: string, fileName: string, state: AppState, accountId = 'revolut-eur') {
  return previewBankCsv(text, fileName, state, accountId);
}
function feeTreatmentForParser(parserName: ParserName): FeeTreatment {
  // Revolut CSV reports the transaction amount separately from a non-zero fee
  // in the formats supported by this parser. Wise movements are treated as net
  // because its exported amount already reflects the account movement.
  return parserName === 'revolut_csv'
    ? 'ADDITIONAL_TO_REPORTED_AMOUNT'
    : 'INCLUDED_IN_REPORTED_AMOUNT';
}
