/**
 * 合规中心 API（R215 GAP-F6，原 A23 预留码 COMPLIANCE_READ/WRITE 的视图承载接线）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/ComplianceController.java
 * （P2-5.1；ZK-IPD §九 合规，AC-COMP-01/02/03/04/05）：
 * - GET  /compliance/data-retention-rules            数据保留规则（ipd:compliance:read + requireInternal）
 * - POST /compliance/data-deletion-request           创建删除请求（ipd:compliance:write；
 *        actor 服务端会话推导——SEC-API-01 ComplianceController.java:38/:60，前端禁传 requesterId/operatorId）
 * - GET  /compliance/audit-trail/{type}/{id}         资源审计链 IPage 分页（ipd:compliance:read）
 * - GET  /compliance/permission-separation/{userId}  R/W 分离判定（ipd:compliance:read）
 *
 * 边界：与 deletion.ts（DeletionRequestController /deletion-requests 审批链）是两套后端表
 * 同屏不同链——本文件仅 compliance 侧删除「请求登记」，勿混用。
 * ID 归一口径：Long 经全局 BigNumberSerializer 双形态（>2^53 string / 安全区间 number），
 * 一律 String() 透传禁 Number()（19 位雪花精度）；retentionDays/pageNo 等计数类才 Number()。
 */
import type { IpdPage } from './bid';
import { ipdGet, ipdPost } from './http';

/** 数据保留规则行（DataRetentionRuleVO；retentionDays 为后端 int，恒数字）。 */
export interface DataRetentionRule {
  deletionPolicy: null | string;
  legalBasis: null | string;
  resourceType: string;
  retentionDays: number;
}

/** 删除请求登记结果（DataDeletionRequestVO；status=PENDING/PROCESSED/REJECTED，deadlineAt=now+30d）。 */
export interface DataDeletionRequestView {
  createdAt: null | string;
  deadlineAt: null | string;
  id: string;
  reason: null | string;
  resourceId: string;
  requesterId: string;
  resourceType: string;
  status: string;
}

/** 审计链条目（AuditEntryVO；before/after 为 JSON 字符串，seq/actorId/entityId 归一 string）。 */
export interface AuditEntryView {
  actorId: string;
  actorName: null | string;
  action: null | string;
  after: null | string;
  before: null | string;
  createTime: null | string;
  entityId: string;
  entityType: null | string;
  seq: string;
}

/** R/W 分离判定（PermissionSeparationVO；conflict=true 即同用户双持 compliance read+write，越权风险）。 */
export interface PermissionSeparationView {
  conflict: boolean;
  hasReadRole: boolean;
  hasWriteRole: boolean;
  roleList: string[];
  userId: string;
}

function strOr(v: unknown, fallback: null | string = null): null | string {
  return v == null ? fallback : String(v);
}

function normalizeDeletionRequest(raw: Record<string, unknown>): DataDeletionRequestView {
  return {
    createdAt: strOr(raw.createdAt),
    deadlineAt: strOr(raw.deadlineAt),
    id: String(raw.id ?? ''),
    reason: strOr(raw.reason),
    resourceId: String(raw.resourceId ?? ''),
    requesterId: String(raw.requesterId ?? ''),
    resourceType: String(raw.resourceType ?? ''),
    status: String(raw.status ?? ''),
  };
}

/** 数据保留规则清单（AC-COMP-01；内部全员，权限 ipd:compliance:read）。 */
export async function fetchRetentionRules(): Promise<DataRetentionRule[]> {
  const rows = await ipdGet<unknown[]>('/compliance/data-retention-rules');
  return (rows ?? []).map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      deletionPolicy: strOr(row.deletionPolicy),
      legalBasis: strOr(row.legalBasis),
      resourceType: String(row.resourceType ?? ''),
      retentionDays: Number(row.retentionDays ?? 0), // 计数类字段，int 安全范围内 Number 归一
    };
  });
}

/**
 * 创建数据删除请求（AC-COMP-02/03；权限 ipd:compliance:write）。
 * body 恰三键（DataDeletionRequestDTO）；resourceId string 透传（后端 Long 反序列化接受数字串）；
 * requesterId 由服务端 actor 推导，前端夹带无效且违反 SEC-API-01 审计口径。
 */
export async function createDataDeletionRequest(input: {
  reason: string;
  resourceId: string;
  resourceType: string;
}): Promise<DataDeletionRequestView> {
  const raw = await ipdPost<Record<string, unknown>>('/compliance/data-deletion-request', {
    reason: input.reason,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });
  return normalizeDeletionRequest(raw ?? {});
}

/** 资源审计链分页（AC-COMP-04；IPage 包络复用 bid.ts 口径，records 逐行 ID 归一）。 */
export async function fetchAuditTrail(
  resourceType: string,
  resourceId: string,
  pageNo?: number,
  pageSize?: number,
): Promise<IpdPage<AuditEntryView>> {
  const query: Record<string, unknown> = {};
  if (pageNo !== undefined) query.pageNo = pageNo;
  if (pageSize !== undefined) query.pageSize = pageSize;
  const page = await ipdGet<Partial<IpdPage<Record<string, unknown>>>>(
    `/compliance/audit-trail/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
    query,
  );
  const records = (page?.records ?? []).map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      actorId: String(row.actorId ?? ''),
      actorName: strOr(row.actorName),
      action: strOr(row.action),
      after: strOr(row.after),
      before: strOr(row.before),
      createTime: strOr(row.createTime),
      entityId: String(row.entityId ?? ''),
      entityType: strOr(row.entityType),
      seq: String(row.seq ?? ''),
    };
  });
  return {
    current: Number(page?.current ?? 1),
    pages: Number(page?.pages ?? 0),
    records,
    size: Number(page?.size ?? records.length),
    total: Number(page?.total ?? records.length),
  };
}

/** 用户 R/W 权限分离判定（AC-COMP-05；userId 后端 Long，string 透传）。 */
export async function checkPermissionSeparation(userId: string): Promise<PermissionSeparationView> {
  const raw = await ipdGet<Record<string, unknown>>(
    `/compliance/permission-separation/${encodeURIComponent(userId)}`,
  );
  const row = raw ?? {};
  return {
    conflict: row.conflict === true,
    hasReadRole: row.hasReadRole === true,
    hasWriteRole: row.hasWriteRole === true,
    roleList: Array.isArray(row.roleList) ? (row.roleList as unknown[]).map((r) => String(r ?? '')) : [],
    userId: String(row.userId ?? userId),
  };
}
