
import { buildConsolidatedForecast } from '../domain/forecast';
import { evaluatePurchase } from '../domain/decisions';
import type {
  CivilDate,
  DecisionResult,
  FinancialState,
  ForecastResult,
} from '../domain/model';

export function runForecast(input: {
  state: FinancialState;
  reconciliationBatchId: string;
  horizonStart: CivilDate;
  horizonEnd: CivilDate;
}): ForecastResult {
  return buildConsolidatedForecast(input);
}

export function runPurchaseDecision(input: {
  state: FinancialState;
  reconciliationBatchId: string;
  horizonStart: CivilDate;
  horizonEnd: CivilDate;
  accountId: string;
  amountCents: number;
  purchaseDate: CivilDate;
}): { forecast: ForecastResult; decision: DecisionResult } {
  const forecast = buildConsolidatedForecast(input);
  const decision = evaluatePurchase({
    state: input.state,
    forecast,
    accountId: input.accountId,
    amountCents: input.amountCents,
    purchaseDate: input.purchaseDate,
  });
  return { forecast, decision };
}
