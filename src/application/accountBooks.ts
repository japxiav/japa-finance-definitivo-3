import type { Account, Institution } from '../core/types';

export function normalizeProductName(value?: string): string {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Conta principal';
  if (/^current$/i.test(cleaned)) return 'Atual';
  if (/^savings?$/i.test(cleaned)) return 'Poupanças';
  return cleaned;
}

export function productSlug(value?: string): string {
  return normalizeProductName(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-IE')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'principal';
}

export function accountBookId(institution: Institution, currency: string, product?: string): string {
  const base = `${institution}-${currency.toLocaleLowerCase('en-IE').replace(/[^a-z0-9]+/g, '-')}`;
  const normalizedProduct = normalizeProductName(product);
  const defaultProduct = institution === 'revolut' ? normalizedProduct === 'Atual' : normalizedProduct === 'Conta principal';
  return defaultProduct ? base : `${base}-${productSlug(normalizedProduct)}`;
}

export function accountBookName(institution: Institution, currency: string, product?: string): string {
  const institutionName = institution === 'revolut' ? 'Revolut' : institution === 'wise' ? 'Wise' : institution === 'cash' ? 'Dinheiro' : 'Conta';
  const normalizedProduct = normalizeProductName(product);
  const omitProduct = institution === 'wise' && normalizedProduct === 'Conta principal';
  return omitProduct ? `${institutionName} ${currency}` : `${institutionName} ${normalizedProduct} ${currency}`;
}

export function sameAccountBook(account: Account, institution: Institution, currency: string, product?: string): boolean {
  return account.institution === institution
    && account.currency === currency
    && normalizeProductName(account.product) === normalizeProductName(product);
}
