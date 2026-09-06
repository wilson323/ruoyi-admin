/**
 * 产品域 API（页16/17；后端 ProductController /api/v1/products）。
 *
 * path 不含 `/api/v1` 前缀（requestIpd 内部补齐）。
 *
 * 后端真值：
 * - GET /products?keyword= 裸 List 全量（keyword 匹配编码/名称/型号）；
 * - POST 白名单 productCode/productName/modelCode/source/groupId（CODE-01 不收 status/projectId）；
 *   source 仅 ADMIN_IMPORT（仅超管）| PM_NEW；GUEST_OTHER 不可手工创建；
 * - PUT /{id} 编辑白名单去 source；状态变更独立走 POST /{id}/status?status=；
 * - POST /batch-import 仅超管，行级隔离，来源强制 ADMIN_IMPORT；
 * - 产品组下拉复用 GET /product-groups（与 product-group.ts 同端点）。
 */
import { ipdGet, ipdPost, ipdPut } from './http';

export type ProductSource = 'ADMIN_IMPORT' | 'GUEST_OTHER' | 'PM_NEW';
export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'IN_RD' | 'ON_SALE';

export interface Product {
  groupId: null | string;
  id: string;
  modelCode: null | string;
  productCode: string;
  productName: string;
  projectId: null | string;
  source: null | string;
  status: ProductStatus | string;
}

/** 产品组（下拉用；完整组织管理见 product-group.ts）。 */
export interface ProductGroup {
  description?: null | string;
  groupName: string;
  id: string;
  leaderPersonId?: null | string;
  parentId?: null | string;
}

export interface ProductBody {
  groupId: null | string;
  modelCode: null | string;
  productCode: string;
  productName: string;
  source?: ProductSource;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
function asNullableString(value: unknown): null | string {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeProduct(raw: unknown): Product {
  const row = toRecord(raw);
  return {
    id: asString(row.id),
    productCode: asString(row.productCode),
    productName: asString(row.productName),
    modelCode: asNullableString(row.modelCode),
    groupId: asNullableString(row.groupId),
    projectId: asNullableString(row.projectId),
    source: asNullableString(row.source),
    status: asString(row.status),
  };
}

function normalizeGroup(raw: unknown): ProductGroup {
  const row = toRecord(raw);
  return {
    id: asString(row.id),
    groupName: asString(row.groupName),
    description: asNullableString(row.description),
    leaderPersonId: asNullableString(row.leaderPersonId),
    parentId: asNullableString(row.parentId),
  };
}

function normalizeList(data: unknown, normalize: (raw: unknown) => Product | ProductGroup): Product[] | ProductGroup[] {
  return Array.isArray(data) ? (data.map(normalize) as Product[] | ProductGroup[]) : [];
}

/** 产品列表（keyword 可选）。 */
export function listProducts(keyword?: string): Promise<Product[]> {
  return ipdGet<unknown>('/products', keyword ? { keyword } : undefined)
    .then((data) => normalizeList(data, normalizeProduct) as Product[]);
}

/** 产品组下拉（GET /product-groups；组织管理页用 product-group.ts 的完整版）。 */
export function listProductGroups(): Promise<ProductGroup[]> {
  return ipdGet<unknown>('/product-groups')
    .then((data) => normalizeList(data, normalizeGroup) as ProductGroup[]);
}

export function getProduct(id: string): Promise<Product> {
  return ipdGet<unknown>(`/products/${encodeURIComponent(id)}`).then(normalizeProduct);
}

/** 新增产品（source 仅 PM_NEW | ADMIN_IMPORT；ADMIN_IMPORT 仅超管）。 */
export function createProduct(body: ProductBody): Promise<Product> {
  return ipdPost<unknown>('/products', body).then(normalizeProduct);
}

/** 编辑产品（白名单 productCode/productName/modelCode/groupId；source 不可改）。 */
export function updateProduct(
  id: string,
  body: Omit<ProductBody, 'source'>,
): Promise<Product> {
  return ipdPut<unknown>(`/products/${encodeURIComponent(id)}`, {
    productCode: body.productCode,
    productName: body.productName,
    modelCode: body.modelCode,
    groupId: body.groupId,
  }).then(normalizeProduct);
}

/** 上架状态变更（POST /{id}/status?status=；独立于编辑白名单）。 */
export function changeProductStatus(id: string, status: ProductStatus | string): Promise<Product> {
  return ipdPost<unknown>(`/products/${encodeURIComponent(id)}/status`, undefined, { status }).then(normalizeProduct);
}

/** 批量导入（仅超管；行级隔离，来源强制 ADMIN_IMPORT；≤500 行；缺列在 API 层兜底）。 */
export function batchImportProducts(
  items: { groupId?: null | string; modelCode?: null | string; productCode?: string; productName?: string }[],
): Promise<unknown> {
  return ipdPost<unknown>('/products/batch-import', items.map((item) => ({
    productCode: String(item.productCode ?? ''),
    productName: String(item.productName ?? ''),
    modelCode: item.modelCode ?? null,
    groupId: item.groupId ?? null,
  })));
}

/** 绑定项目（1:1；query 传 projectId，空串表示解绑）。 */
export function bindProductProject(id: string, projectId: null | string): Promise<Product> {
  return ipdPost<unknown>(`/products/${encodeURIComponent(id)}/bind-project`, undefined, {
    projectId: projectId ?? '',
  }).then(normalizeProduct);
}

// ===== 产品组（页28 组织架构，2026-09-06 根因分析后从 product-group.ts 迁入）=====

/** 替换组长请求（与后端 ProductGroupLeaderReq 字段对齐）。 */
export interface ProductGroupLeaderReq {
  newLeaderPersonId: string;
}

/** 单组详情（含删除态；不存在时后端抛业务异常）。 */
export function getProductGroup(id: string): Promise<ProductGroup> {
  return ipdGet<unknown>(`/product-groups/${encodeURIComponent(id)}`).then(normalizeGroup);
}

/** 替换组长（仅超管；走 ProductGroupLeaderReq；HR 同步场景）。 */
export function updateProductGroupLeader(
  id: string,
  req: ProductGroupLeaderReq,
): Promise<ProductGroup> {
  return ipdPost<unknown>(
    `/product-groups/${encodeURIComponent(id)}/leader`,
    req,
  ).then(normalizeGroup);
}
