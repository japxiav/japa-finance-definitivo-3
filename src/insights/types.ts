export type InsightTone = 'positive' | 'warning' | 'neutral' | 'attention';
export type InsightConfidence = 'high' | 'medium' | 'low';
export type InsightAction = 'review' | 'transactions' | 'categories' | 'accounts' | 'assistant';

export interface InsightEvidence {
  label: string;
  value: string;
}

export interface FinancialInsight {
  id: string;
  key: string;
  family: string;
  title: string;
  message: string;
  tone: InsightTone;
  confidence: InsightConfidence;
  priority: number;
  novelty: number;
  evidence: InsightEvidence[];
  action?: InsightAction;
  actionLabel?: string;
  categoryId?: string;
  merchant?: string;
  period: { start: string; end: string };
}

export interface InsightEngineResult {
  generatedCount: number;
  eligibleCount: number;
  insights: FinancialInsight[];
}
