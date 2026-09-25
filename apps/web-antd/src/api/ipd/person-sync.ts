/**
 * 人员同步任务管理接口封装（R215 GAP-F7；卡 e9721c5c，人员同步任务页 5 端点全接）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/PersonSyncController.java
 * （基路径 /api/v1/person-sync :29；权限为代码内 require*，端点无 @SaCheckPermission 注解码——
 * 前端零权限码登记，凭空登记=镜像污染，沿 F3 卡裁决）：
 * - POST /jobs           提交同步任务（requireLeaderOrAdmin :53；body SubmitRequest{employeeNo @NotBlank, idempotencyKey 选填}）
 * - POST /jobs/{id}/retry 单任务重试（requireLeaderOrAdmin :62；仅 FAILED 且 attempts<maxAttempts，否则 STATE_CONFLICT）
 * - POST /jobs/retry-all  批量回补（requireAdmin 仅超管 :71）
 * - GET  /jobs            列出所有任务（requireAdmin :82；卡面漏计的第 5 条孤儿，纠偏节②）
 * - GET  /jobs/abnormal   列出异常项 FAILED only（requireAdmin :90）
 *
 * 契约口径：
 * - jobId 格式 `sync-<uuid8>-<seq>`（PersonSyncService.java:114），非雪花但同样禁 Number()；
 * - SyncJobView（PersonSyncService.java:52-55）Instant 字段（nextRetryAt/createdAt/updatedAt）
 *   前端按 string 原样透传展示，严禁日期运算（全局口径，JacksonConfig 未定制 Instant）；
 * - attempts/maxAttempts 与 BatchRetryView 四计数是唯一 Number() 归一点（int 计数类）；
 * - status 值域 PENDING|SUCCESS|FAILED|RETRYING（枚举 :46）、failureKind 值域
 *   TRANSIENT|PERMANENT|null（枚举 :49）——未知值原样透传不炸列表（值域守卫只做类型归一）。
 *
 * 幂等语义：同 (operatorId, groupId, idempotencyKey) 重放返原 jobId 不新建（service :100-111），
 * 重试按钮可安全连点，但 UI 仍应防抖（视图层 loading 门禁）。
 */
import { ipdGet, ipdPost } from './http';

/** 任务状态（PersonSyncService.JobStatus；未知值透传兜底 string）。 */
export type SyncJobStatus = 'FAILED' | 'PENDING' | 'RETRYING' | 'SUCCESS' | string;

/** 异常分类（PersonSyncService.FailureKind；SUCCESS 行为 null）。 */
export type SyncFailureKind = 'PERMANENT' | 'TRANSIENT' | string;

/** 同步任务行（SyncJobView 归一：ID/时间 string 透传，仅 attempts/maxAttempts Number）。 */
export interface SyncJob {
  attempts: number;
  createdAt: null | string;
  employeeNo: string;
  failureKind: null | string;
  failureReason: null | string;
  jobId: string;
  maxAttempts: number;
  nextRetryAt: null | string;
  status: string;
  updatedAt: null | string;
}

/** 提交响应（SubmitResponse{jobId, status}）。 */
export interface SyncJobSubmitResult {
  jobId: string;
  status: string;
}

/** 批量回补统计（BatchRetryView 四计数，int）。 */
export interface SyncBatchRetryResult {
  failed: number;
  retried: number;
  skipped: number;
  succeeded: number;
}

/** SyncJobView 行归一（仿 hr-sync.ts normalize 范式；Instant 字段 string 透传不做 Date()）。 */
function normalizeJob(raw: unknown): SyncJob {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    attempts: Number(row.attempts ?? 0),
    createdAt: row.createdAt == null ? null : String(row.createdAt),
    employeeNo: String(row.employeeNo ?? ''),
    failureKind: row.failureKind == null ? null : String(row.failureKind),
    failureReason: row.failureReason == null ? null : String(row.failureReason),
    jobId: String(row.jobId ?? ''),
    maxAttempts: Number(row.maxAttempts ?? 0),
    nextRetryAt: row.nextRetryAt == null ? null : String(row.nextRetryAt),
    status: String(row.status ?? ''),
    updatedAt: row.updatedAt == null ? null : String(row.updatedAt),
  };
}

/**
 * 提交同步任务（超管+组长）。idempotencyKey 选填：undefined 不塞键（后端重放语义按 key 判等，
 * 显式 null 与缺省在后端同义，但前端不发 null 防序列化差异）。
 * 对应 PersonSyncController#submit — POST /person-sync/jobs（body SubmitRequest）
 */
export async function submitSyncJob(employeeNo: string, idempotencyKey?: string): Promise<SyncJobSubmitResult> {
  const body: Record<string, string> = { employeeNo };
  if (idempotencyKey !== undefined && idempotencyKey !== '') body.idempotencyKey = idempotencyKey;
  const r = await ipdPost<unknown>('/person-sync/jobs', body);
  const row = (r ?? {}) as Record<string, unknown>;
  return { jobId: String(row.jobId ?? ''), status: String(row.status ?? '') };
}

/**
 * 单任务手动重试（超管+组长；仅 FAILED 可重试、超 maxAttempts 拒 → STATE_CONFLICT 抛错不吞）。
 * jobId 格式 sync-<uuid8>-<seq>，path 段 encodeURIComponent，禁任何数值化。
 * 对应 PersonSyncController#retry — POST /person-sync/jobs/{id}/retry
 */
export async function retrySyncJob(jobId: string): Promise<SyncJob> {
  const r = await ipdPost<unknown>(`/person-sync/jobs/${encodeURIComponent(jobId)}/retry`);
  return normalizeJob(r);
}

/**
 * 批量回补所有 PENDING/FAILED 未耗尽任务（仅 SUPER_ADMIN；组长调用 403/30001）。
 * 对应 PersonSyncController#retryAll — POST /person-sync/jobs/retry-all（无 body 无 query）
 */
export async function retryAllSyncJobs(): Promise<SyncBatchRetryResult> {
  const r = await ipdPost<unknown>('/person-sync/jobs/retry-all');
  const row = (r ?? {}) as Record<string, unknown>;
  return {
    failed: Number(row.failed ?? 0),
    retried: Number(row.retried ?? 0),
    skipped: Number(row.skipped ?? 0),
    succeeded: Number(row.succeeded ?? 0),
  };
}

/**
 * 列出所有同步任务（仅 SUPER_ADMIN，requireAdmin :82）。
 * 对应 PersonSyncController#listAll — GET /person-sync/jobs
 */
export async function listSyncJobs(): Promise<SyncJob[]> {
  const rows = await ipdGet<unknown[]>('/person-sync/jobs');
  return (rows ?? []).map(normalizeJob);
}

/**
 * 列出异常任务 FAILED only（仅 SUPER_ADMIN，requireAdmin :90）。
 * 对应 PersonSyncController#listAbnormal — GET /person-sync/jobs/abnormal
 */
export async function listAbnormalSyncJobs(): Promise<SyncJob[]> {
  const rows = await ipdGet<unknown[]>('/person-sync/jobs/abnormal');
  return (rows ?? []).map(normalizeJob);
}
