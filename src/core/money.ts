/**
 * Interpreta valores monetários sem aceitar lixo misturado ao número.
 * Aceita: -42.80, -42,80, 1,234.56, 1.234,56, 1,2 e símbolos/códigos externos.
 */
export function parseSignedMoneyToCents(raw: string): number {
  const input = raw.trim();
  if (!input) throw new Error('Valor vazio');

  const negativeByParentheses = /^\(.*\)$/.test(input);
  const strippedCurrency = input
    // Códigos precisam sair antes dos símbolos. A regex antiga removia a letra
    // R de EUR/BRL e transformava valores perfeitamente válidos em lixo.
    .replace(/\b(?:EUR|BRL|GBP|USD)\b/gi, '')
    .replace(/R\$/gi, '')
    .replace(/[€£$]/g, '')
    .replace(/[()\s\u00a0]/g, '');

  if (!/^-?[0-9][0-9.,]*$/.test(strippedCurrency)) {
    throw new Error(`Formato monetário não reconhecido: ${raw}`);
  }

  const signCharacters = strippedCurrency.match(/-/g)?.length ?? 0;
  if (signCharacters > 1 || (signCharacters === 1 && !strippedCurrency.startsWith('-'))) {
    throw new Error(`Sinal monetário inválido: ${raw}`);
  }
  if (negativeByParentheses && strippedCurrency.startsWith('-')) {
    throw new Error(`Sinal monetário duplicado: ${raw}`);
  }

  const unsigned = strippedCurrency.replace('-', '');
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');
  let whole: string;
  let decimal = '';

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    const parts = unsigned.split(decimalSeparator);
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1] ?? '')) {
      throw new Error(`Formato monetário não reconhecido: ${raw}`);
    }
    const groupedWhole = parts[0] ?? '';
    const groupingPattern = new RegExp(`^\\d{1,3}(?:\\${thousandsSeparator}\\d{3})+$`);
    if (!/^\d+$/.test(groupedWhole) && !groupingPattern.test(groupedWhole)) {
      throw new Error(`Formato monetário não reconhecido: ${raw}`);
    }
    whole = groupedWhole.split(thousandsSeparator).join('');
    decimal = parts[1] ?? '';
  } else {
    const separator = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : undefined;
    if (!separator) {
      whole = unsigned;
    } else {
      const pieces = unsigned.split(separator);
      if (pieces.some((piece) => piece.length === 0)) {
        throw new Error(`Formato monetário não reconhecido: ${raw}`);
      }
      if (pieces.length === 2 && (pieces[1]?.length ?? 0) <= 2) {
        whole = pieces[0] ?? '';
        decimal = pieces[1] ?? '';
      } else {
        if (!/^\d{1,3}$/.test(pieces[0] ?? '') || pieces.slice(1).some((piece) => !/^\d{3}$/.test(piece))) {
          throw new Error(`Formato monetário não reconhecido: ${raw}`);
        }
        whole = pieces.join('');
      }
    }
  }

  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(decimal)) {
    throw new Error(`Formato monetário não reconhecido: ${raw}`);
  }

  const centsBigInt = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0') || '0');
  if (centsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Valor fora do limite seguro: ${raw}`);
  }

  const cents = Number(centsBigInt);
  const negative = negativeByParentheses || strippedCurrency.startsWith('-');
  return negative ? -cents : cents;
}

export function parseMoneyToCents(raw: string): number {
  return Math.abs(parseSignedMoneyToCents(raw));
}

export function parseOptionalMoneyToCents(raw: string): number | undefined {
  return raw.trim() ? parseMoneyToCents(raw) : undefined;
}

export function formatMoney(cents: number, currency = 'EUR') {
  if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário fora do limite seguro');
  const signed = BigInt(cents);
  const negative = signed < 0n;
  const absolute = negative ? -signed : signed;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  const formatter = new Intl.NumberFormat('pt-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formatted = formatter.formatToParts(whole)
    .map((part) => part.type === 'fraction' ? fraction : part.value)
    .join('');
  return negative ? `-${formatted}` : formatted;
}
