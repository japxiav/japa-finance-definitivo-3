import type { Category, Direction, TechnicalMovementType, TransactionKind } from '../core/types';
import { isCategoryReviewApplicable } from './technicalClassifier';

export function isCategoryCompatible(
  category: Category,
  input: { direction: Direction; kind: TransactionKind; technicalType?: TechnicalMovementType },
): boolean {
  if (!category.active) return false;
  if (input.technicalType && !isCategoryReviewApplicable(input.technicalType)) return false;
  if (input.kind === 'unknown') return false;
  if (input.kind === 'income') return category.type === 'income' || category.type === 'both' || category.type === 'system';
  if (input.kind === 'expense' || input.kind === 'refund') return category.type !== 'income';
  if (input.kind === 'transfer' || input.kind === 'adjustment') {
    return input.direction === 'inflow'
      ? category.type === 'income' || category.type === 'both' || category.type === 'system'
      : category.type !== 'income';
  }
  return false;
}
