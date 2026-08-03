import type { AppState, FinancialObject, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { normalizeEntityAlias } from './financialMemory';
import { buildFinancialRelationships } from './financialRelationships';

export type KnowledgeNodeType = 'owner' | 'account' | 'person' | 'merchant' | 'institution' | 'category' | 'financial_object';
export type KnowledgeEdgeType = 'owns' | 'uses' | 'sent_to' | 'received_from' | 'purchased_at' | 'categorized_as' | 'linked_to';

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  currency?: string;
  source: 'bank' | 'derived' | 'manual' | 'system';
  confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, string | number | boolean | undefined>;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  type: KnowledgeEdgeType;
  currency?: string;
  count: number;
  amountCents?: number;
  transactionIds: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface KnowledgeSnapshot {
  generatedAt: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  counts: Record<KnowledgeNodeType, number>;
  unresolvedEntityCount: number;
}

function nodeId(type: KnowledgeNodeType, key: string) {
  return `${type}:${normalizeEntityAlias(key) || key}`;
}

function addEdge(map: Map<string, KnowledgeEdge>, edge: Omit<KnowledgeEdge, 'id'>) {
  const id = `${edge.type}:${edge.from}:${edge.to}:${edge.currency ?? ''}`;
  const current = map.get(id);
  if (!current) {
    map.set(id, { ...edge, id });
    return;
  }
  current.count += edge.count;
  current.amountCents = (current.amountCents ?? 0) + (edge.amountCents ?? 0);
  current.transactionIds.push(...edge.transactionIds.filter((transactionId) => !current.transactionIds.includes(transactionId)));
}

function merchantLabel(transaction: Transaction): string | undefined {
  if (!['card_payment', 'direct_debit', 'other_expense', 'refund'].includes(transaction.technicalType)) return undefined;
  const value = transaction.merchantNormalized || transaction.friendlyDescription || transaction.descriptionOriginal;
  const normalized = normalizeEntityAlias(value);
  return normalized ? value.replace(/\s+/g, ' ').trim() : undefined;
}

function objectNode(object: FinancialObject): KnowledgeNode {
  return {
    id: `financial_object:${object.id}`,
    type: 'financial_object',
    label: object.title,
    currency: object.currency,
    source: object.source === 'manual' ? 'manual' : object.source === 'system' ? 'system' : 'derived',
    confidence: object.source === 'manual' ? 'high' : 'medium',
    metadata: { objectType: object.type, status: object.status, transactionCount: object.transactionIds.length },
  };
}

export function buildKnowledgeSnapshot(state: AppState): KnowledgeSnapshot {
  const nodes = new Map<string, KnowledgeNode>();
  const edges = new Map<string, KnowledgeEdge>();
  const ownerId = 'owner:self';
  nodes.set(ownerId, {
    id: ownerId,
    type: 'owner',
    label: state.ownerIdentity.displayName || 'Você',
    source: 'manual',
    confidence: 'high',
    metadata: { aliasCount: state.ownerIdentity.aliases.length, accountCount: state.ownerIdentity.ownAccountIds.length },
  });

  for (const account of state.accounts) {
    const accountNodeId = `account:${account.id}`;
    nodes.set(accountNodeId, {
      id: accountNodeId,
      type: 'account',
      label: account.name,
      currency: account.currency,
      source: account.source === 'manual' ? 'manual' : 'bank',
      confidence: 'high',
      metadata: { institution: account.institution, product: account.product, active: account.active },
    });
    const institutionId = nodeId('institution', account.institution);
    if (!nodes.has(institutionId)) nodes.set(institutionId, {
      id: institutionId,
      type: 'institution',
      label: account.institution === 'revolut' ? 'Revolut' : account.institution === 'wise' ? 'Wise' : account.institution,
      source: 'bank',
      confidence: 'high',
      metadata: {},
    });
    addEdge(edges, { from: ownerId, to: accountNodeId, type: 'owns', currency: account.currency, count: 1, transactionIds: [], confidence: 'high' });
    addEdge(edges, { from: accountNodeId, to: institutionId, type: 'uses', currency: account.currency, count: 1, transactionIds: [], confidence: 'high' });
  }

  for (const category of state.categories.filter((item) => item.active)) {
    const id = `category:${category.id}`;
    nodes.set(id, { id, type: 'category', label: category.name, source: category.system ? 'system' : 'manual', confidence: 'high', metadata: { categoryType: category.type } });
  }

  const currencies = [...new Set(state.accounts.map((account) => account.currency))];
  for (const currency of currencies) {
    for (const relationship of buildFinancialRelationships(state, currency)) {
      const personId = relationship.memoryEntityId ? `person:${relationship.memoryEntityId}` : nodeId('person', relationship.displayName);
      nodes.set(personId, {
        id: personId,
        type: 'person',
        label: relationship.displayName,
        currency,
        source: relationship.memoryEntityId ? 'manual' : 'derived',
        confidence: relationship.memoryEntityId ? 'high' : relationship.totalCount >= 3 ? 'medium' : 'low',
        metadata: { relationship: relationship.relationship, context: relationship.contextLabel, movementCount: relationship.totalCount },
      });
      if (relationship.sentCents > 0) addEdge(edges, { from: ownerId, to: personId, type: 'sent_to', currency, count: relationship.sentCount, amountCents: relationship.sentCents, transactionIds: relationship.transactionIds, confidence: 'high' });
      if (relationship.receivedCents > 0) addEdge(edges, { from: personId, to: ownerId, type: 'received_from', currency, count: relationship.receivedCount, amountCents: relationship.receivedCents, transactionIds: relationship.transactionIds, confidence: 'high' });
    }
  }

  for (const transaction of state.transactions) {
    if (transaction.status !== 'completed' || transaction.analysisExcluded) continue;
    const merchant = merchantLabel(transaction);
    if (merchant) {
      const merchantId = nodeId('merchant', transaction.merchantNormalized || merchant);
      if (!nodes.has(merchantId)) nodes.set(merchantId, {
        id: merchantId,
        type: 'merchant',
        label: merchant,
        currency: transaction.currency,
        source: 'bank',
        confidence: transaction.merchantNormalized ? 'high' : 'medium',
        metadata: {},
      });
      addEdge(edges, {
        from: ownerId,
        to: merchantId,
        type: 'purchased_at',
        currency: transaction.currency,
        count: 1,
        amountCents: transaction.direction === 'outflow' ? Math.abs(signedNetMovement(transaction)) : -Math.abs(signedNetMovement(transaction)),
        transactionIds: [transaction.id],
        confidence: 'high',
      });
      if (transaction.categoryId) addEdge(edges, { from: merchantId, to: `category:${transaction.categoryId}`, type: 'categorized_as', currency: transaction.currency, count: 1, transactionIds: [transaction.id], confidence: transaction.categorySource === 'manual' ? 'high' : 'medium' });
    }
  }

  for (const object of state.financialObjects) {
    const objectKnowledgeNode = objectNode(object);
    nodes.set(objectKnowledgeNode.id, objectKnowledgeNode);
    if (object.relationshipEntityId) addEdge(edges, { from: objectKnowledgeNode.id, to: `person:${object.relationshipEntityId}`, type: 'linked_to', currency: object.currency, count: 1, transactionIds: object.transactionIds, confidence: object.source === 'manual' ? 'high' : 'medium' });
    if (object.merchantNormalized) addEdge(edges, { from: objectKnowledgeNode.id, to: nodeId('merchant', object.merchantNormalized), type: 'linked_to', currency: object.currency, count: 1, transactionIds: object.transactionIds, confidence: object.source === 'manual' ? 'high' : 'medium' });
  }

  const nodeValues = [...nodes.values()];
  const counts = nodeValues.reduce((acc, node) => ({ ...acc, [node.type]: (acc[node.type] ?? 0) + 1 }), {
    owner: 0, account: 0, person: 0, merchant: 0, institution: 0, category: 0, financial_object: 0,
  } as Record<KnowledgeNodeType, number>);
  return {
    generatedAt: new Date().toISOString(),
    nodes: nodeValues,
    edges: [...edges.values()],
    counts,
    unresolvedEntityCount: nodeValues.filter((node) => (node.type === 'person' || node.type === 'merchant') && node.confidence === 'low').length,
  };
}
