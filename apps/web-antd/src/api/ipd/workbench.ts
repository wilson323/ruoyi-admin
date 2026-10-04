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
   * 「我发起的」计数（P1-4）：当前人在 deletion_requests /
   * launch_date_change_requests 两表 create_by = 当前人的总数
   * （2026-10-03 拆除：系数变更为第三张表，后端 myInitiated() 已不再聚合）。
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
 * 后端只聚合两批审批单据（deletion_requests / launch_date_change_requests）。
 * 阶段动作（stage_actions）不在本视图：myInitiated() 无此生产者，前端 MY_INITIATED_SOURCE_TEXT
 * 里的同名标签位收不到值；阶段动作以「阶段签署」（taskType=stage_sign）出现在待办队列
 * （GET /workbench/tasks），由后端 StageSignAggregator 按责任角色投递。
 * personId 已随 SEC-API-01 收口移除：查询范围只取会话身份，客户端无法指定他人（后端也不受理该参数）。
 * 2026-10-03 拆除：coefficient_change_requests 已随后端 myInitiated() 下线，不再出现在本视图。
 */
export interface MyInitiatedTaskView {
  id: string;
  /** 实测短形式：DELETION / LAUNCH_DATE（后端常量名长形式但值为短，以响应为准）；阶段动作不经本视图 */
  taskType: string;
  sourceId: string;
  sourceTable: string;
  title: null | string;
  status: string;
  initiatorId: string;
  approverId: null | string;
  createdAt: number | string;
}

/** 我发起的（GET /workbench/my-initiated；范围只取会话身份，无客户端可传的 person 参数）。 */
export function fetchMyInitiated(): Promise<MyInitiatedTaskView[]> {
  return ipdGet<MyInitiatedTaskView[]>('/workbench/my-initiated');
}

/** 待我审批的（GET /workbench/my-pending-approvals；审批态单据聚合，范围同上）。 */
export function fetchMyPendingApprovals(): Promise<MyInitiatedTaskView[]> {
  return ipdGet<MyInitiatedTaskView[]>('/workbench/my-pending-approvals');
}

/* ---------- WB-17-1 S0：任务队列过滤视图（GET /workbench/tasks，2026-09-27 后端已交付） ---------- */

/** bucket 值域（后端 fail-closed：completed 仅有计数走 /summary、initiated 走 /my-initiated，均 400）。 */
export type WorkbenchTaskBucket = 'overdue' | 'pending';

/** GET /workbench/tasks 查询参数（全可选；后端 WorkbenchController#tasks @RequestParam）。 */
export interface WorkbenchTasksParams {
  /** 缺省 pending=全部在途卡；overdue=dueDate 早于当前（与 summary stats.overdue 同规则）。 */
  bucket?: WorkbenchTaskBucket;
  /** 1~200，缺省 50（后端 fail-closed 校验）。 */
  limit?: number;
  /** 可选：卡面 projectId 精确匹配。 */
  projectId?: string;
  /** 可选：17 类权威 taskType 之一（非法值后端 400），空=不过滤。 */
  type?: string;
}

/** GET /workbench/tasks 响应（后端 result Map 键集；total=截断前命中数，returned=本次返回数）。 */
export interface WorkbenchTasksView {
  bucket: string;
  limit: number;
  projectId: null | string;
  returned: number;
  /** 与 /summary tasks 同一聚合器卡面（WorkbenchTask），按 priority urgent>high>normal、dueDate 升序排序。 */
  tasks: WorkbenchTask[];
  total: number;
  type: null | string;
}

/**
 * 任务队列过滤视图（WB-17-1 S0；GET /api/v1/workbench/tasks?bucket=&type=&limit=&projectId=）。
 * 与 /summary 共用聚合器链（真数据源零 mock），在卡面上过滤；老 /summary 契约保留兼容。
 */
export function fetchWorkbenchTasks(params: WorkbenchTasksParams = {}): Promise<WorkbenchTasksView> {
  return ipdGet<WorkbenchTasksView>('/workbench/tasks', { ...params });
}
