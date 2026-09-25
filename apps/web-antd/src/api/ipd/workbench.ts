/**
 * 工作台聚合 API（页03；后端 WorkbenchController /api/v1/workbench）。
 *
 * 后端真值（G-04 以代码为准，2026-09-06 交付）：
 * - GET /workbench/summary?projectId= 聚合：stats(pending/overdue/unread/completed)
 *   + tasks（stage_action 平铺，前端按项目分组）+ deletionPending + currentAdvance；
 * - 责任匹配：owner_role ∈ MARKET_PM/RD_PM 定向，BOTH/空值全员可见；
 * - 项目范围：SUPER_ADMIN=全部 ACTIVE 项目，其余=project_members 成员表；
 * - ID 为 Long 序列化字符串（与 project.ts 约定一致）。
 */
import { ipdGet } from './http';

export interface WorkbenchStats {
  pending: number;
  overdue: number;
  unread: number;
  completed: number;
  /**
   * 「我发起的」计数（P1-4）：当前人在 deletion_requests / coefficient_change_requests /
   * launch_date_change_requests 三表 create_by = 当前人的总数。
   * 旧后端（16039 未重启）无此键时为 undefined；前端以 undefined 兜底 0。
   * 计数一律 int 装箱：避免全局 Long→String 序列化把 Long 计数变字符串。
   */
  myInitiated?: number;
  /** 按类型计数（P1.4，设计 §5）：17 类 taskType key 预置 0；旧后端（16039 未重启）无此键，可选。 */
  pendingType?: Record<string, number>;
}

export interface WorkbenchTask {
  id: string;
  projectId: string;
  projectName: null | string;
  projectCode: null | string;
  actionCode: null | string;
  title: null | string;
  taskType: string;
  status: string;
  priority: 'high' | 'normal';
  ownerRole: null | string;
  /** 后端 Date 全局序列化为毫秒时间戳（number）；全局 NON_NULL 会剔除 null 值键，无期限卡实际是 undefined。 */
  dueDate?: null | number | string;
  isBlocking: null | string;
  deepLink: string;
}

export interface WorkbenchCurrentAdvance {
  projectId: string;
  projectCode: null | string;
  projectName: null | string;
  currentStage: null | string;
  actionId: null | string;
  actionName: null | string;
  actionStatus: null | string;
  deepLink: string;
}

export interface WorkbenchSummary {
  stats: WorkbenchStats;
  tasks: WorkbenchTask[];
  deletionPending: number;
  currentAdvance: null | WorkbenchCurrentAdvance;
}

/** 工作台总览（projectId 可选：顶栏项目切换后续传）。 */
export function fetchWorkbenchSummary(projectId?: string): Promise<WorkbenchSummary> {
  return ipdGet<WorkbenchSummary>(
    '/workbench/summary',
    projectId ? { projectId } : undefined,
  );
}

/**
 * 我发起 / 待我审批聚合任务卡（R27 P0-6；后端 MyInitiatedTask 投影，R215 A10 接线）。
 * 三张审批单据（deletion_requests / coefficient_change_requests / launch_date_change_requests）
 * + 阶段动作（stage_actions）的统一视图；personId 缺省 = 当前登录人（SEC-API-01 会话推导）。
 */
export interface MyInitiatedTaskView {
  id: string;
  /** 实测短形式：DELETION / COEFFICIENT / LAUNCH_DATE / STAGE_ACTION（后端常量名长形式但值为短，以响应为准） */
  taskType: string;
  sourceId: string;
  sourceTable: string;
  title: null | string;
  status: string;
  initiatorId: string;
  approverId: null | string;
  createdAt: number | string;
}

/** 我发起的（GET /workbench/my-initiated）。 */
export function fetchMyInitiated(personId?: string): Promise<MyInitiatedTaskView[]> {
  return ipdGet<MyInitiatedTaskView[]>(
    '/workbench/my-initiated',
    personId ? { personId } : undefined,
  );
}

/** 待我审批的（GET /workbench/my-pending-approvals；审批态单据聚合）。 */
export function fetchMyPendingApprovals(personId?: string): Promise<MyInitiatedTaskView[]> {
  return ipdGet<MyInitiatedTaskView[]>(
    '/workbench/my-pending-approvals',
    personId ? { personId } : undefined,
  );
}
