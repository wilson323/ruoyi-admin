/**
 * 阶段动作实例接口（页12/13 深管/轻管动作详情，看板卡 P0-10.12/13；后端 P1-4.3 已交付）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/StageActionController.java
 *
 * 关键约束（按 G-04 以代码为准）：
 * - 状态流转唯一入口 POST /{id}/transit；不接受 PATCH status 字段。
 * - NA 必须传 reason；幂等：同 target 返回当前态且不写审计。
 * - 乐观锁：并发同 id 重复 /transit 由 MP 仅 1 成功（OptimisticLockerInnerInterceptor）。
 *   冲突由后端抛 50002 STATE_CONFLICT，前端显示「状态已变更，请刷新后重试」。
 * - 轻管录入（actualDoneAt/FAR/FRR/certNo/certPassedAt/algoType）走 /{id}/fields，不改 status；
 *   完成路径：先 fields 写日期，再 /transit?target=DONE。
 * - 深管交付物：POST /{id}/deliverables?fileName=&ossId=（ossId 由前端先调若依 core/upload.ts uploadApi 上传 OSS 拿到再透传）。
 * - 阶段动作实例无 GET /{id} 单查端点，需 GET /?projectId= 全量后客户端筛 id。
 * - D11 FAR+FRR ≤ 1.000000（系统参数可配）；后端 40001 触发。
 * - V02 certNo 格式正则 ^[A-Za-z0-9\-/]+$；后端 10001 触发。
 * - P10/V02 阻断性动作：/transit?target=DONE 前 /fields 必须含 certNo+certPassedAt；不通过则 40001。
 */
import { ipdGet, ipdPost } from './http';

/** 管理类型 BR-IPD-03/04；stageActionService.transit 按 depth 分支校验。 */
export type StageActionDepth = 'DEEP' | 'LIGHT' | string;
/** 动作状态机（深管 5 态；轻管无 DELAYED）。 */
export type StageActionStatus = 'DELAYED' | 'DONE' | 'IN_PROGRESS' | 'NA' | 'NOT_STARTED' | string;
/** 算法分类（FINGERPRINT|FACE|PALM|VEIN|MULTI；轻管录入 alg o_type）。 */
export type AlgoType = 'FACE' | 'FINGERPRINT' | 'MULTI' | 'PALM' | 'VEIN' | string;

export interface StageAction {
  actionCode: null | string;
  actionName: null | string;
  actualDoneAt?: null | number | string;
  algoType?: null | string;
  certNo?: null | string;
  certPassedAt?: null | number | string;
  createBy?: null | string;
  createTime?: null | string;
  depth: StageActionDepth;
  dueDate?: null | number | string;
  farValue?: null | number | string;
  frrValue?: null | number | string;
  historyMark?: null | string;
  id: string;
  isBioFeature?: null | string;
  isBlocking?: null | string;
  ownerRole?: null | string;
  projectId: string;
  remark?: null | string;
  sopId?: null | string | number;
  stageId?: null | string | number;
  status: StageActionStatus;
  version?: number;
}

export interface StageActionFieldsBody {
  actualDoneAt?: null | number | string;
  algoType?: null | string;
  certNo?: null | string;
  certPassedAt?: null | number | string;
  farValue?: null | number | string;
  frrValue?: null | number | string;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function asOptionalString(value: unknown): null | string {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function asOptionalNumber(value: unknown): null | number {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeAction(raw: unknown): StageAction {
  const row = toRecord(raw);
  return {
    id: asString(row.id),
    projectId: asString(row.projectId),
    stageId: row.stageId === undefined || row.stageId === null ? null
      : (typeof row.stageId === 'number' ? row.stageId : String(row.stageId)),
    actionCode: typeof row.actionCode === 'string' ? row.actionCode : null,
    actionName: typeof row.actionName === 'string' ? row.actionName : null,
    ownerRole: typeof row.ownerRole === 'string' ? row.ownerRole : null,
    depth: typeof row.depth === 'string' ? row.depth : '',
    status: typeof row.status === 'string' ? row.status : '',
    historyMark: typeof row.historyMark === 'string' ? row.historyMark : null,
    isBlocking: typeof row.isBlocking === 'string' ? row.isBlocking : null,
    actualDoneAt: typeof row.actualDoneAt === 'number'
      ? row.actualDoneAt
      : (asOptionalString(row.actualDoneAt) ?? null),
    farValue: asOptionalNumber(row.farValue),
    frrValue: asOptionalNumber(row.frrValue),
    certNo: typeof row.certNo === 'string' ? row.certNo : null,
    certPassedAt: typeof row.certPassedAt === 'number'
      ? row.certPassedAt
      : (asOptionalString(row.certPassedAt) ?? null),
    algoType: typeof row.algoType === 'string' ? row.algoType : null,
    isBioFeature: typeof row.isBioFeature === 'string' ? row.isBioFeature : null,
    dueDate: typeof row.dueDate === 'number'
      ? row.dueDate
      : (asOptionalString(row.dueDate) ?? null),
    sopId: row.sopId === undefined || row.sopId === null ? null
      : (typeof row.sopId === 'number' ? row.sopId : String(row.sopId)),
    remark: typeof row.remark === 'string' ? row.remark : null,
    version: typeof row.version === 'number' ? row.version : undefined,
    createBy: asOptionalString(row.createBy),
    createTime: asOptionalString(row.createTime),
  };
}

function normalizeActionList(data: unknown): StageAction[] {
  if (!Array.isArray(data)) return [];
  return data.map(normalizeAction);
}

function toIso(value: null | number | string | undefined): null | string {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function fieldsToBody(body: StageActionFieldsBody): Record<string, unknown> {
  return {
    actualDoneAt: toIso(body.actualDoneAt),
    farValue: body.farValue === null || body.farValue === undefined ? null : String(body.farValue),
    frrValue: body.frrValue === null || body.frrValue === undefined ? null : String(body.frrValue),
    certNo: body.certNo ?? null,
    certPassedAt: toIso(body.certPassedAt),
    algoType: body.algoType ?? null,
  };
}

/** 阶段动作列表（GET /api/v1/stage-actions?projectId=）。后端无单查端点，按 id 客户端筛。 */
export function listStageActions(projectId: string): Promise<StageAction[]> {
  return ipdGet<unknown>('/stage-actions', { projectId }).then(normalizeActionList);
}

/**
 * 状态流转（POST /api/v1/stage-actions/{id}/transit?target=&reason=）。
 * NA 必须传 reason；幂等；并发由乐观锁拦截，50002。
 */
export function transitStageAction(id: string, target: StageActionStatus, reason?: string): Promise<StageAction> {
  const params = new URLSearchParams();
  params.set('target', target);
  if (reason) params.set('reason', reason);
  return ipdPost<unknown>(`/stage-actions/${id}/transit?${params.toString()}`).then(normalizeAction);
}

/**
 * 轻管录入（POST /api/v1/stage-actions/{id}/fields）。
 * 严禁携带 status——状态只能走 /transit；前端 fields 调用前必清空 status。
 */
export function recordStageActionFields(id: string, body: StageActionFieldsBody): Promise<StageAction> {
  return ipdPost<unknown>(`/stage-actions/${id}/fields`, fieldsToBody(body)).then(normalizeAction);
}

/**
 * 深管交付物登记（POST /api/v1/stage-actions/{id}/deliverables?fileName=&ossId=）。
 * 已知（[CONSISTENCY-13] 2026-09-06 选 A 落地）：
 * - 前端先调若依 /resource/oss/upload（core/upload.ts uploadApi）拿 ossId (string 透传，后端 Long 接)；
 * - 后端 StageActionService.addDeliverable(actionId, fileName, ossId, operator) 已就位；
 * - ossId 类型契约：后端 Long；前端以 string 拼 query（URLSearchParams 接受 string），
 *   Spring 反序列化时自动 toString→Long；测试中已用 string '9001' 验证契约。
 */
export function addStageActionDeliverable(id: string, fileName: string, ossId: string): Promise<unknown> {
  const params = new URLSearchParams();
  params.set('fileName', fileName);
  params.set('ossId', ossId);
  return ipdPost<unknown>(`/stage-actions/${id}/deliverables?${params.toString()}`);
}