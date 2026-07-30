
import { sha256Hex } from '../core/hash';

export type ImportLineClassification =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXACT_DUPLICATE'
  | 'POSSIBLE_DUPLICATE';

export interface NormalizedImportLine {
  accountId: string;
  date: string;
  amountCents: number;
  currency: string;
  description: string;
  externalReference?: string;
  sourceLineNumber: number;
}

export interface ImportLineFingerprint {
  exactFingerprint: string;
  semanticFingerprint: string;
}

function normalizeDescription(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('pt-IE')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fingerprintSourceFile(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

export async function fingerprintImportLine(
  line: NormalizedImportLine,
): Promise<ImportLineFingerprint> {
  const normalized = {
    accountId: line.accountId,
    date: line.date,
    amountCents: line.amountCents,
    currency: line.currency,
    description: normalizeDescription(line.description),
    externalReference: line.externalReference?.trim() || null,
  };
  const semanticFingerprint = await sha256Hex(JSON.stringify(normalized));
  const exactFingerprint = await sha256Hex(JSON.stringify({
    ...normalized,
    sourceLineNumber: line.sourceLineNumber,
  }));
  return { exactFingerprint, semanticFingerprint };
}

export function classifyImportLine(input: {
  exactFingerprint: string;
  semanticFingerprint: string;
  existingExactFingerprints: Set<string>;
  existingSemanticFingerprints: Set<string>;
  structurallyValid: boolean;
}): ImportLineClassification {
  if (!input.structurallyValid) return 'REJECTED';
  if (input.existingExactFingerprints.has(input.exactFingerprint)) return 'EXACT_DUPLICATE';
  if (input.existingSemanticFingerprints.has(input.semanticFingerprint)) return 'POSSIBLE_DUPLICATE';
  return 'ACCEPTED';
}
