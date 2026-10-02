/** 产品线是团队空间，独立于组织产品组。ID 始终保留为字符串。 */
import { ipdGet, ipdPost, ipdPut } from './http';

export interface ProductLine {
  id: string;
  code: string;
  name: string;
  leaderPersonId: null | string;
  status: string;
}

export interface ProductLineMember {
  personId: string;
  status: string;
  reviewedBy: null | string;
}

export interface ProductLineProduct {
  id: string;
  code: string;
  name: string;
}

export interface ProductLineProject {
  id: string;
  code: string;
  name: string;
  currentStage: null | string;
  status: string;
}

export interface ProductLineDemand {
  id: string;
  title: string;
  status: string;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const string = (value: unknown): string => value == null ? '' : String(value);
const nullableString = (value: unknown): null | string => value == null || value === '' ? null : String(value);
const list = <T>(value: unknown, normalize: (item: unknown) => T): T[] => {
  if (!Array.isArray(value)) throw new Error('产品线接口返回格式错误');
  return value.map(normalize);
};

const line = (raw: unknown): ProductLine => {
  const value = object(raw);
  return { id: string(value.id), code: string(value.code), name: string(value.name), leaderPersonId: nullableString(value.leaderPersonId), status: string(value.status) };
};
const member = (raw: unknown): ProductLineMember => {
  const value = object(raw);
  return { personId: string(value.personId), status: string(value.status), reviewedBy: nullableString(value.reviewedBy) };
};
const product = (raw: unknown): ProductLineProduct => {
  const value = object(raw);
  return { id: string(value.id), code: string(value.code), name: string(value.name) };
};
const demand = (raw: unknown): ProductLineDemand => {
  const value = object(raw);
  return { id: string(value.id), title: string(value.title), status: string(value.status) };
};
const project = (raw: unknown): ProductLineProject => {
  const value = object(raw);
  return { id: string(value.id), code: string(value.code), name: string(value.name), currentStage: nullableString(value.currentStage), status: string(value.status) };
};

export const listProductLines = (): Promise<ProductLine[]> =>
  ipdGet<unknown>('/ipd/product-lines').then((value) => list(value, line));
export const listDiscoverableProductLines = (): Promise<ProductLine[]> =>
  ipdGet<unknown>('/ipd/product-lines/discoverable').then((value) => list(value, line));
export const createProductLine = (code: string, name: string): Promise<ProductLine> =>
  ipdPost<unknown>('/ipd/product-lines', { code, name }).then(line);
export const renameProductLine = (lineId: string, name: string): Promise<ProductLine> =>
  ipdPut<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/name`, { name }).then(line);
export const deactivateProductLine = (lineId: string): Promise<ProductLine> =>
  ipdPut<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/deactivate`).then(line);
export const applyToProductLine = (lineId: string): Promise<ProductLineMember> =>
  ipdPost<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/join-applications`).then(member);
export const leaveProductLine = (lineId: string): Promise<ProductLineMember> =>
  ipdPost<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/leave`).then(member);
export const removeProductLineMember = (lineId: string, personId: string): Promise<ProductLineMember> =>
  ipdPost<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/members/${encodeURIComponent(personId)}/remove`).then(member);
export const listPendingProductLineApplications = (lineId: string): Promise<ProductLineMember[]> =>
  ipdGet<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/join-applications`).then((value) => list(value, member));
export const reviewProductLineApplication = (lineId: string, personId: string, approve: boolean): Promise<ProductLineMember> =>
  ipdPost<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/join-applications/${encodeURIComponent(personId)}/review`, { approve }).then(member);
export const appointProductLineLeader = (lineId: string, personId: string): Promise<ProductLine> =>
  ipdPut<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/leader/${encodeURIComponent(personId)}`).then(line);
export const assignProductToLine = (lineId: string, productId: string): Promise<ProductLineProduct> =>
  ipdPut<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/products/${encodeURIComponent(productId)}`).then(product);
export const unassignProductFromLine = (lineId: string, productId: string): Promise<ProductLineProduct> =>
  ipdPut<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/products/${encodeURIComponent(productId)}/unassign`).then(product);
export const listProductLineProducts = (lineId: string): Promise<ProductLineProduct[]> =>
  ipdGet<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/products`).then((value) => list(value, product));
export const listProductLineProjects = (lineId: string): Promise<ProductLineProject[]> =>
  ipdGet<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/projects`).then((value) => list(value, project));
export const listProductLineDemands = (lineId: string): Promise<ProductLineDemand[]> =>
  ipdGet<unknown>(`/ipd/product-lines/${encodeURIComponent(lineId)}/demands`).then((value) => list(value, demand));
