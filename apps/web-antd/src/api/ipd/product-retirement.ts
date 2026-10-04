import { ipdGet, ipdPost, ipdPut } from './http';

/** 原产品退市记录，所有身份编号保留字符串，版本用于并发更新。 */
export interface ProductRetirement {
  id: string;
  productId: string;
  proposerId: string;
  version: number;
  reason: string;
  status: string;
  rdLeaderId?: null | string;
  rdOpinion?: null | string;
  rdDecidedAt?: null | string;
  approvedAt?: null | string;
  rejectedAt?: null | string;
  marketingStopAt?: null | string;
  orderStopAt?: null | string;
  productionStopAt?: null | string;
  spareSupportStopAt?: null | string;
  softwareSupportStopAt?: null | string;
  softwareSupportPolicy?: null | string;
}
export interface RetirementHistoryEntry {
  operatorId: string;
  operatorName: string;
  action: string;
  reason: null | string;
  createTime: string;
}
export interface RetirementView {
  retirement: null | ProductRetirement;
  canSubmit: boolean;
  canEditPolicy: boolean;
  canDecide: boolean;
  history: RetirementHistoryEntry[];
}
export interface RetirementPolicyBody {
  expectedVersion: number;
  marketingStopAt: null | string;
  orderStopAt: null | string;
  productionStopAt: null | string;
  spareSupportStopAt: null | string;
  softwareSupportStopAt: null | string;
  softwareSupportPolicy: null | string;
}
export const fetchProductRetirement = (id: string): Promise<RetirementView> =>
  ipdGet(`/products/${encodeURIComponent(id)}/retirement`);
export const submitProductRetirement = (id: string, expectedVersion: number, reason: string): Promise<ProductRetirement> =>
  ipdPost(`/products/${encodeURIComponent(id)}/retirement`, { expectedVersion, reason });
export const editProductRetirementPolicy = (id: string, body: RetirementPolicyBody): Promise<ProductRetirement> =>
  ipdPut(`/products/${encodeURIComponent(id)}/retirement/policy`, {
    expectedVersion: body.expectedVersion,
    marketingStopAt: body.marketingStopAt,
    orderStopAt: body.orderStopAt,
    productionStopAt: body.productionStopAt,
    spareSupportStopAt: body.spareSupportStopAt,
    softwareSupportStopAt: body.softwareSupportStopAt,
    softwareSupportPolicy: body.softwareSupportPolicy,
  });
export const decideProductRetirement = (id: string, expectedVersion: number, decision: 'APPROVE' | 'REJECT', opinion: string): Promise<ProductRetirement> =>
  ipdPost(`/products/${encodeURIComponent(id)}/retirement/decision`, { expectedVersion, decision, opinion });
