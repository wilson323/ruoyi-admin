/**
 * IPD 业务状态机集中定义（前端单一权威源）。
 *
 * <p>覆盖 6 个核心状态机，与后端枚举字面值一一对应：
 * <ul>
 *   <li>PROJECT_STATUS — 项目 5 态 DRAFT/TEAMING/ACTIVE/SUSPENDED/ARCHIVED</li>
 *   <li>DEMAND_STATUS — 需求 8 态 SUBMITTED/ACCEPTED/EVALUATING/SCHEDULED/PROCESSING/IN_DEV/CLOSED/ARCHIVED</li>
 *   <li>BONUS_STATUS — 奖金池 3 态 DRAFT/CONFIRMED/DISTRIBUTED</li>
 *   <li>DELETION_STATUS — 删除申请 6 态 PENDING/WITHDRAWN/LEADER_APPROVED/REJECTED/PURGED/ARCHIVED</li>
 *   <li>GATE_STATUS — Gate 评审 4 态 PENDING/IN_PROGRESS/PASSED/FAILED</li>
 *   <li>CHANGE_STATUS — 需求变更 4 态 DRAFT/PENDING_SIGN/APPROVED/REJECTED</li>
 * </ul>
 *
 * <p>使用方式：
 * <pre>
 * import { PROJECT_STATUS_MACHINE, isProjectStatus, nextProjectStatuses } from '../_shared/ipd-state-machines';
 * if (isProjectStatus('DRAFT')) { ... }
 * const next = nextProjectStatuses('DRAFT'); // ['TEAMING']
 * </pre>
 */

export type ProjectStatus = 'DRAFT' | 'TEAMING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type DemandStatus =
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'EVALUATING'
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'IN_DEV'
  | 'CLOSED'
  | 'ARCHIVED';
export type BonusStatus = 'DRAFT' | 'CONFIRMED' | 'DISTRIBUTED';
export type DeletionStatus =
  | 'PENDING'
  | 'WITHDRAWN'
  | 'LEADER_APPROVED'
  | 'REJECTED'
  | 'PURGED'
  | 'ARCHIVED';
export type GateStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
export type ChangeStatus = 'DRAFT' | 'PENDING_SIGN' | 'APPROVED' | 'REJECTED';
export type BidStatus = 'OPEN' | 'SELECTED' | 'EXPIRED' | 'CLOSED';
export type BidMode = 'PUBLIC' | 'ONE_TO_ONE';
export type BidResponseStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';
export type ActionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'DELAYED' | 'NA';

export interface StateNode<S extends string> {
  code: S;
  label: string;
  tone: string;
}

export interface StateMachine<S extends string> {
  name: string;
  states: readonly StateNode<S>[];
  /** 合法迁移图：code → 可达 code 列表。 */
  transitions: Readonly<Record<S, readonly S[]>>;
}

function buildMachine<S extends string>(
  name: string,
  states: readonly StateNode<S>[],
  transitions: Record<S, S[]>,
): StateMachine<S> {
  return { name, states, transitions };
}

// ============ 项目状态机（5 态）============
const PROJECT_STATES: readonly StateNode<ProjectStatus>[] = [
  { code: 'DRAFT', label: '草稿', tone: 'default' },
  { code: 'TEAMING', label: '组队中', tone: 'warning' },
  { code: 'ACTIVE', label: '进行中', tone: 'processing' },
  { code: 'SUSPENDED', label: '已暂停', tone: 'warning' },
  { code: 'ARCHIVED', label: '已归档', tone: 'default' },
];
export const PROJECT_STATUS_MACHINE: StateMachine<ProjectStatus> = buildMachine(
  'PROJECT_STATUS',
  PROJECT_STATES,
  {
    DRAFT: ['TEAMING'],
    TEAMING: ['ACTIVE', 'SUSPENDED'],
    ACTIVE: ['SUSPENDED', 'ARCHIVED'],
    SUSPENDED: ['ACTIVE', 'ARCHIVED'],
    ARCHIVED: [],
  },
);

// ============ 需求状态机（8 态）============
const DEMAND_STATES: readonly StateNode<DemandStatus>[] = [
  { code: 'SUBMITTED', label: '新提交', tone: 'default' },
  { code: 'ACCEPTED', label: '已受理', tone: 'processing' },
  { code: 'EVALUATING', label: '分析中', tone: 'warning' },
  { code: 'SCHEDULED', label: '已规划', tone: 'cyan' },
  { code: 'PROCESSING', label: '处理中', tone: 'processing' },
  { code: 'IN_DEV', label: '开发中', tone: 'processing' },
  { code: 'CLOSED', label: '已关闭', tone: 'default' },
  { code: 'ARCHIVED', label: '已归档', tone: 'default' },
];
export const DEMAND_STATUS_MACHINE: StateMachine<DemandStatus> = buildMachine(
  'DEMAND_STATUS',
  DEMAND_STATES,
  {
    SUBMITTED: ['ACCEPTED'],
    ACCEPTED: ['EVALUATING'],
    EVALUATING: ['SCHEDULED'],
    SCHEDULED: ['PROCESSING', 'IN_DEV'],
    PROCESSING: ['CLOSED'],
    IN_DEV: ['CLOSED'],
    CLOSED: ['ARCHIVED'],
    ARCHIVED: [],
  },
);

// ============ 奖金池状态机（3 态）============
const BONUS_STATES: readonly StateNode<BonusStatus>[] = [
  { code: 'DRAFT', label: '草稿', tone: 'default' },
  { code: 'CONFIRMED', label: '已确认', tone: 'processing' },
  { code: 'DISTRIBUTED', label: '已分配', tone: 'success' },
];
export const BONUS_STATUS_MACHINE: StateMachine<BonusStatus> = buildMachine(
  'BONUS_STATUS',
  BONUS_STATES,
  { DRAFT: ['CONFIRMED'], CONFIRMED: ['DISTRIBUTED'], DISTRIBUTED: [] },
);

// ============ 删除申请状态机（6 态）============
const DELETION_STATES: readonly StateNode<DeletionStatus>[] = [
  { code: 'PENDING', label: '待审核', tone: 'warning' },
  { code: 'WITHDRAWN', label: '已撤回', tone: 'default' },
  { code: 'LEADER_APPROVED', label: '组长已审', tone: 'processing' },
  { code: 'REJECTED', label: '已驳回', tone: 'error' },
  { code: 'PURGED', label: '已清除', tone: 'default' },
  { code: 'ARCHIVED', label: '已归档', tone: 'default' },
];
export const DELETION_STATUS_MACHINE: StateMachine<DeletionStatus> = buildMachine(
  'DELETION_STATUS',
  DELETION_STATES,
  {
    PENDING: ['WITHDRAWN', 'LEADER_APPROVED', 'REJECTED'],
    WITHDRAWN: [],
    LEADER_APPROVED: ['PURGED', 'REJECTED'],
    REJECTED: [],
    PURGED: ['ARCHIVED'],
    ARCHIVED: [],
  },
);

// ============ Gate 评审状态机（4 态）============
const GATE_STATES: readonly StateNode<GateStatus>[] = [
  { code: 'PENDING', label: '待发起', tone: 'default' },
  { code: 'IN_PROGRESS', label: '评审中', tone: 'warning' },
  { code: 'PASSED', label: '已通过', tone: 'success' },
  { code: 'FAILED', label: '已否决', tone: 'error' },
];
export const GATE_STATUS_MACHINE: StateMachine<GateStatus> = buildMachine(
  'GATE_STATUS',
  GATE_STATES,
  {
    PENDING: ['IN_PROGRESS'],
    IN_PROGRESS: ['PASSED', 'FAILED'],
    PASSED: [],
    FAILED: ['IN_PROGRESS'],
  },
);

// ============ 需求变更状态机（4 态）============
const CHANGE_STATES: readonly StateNode<ChangeStatus>[] = [
  { code: 'DRAFT', label: '草稿', tone: 'default' },
  { code: 'PENDING_SIGN', label: '待双签', tone: 'warning' },
  { code: 'APPROVED', label: '已批准', tone: 'success' },
  { code: 'REJECTED', label: '已驳回', tone: 'error' },
];
export const CHANGE_STATUS_MACHINE: StateMachine<ChangeStatus> = buildMachine(
  'CHANGE_STATUS',
  CHANGE_STATES,
  {
    DRAFT: ['PENDING_SIGN'],
    PENDING_SIGN: ['APPROVED', 'REJECTED'],
    APPROVED: [],
    REJECTED: [],
  },
);

// ============ 招标单状态机（4 态）============
const BID_STATES: readonly StateNode<BidStatus>[] = [
  { code: 'OPEN', label: '招标中', tone: 'processing' },
  { code: 'SELECTED', label: '已遴选', tone: 'success' },
  { code: 'EXPIRED', label: '已过期', tone: 'warning' },
  { code: 'CLOSED', label: '已关闭', tone: 'default' },
];
export const BID_STATUS_MACHINE: StateMachine<BidStatus> = buildMachine(
  'BID_STATUS',
  BID_STATES,
  {
    OPEN: ['SELECTED', 'EXPIRED', 'CLOSED'],
    SELECTED: ['CLOSED'],
    EXPIRED: [],
    CLOSED: [],
  },
);

// ============ 应标状态机（4 态）============
const BID_RESPONSE_STATES: readonly StateNode<BidResponseStatus>[] = [
  { code: 'PENDING', label: '已应标（待遴选）', tone: 'processing' },
  { code: 'ACCEPTED', label: '已中标', tone: 'success' },
  { code: 'REJECTED', label: '已落选', tone: 'default' },
  { code: 'WITHDRAWN', label: '已撤回', tone: 'default' },
];
export const BID_RESPONSE_STATUS_MACHINE: StateMachine<BidResponseStatus> = buildMachine(
  'BID_RESPONSE_STATUS',
  BID_RESPONSE_STATES,
  {
    PENDING: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    ACCEPTED: [],
    REJECTED: [],
    WITHDRAWN: [],
  },
);

// ============ 阶段动作状态机（5 态）============
const ACTION_STATES: readonly StateNode<ActionStatus>[] = [
  { code: 'NOT_STARTED', label: '未开始', tone: 'default' },
  { code: 'IN_PROGRESS', label: '进行中', tone: 'processing' },
  { code: 'DONE', label: '已完成', tone: 'success' },
  { code: 'DELAYED', label: '已逾期', tone: 'warning' },
  { code: 'NA', label: '不适用', tone: 'default' },
];
export const ACTION_STATUS_MACHINE: StateMachine<ActionStatus> = buildMachine(
  'ACTION_STATUS',
  ACTION_STATES,
  {
    NOT_STARTED: ['IN_PROGRESS'],
    IN_PROGRESS: ['DONE', 'DELAYED'],
    DONE: [],
    DELAYED: ['IN_PROGRESS', 'DONE'],
    NA: [],
  },
);

// ============ 通用工具函数 ============

/** 查表：状态码 → 节点。 */
function findNode<S extends string>(
  machine: StateMachine<S>,
  code: string,
): StateNode<S> | undefined {
  return machine.states.find((node) => node.code === code);
}

/** 校验给定码是否属于状态机合法值。 */
export function isState<S extends string>(
  machine: StateMachine<S>,
  code: string,
): code is S {
  return Boolean(findNode(machine, code));
}

/** 状态码 → 中文标签；未知值返回 fallback（默认「待补充」）。 */
export function stateLabel<S extends string>(
  machine: StateMachine<S>,
  code: null | string | undefined,
  fallback = '待补充',
): string {
  if (!code) return fallback;
  return findNode(machine, code)?.label ?? fallback;
}

/** 状态码 → UI tone（用于 Tag/Alert 颜色）。 */
export function stateTone<S extends string>(
  machine: StateMachine<S>,
  code: null | string | undefined,
  fallback = 'default',
): string {
  if (!code) return fallback;
  return findNode(machine, code)?.tone ?? fallback;
}

/** 状态码 → 下一可达态列表。终态返回空数组。 */
export function nextStates<S extends string>(
  machine: StateMachine<S>,
  code: null | S | string,
): readonly S[] {
  if (!code) return [];
  return machine.transitions[code as S] ?? [];
}
