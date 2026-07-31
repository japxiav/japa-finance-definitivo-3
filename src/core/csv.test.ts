import { describe, expect, it } from 'vitest';
import { parseCsvTable, previewBankCsv, previewRevolutCsv } from './csv';
import { parseBankDate } from './date';
import { sha256Hex } from './hash';
import { normalizeMerchant } from './merchant';
import { parseSignedMoneyToCents } from './money';
import { initialState } from '../data/defaults';
import type { AppState } from './types';

const header = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance,Reference';
function stateWithTransactions(transactions: AppState['transactions']): AppState {
  return { ...initialState, transactions };
}

describe('parser monetário', () => {
  it('aceita ponto, vírgula, milhares e uma casa decimal', () => {
    expect(parseSignedMoneyToCents('-42.80')).toBe(-4280);
    expect(parseSignedMoneyToCents('-42,80')).toBe(-4280);
    expect(parseSignedMoneyToCents('1,234.56')).toBe(123456);
    expect(parseSignedMoneyToCents('1.234,56')).toBe(123456);
    expect(parseSignedMoneyToCents('1,2')).toBe(120);
  });

  it('rejeita lixo misturado ao valor', () => {
    expect(() => parseSignedMoneyToCents('abc12.34')).toThrow();
  });
});

describe('datas bancárias', () => {
  it('interpreta 03/07/2026 como 3 de julho', () => {
    expect(parseBankDate('03/07/2026 14:30:00')).toEqual({
      canonicalAt: '2026-07-03T14:30:00',
      reportingDate: '2026-07-03',
    });
  });
  it('rejeita formato desconhecido', () => expect(() => parseBankDate('July 3rd')).toThrow());
  it('preserva o dia bancário local mesmo quando o instante UTC cai no dia anterior', () => {
    expect(parseBankDate('2026-07-03T00:30:00+01:00')).toEqual({
      canonicalAt: '2026-07-02T23:30:00.000Z',
      reportingDate: '2026-07-03',
    });
  });
});

describe('CSV estrutural', () => {
  it('não descarta coluna excedente silenciosamente', () => {
    expect(() => parseCsvTable('A,B\n1,2,3')).toThrow(/3 colunas/);
  });
  it('rejeita aspas não fechadas', () => expect(() => parseCsvTable('A,B\n"1,2')).toThrow());
  it('usa SHA-256 forte para identidade do arquivo', async () => {
    const a = await sha256Hex('arquivo A');
    const b = await sha256Hex('arquivo B');
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
  });
});

describe('normalização de comerciante', () => {
  it('preserva números internos e trata acentos', () => {
    expect(normalizeMerchant('CAFÉ 7-Eleven #1234')).toBe('cafe 7 eleven');
  });
});

describe('Revolut CSV', () => {
  it('suporta delimitador ponto e vírgula', async () => {
    const csv = [
      header.replaceAll(',', ';'),
      'CARD_PAYMENT;Current;03/07/2026 10:00:00;03/07/2026 10:01:00;Costa Coffee;-3,50;;EUR;COMPLETED;996,50;abc',
    ].join('\n');
    const preview = await previewRevolutCsv(csv, 'julho.csv', initialState);
    expect(preview.newTransactions).toHaveLength(1);
    expect(preview.newTransactions[0].amountCents).toBe(350);
  });


  it('separa taxa adicional como fato bancário próprio e reconcilia diferença zero', async () => {
    const csv = [
      header,
      'TRANSFER,Current,2026-07-01 09:00:00,2026-07-01 09:01:00,Entrada,100.00,,EUR,COMPLETED,1100.00,in-1',
      'CARD_PAYMENT,Current,2026-07-02 10:00:00,2026-07-02 10:01:00,Compra com taxa,-100.00,2.20,EUR,COMPLETED,997.80,out-1',
    ].join('\n');
    const preview = await previewRevolutCsv(csv, 'taxa-real-anonimizada.csv', initialState);
    const movement = preview.newTransactions.find((item) => item.bankTransactionId === 'out-1');
    expect(movement?.reportedAmountCents).toBe(-10000);
    expect(movement?.feeCents).toBe(220);
    expect(movement?.netMovementCents).toBe(-10000);
    expect(movement?.feeTreatment).toBe('ADDITIONAL_TO_REPORTED_AMOUNT');
    const fee = preview.newTransactions.find((item) => item.sourceComponent === 'fee');
    expect(fee?.technicalType).toBe('bank_fee');
    expect(fee?.netMovementCents).toBe(-220);
    expect(fee?.feeOfTransactionId).toBe(movement?.id);
    expect(preview.batch.imported).toBe(2);
    expect(preview.currencies[0].reconciliationDifferenceCents).toBe(0);
    expect(preview.currencies[0].reconciliation).toBe('reconciled');
  });



  it('mapeia REVERTIDA sem criar despesa e preserva a linha para auditoria', async () => {
    const csv = [
      'Tipo,Produto,Data de início,Data de Conclusão,Descrição,Montante,Comissão,Moeda,Estado,Saldo',
      'Pagamento com cartão,Atual,2026-06-12 10:00:00,2026-06-12 10:01:00,Chatgpt,-1.00,0.00,EUR,REVERTIDA,',
    ].join('\n');
    const preview = await previewRevolutCsv(csv, 'revertida.csv', initialState);
    expect(preview.newTransactions[0].status).toBe('reverted');
    expect(preview.newTransactions[0].netMovementCents).toBe(0);
    expect(preview.newTransactions[0].needsReview).toBe(false);
  });

  it('reconcilia Atual e Poupanças como livros de saldo independentes', async () => {
    const csv = [
      'Tipo,Produto,Data de início,Data de Conclusão,Descrição,Montante,Comissão,Moeda,Estado,Saldo',
      'Transferência,Atual,2026-07-01 10:00:00,2026-07-01 10:00:00,Carregamento de subconta EUR teste de EUR,-50.00,0.00,EUR,CONCLUÍDA,50.00',
      'Transferência,Poupanças,2026-07-01 10:00:00,2026-07-01 10:00:00,Carregamento de subconta EUR teste de EUR,50.00,0.00,EUR,CONCLUÍDA,50.00',
    ].join('\n');
    const preview = await previewRevolutCsv(csv, 'produtos.csv', initialState);
    expect(preview.currencies).toHaveLength(2);
    expect(preview.currencies.map((item) => item.label)).toEqual(['EUR · Atual', 'EUR · Poupanças']);
    expect(preview.currencies.every((item) => item.reconciliation === 'reconciled')).toBe(true);
  });

  it('mantém duas compras iguais no mesmo dia', async () => {
    const csv = [
      header,
      'CARD_PAYMENT,Current,2026-07-10 10:00:00,2026-07-10 10:01:00,Costa Coffee,-3.50,,EUR,COMPLETED,996.50,',
      'CARD_PAYMENT,Current,2026-07-10 15:00:00,2026-07-10 15:01:00,Costa Coffee,-3.50,,EUR,COMPLETED,993.00,',
    ].join('\n');
    const preview = await previewRevolutCsv(csv, 'costa.csv', initialState);
    expect(preview.newTransactions).toHaveLength(2);
    expect(preview.newTransactions[0].dedupFingerprint).not.toBe(preview.newTransactions[1].dedupFingerprint);
  });

  it('reimportar o mesmo arquivo gera duplicata confirmada', async () => {
    const csv = [header, 'CARD_PAYMENT,Current,2026-07-10 10:00:00,2026-07-10 10:01:00,Costa Coffee,-3.50,,EUR,COMPLETED,996.50,'].join('\n');
    const first = await previewRevolutCsv(csv, 'costa.csv', initialState);
    const second = await previewRevolutCsv(csv, 'costa.csv', stateWithTransactions(first.newTransactions));
    expect(second.newTransactions).toHaveLength(0);
    expect(second.confirmedDuplicateIds).toHaveLength(1);
  });

  it('arquivo diferente com mesma transação vira possível duplicata', async () => {
    const csv = [header, 'CARD_PAYMENT,Current,2026-07-10 10:00:00,2026-07-10 10:01:00,Costa Coffee,-3.50,,EUR,COMPLETED,996.50,'].join('\n');
    const first = await previewRevolutCsv(csv, 'costa.csv', initialState);
    const second = await previewRevolutCsv(`${csv}\n`, 'outro.csv', stateWithTransactions(first.newTransactions));
    expect(second.confirmedDuplicateIds).toHaveLength(0);
    expect(second.possibleDuplicates).toHaveLength(1);
  });

  it('pendente vira issue persistível', async () => {
    const csv = [header, 'CARD_PAYMENT,Current,2026-07-10 10:00:00,,Costa Coffee,-3.50,,EUR,PENDING,996.50,'].join('\n');
    const preview = await previewRevolutCsv(csv, 'pendente.csv', initialState);
    expect(preview.issues.some((item) => item.kind === 'pending')).toBe(true);
    expect(preview.newTransactions).toHaveLength(0);
  });

  it('salário usa origem system, não rule inventada', async () => {
    const csv = [header, 'SALARY,Current,2026-07-01 09:00:00,2026-07-01 09:01:00,Kitchen Garden Payroll,1800.00,,EUR,COMPLETED,2796.50,'].join('\n');
    const preview = await previewRevolutCsv(csv, 'salario.csv', initialState);
    expect(preview.newTransactions[0].categoryId).toBe('income');
    expect(preview.newTransactions[0].categorySource).toBe('system');
  });

  it('aceita CSV oficial Revolut em português com Montante', async () => {
    const csv = [
      'Tipo,Produto,Data de início,Data de Conclusão,Descrição,Montante,Comissão,Moeda,Estado,Saldo',
      'Pagamento com cartão,Atual,2026-06-30 17:34:06,2026-07-01 13:50:43,Dunnes Stores,-8.49,0.00,EUR,CONCLUÍDA,6.36',
      'Transferência,Atual,2026-07-03 10:00:00,2026-07-03 10:01:00,Transferência recebida,108.00,0.00,EUR,CONCLUÍDA,114.36',
    ].join('\n');
    const preview = await previewRevolutCsv(csv, 'revolut-pt.csv', initialState);
    expect(preview.newTransactions).toHaveLength(2);
    expect(preview.newTransactions[0].amountCents).toBe(849);
    expect(preview.newTransactions[0].direction).toBe('outflow');
    expect(preview.newTransactions[1].amountCents).toBe(10800);
    expect(preview.newTransactions[1].direction).toBe('inflow');
  });

  it('bloqueia moeda diferente da conta escolhida', async () => {
    const csv = [header, 'CARD_PAYMENT,Current,2026-07-10 10:00:00,2026-07-10 10:01:00,Loja,-10.00,,BRL,COMPLETED,90.00,'].join('\n');
    const preview = await previewRevolutCsv(csv, 'brl.csv', initialState, 'revolut-eur');
    expect(preview.newTransactions).toHaveLength(0);
    expect(preview.blockingIssueCount).toBe(1);
  });
});

describe('Wise CSV', () => {
  it('importa extrato simples para Wise BRL', async () => {
    const csv = 'Date,Description,Amount,Currency,Running Balance,Status,ID\n03/07/2026,PIX recebido,100.00,BRL,250.00,COMPLETED,w1';
    const preview = await previewBankCsv(csv, 'wise.csv', initialState, 'wise-brl');
    expect(preview.batch.parserName).toBe('wise_csv');
    expect(preview.newTransactions[0].currency).toBe('BRL');
    expect(preview.newTransactions[0].amountCents).toBe(10000);
  });


  it('não duplica taxa da Wise quando o valor exportado já é líquido', async () => {
    const csv = 'Date,Description,Amount,Currency,Running Balance,Status,ID,Fee\n03/07/2026,Compra com taxa,-102.20,BRL,147.80,COMPLETED,w-fee,2.20';
    const preview = await previewBankCsv(csv, 'wise-fee.csv', initialState, 'wise-brl');
    expect(preview.newTransactions).toHaveLength(1);
    expect(preview.newTransactions[0].feeTreatment).toBe('INCLUDED_IN_REPORTED_AMOUNT');
    expect(preview.newTransactions[0].netMovementCents).toBe(-10220);
    expect(preview.newTransactions.some((item) => item.sourceComponent === 'fee')).toBe(false);
  });


  it('aceita cabeçalhos em português e direção explícita', async () => {
    const csv = 'Data,Descrição,Valor,Moeda,Saldo corrente,Estado,ID,Direção\n03/07/2026,Compra local,25.50,BRL,74.50,CONCLUÍDO,w2,SAÍDA';
    const preview = await previewBankCsv(csv, 'wise-pt.csv', initialState, 'wise-brl');
    expect(preview.newTransactions).toHaveLength(1);
    expect(preview.newTransactions[0].direction).toBe('outflow');
    expect(preview.newTransactions[0].amountCents).toBe(2550);
  });
});
