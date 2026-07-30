export interface ParsedBankDate {
  canonicalAt: string;
  reportingDate: string;
}

function validDateParts(year: number, month: number, day: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year
    && check.getUTCMonth() === month - 1
    && check.getUTCDate() === day;
}

function normalizeTime(hours = '00', minutes = '00', seconds = '00'): string {
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  if (h > 23 || m > 59 || s > 59) throw new Error('Horário inválido');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
}

/**
 * Não usa new Date() em formatos ambíguos. DD/MM/YYYY nunca será interpretado
 * como MM/DD/YYYY silenciosamente.
 */
export function parseBankDate(raw: string): ParsedBankDate {
  const input = raw.trim();
  if (!input) throw new Error('Data vazia');

  const iso = input.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (iso) {
    const [, yearRaw, monthRaw, dayRaw, hour = '00', minute = '00', second = '00', zone] = iso;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!validDateParts(year, month, day)) throw new Error(`Data inválida: ${raw}`);
    const time = normalizeTime(hour, minute, second);
    const reportingDate = `${yearRaw}-${monthRaw}-${dayRaw}`;

    if (zone) {
      const normalizedZone = zone === 'Z'
        ? 'Z'
        : zone.includes(':')
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
      const instant = new Date(`${reportingDate}T${time}${normalizedZone}`);
      if (Number.isNaN(instant.valueOf())) throw new Error(`Data inválida: ${raw}`);
      return { canonicalAt: instant.toISOString(), reportingDate };
    }

    return { canonicalAt: `${reportingDate}T${time}`, reportingDate };
  }

  const dayFirst = input.match(
    /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    const [, dayRaw, monthRaw, yearRaw, hour = '00', minute = '00', second = '00'] = dayFirst;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!validDateParts(year, month, day)) throw new Error(`Data inválida: ${raw}`);
    const reportingDate = `${yearRaw}-${monthRaw.padStart(2, '0')}-${dayRaw.padStart(2, '0')}`;
    return {
      canonicalAt: `${reportingDate}T${normalizeTime(hour, minute, second)}`,
      reportingDate,
    };
  }

  throw new Error(`Formato de data não reconhecido: ${raw}`);
}

export function formatReportingDate(reportingDate: string): string {
  const match = reportingDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return reportingDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}


export function localCivilDate(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Converte um instante para a data civil do fuso local atual. */
export function localCivilDateFromInstant(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('Instante inválido');
  return localCivilDate(instant);
}


/** Converte um valor de <input type="datetime-local"> sem aceitar normalização silenciosa. */
export function localDateTimeToInstant(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Instante local inválido');
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59) {
    throw new Error('Instante local inválido');
  }
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute
  ) {
    throw new Error('Instante local inexistente no fuso atual');
  }
  return local.toISOString();
}
