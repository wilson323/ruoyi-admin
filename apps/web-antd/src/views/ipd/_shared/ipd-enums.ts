/**
 * IPD 通用展示枚举（前端统一字典）。
 *
 * <p>覆盖：
 * <ul>
 *   <li>ROLE_TEXT — 内部 5 角色中文名</li>
 *   <li>STAGE_TONE — 六阶段 UI 配色</li>
 *   <li>STATUS_TONE — 通用 status 配色</li>
 *   <li>STATE_TONE — 业务状态机节点 tone（来自 ipd-state-machines）</li>
 *   <li>PRIORITY_TEXT — 优先级 3 档</li>
 *   <li>SEVERITY_TEXT — 严重度 3 档</li>
 * </ul>
 *
 * <p>前端 UI 文案与色彩统一源，组件禁止自行硬编码中文/颜色。
 * 后端枚举值若调整，先改 ipd-state-machines / 本文件，再 grep 替换组件。
 */

import {
  ACTION_STATUS_MACHINE,
  BID_RESPONSE_STATUS_MACHINE,
  BID_STATUS_MACHINE,
  CHANGE_STATUS_MACHINE,
  DELETION_STATUS_MACHINE,
  DEMAND_STATUS_MACHINE,
  GATE_STATUS_MACHINE,
  PROJECT_STATUS_MACHINE,
  stateLabel,
  stateTone,
} from './ipd-state-machines';

/** 内部 5 角色中文名（含 MARKET_PM/RD_PM/GROUP_LEADER/SUPER_ADMIN/INTERNAL）。 */
export const ROLE_TEXT: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  INTERNAL: '内部成员',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

/** 角色中文名（未知值返回 '未知角色'）。 */
export function roleText(role: null | string | undefined, fallback = '未知角色'): string {
  if (!role) return fallback;
  return ROLE_TEXT[role] ?? fallback;
}

/**
 * 权限码中文名（R215 UX 汉化：角色权限配置页等面向管理员的界面禁止裸露 ipd:* 代码）。
 *
 * <p>与后端 org.ruoyi.ipd.security.IpdPermissionCode 常量值对齐；仅展示用途，不参与鉴权。
 * 新增码未收录时 {@link permissionText} 回显原码（不显示'未知'，避免误导）。
 */
export const IPD_PERMISSION_TEXT: Record<string, string> = {
  // 项目
  'ipd:project:list': '查看项目列表',
  'ipd:project:query': '查询项目',
  'ipd:project:add': '新建项目',
  'ipd:project:edit': '修改项目状态',
  // 产品
  'ipd:product:list': '查看产品列表',
  'ipd:product:query': '查询产品',
  'ipd:product:add': '新建产品',
  'ipd:product:edit': '产品绑定项目',
  // 阶段动作
  'ipd:stage-action:list': '查看阶段动作',
  'ipd:stage-action:edit': '执行阶段动作',
  'ipd:stage-action:add': '登记阶段交付物',
  // 国别认证模板
  'ipd:cert-template:list': '查看认证模板',
  'ipd:cert-template:add': '新增认证模板',
  'ipd:cert-template:remove': '删除认证模板',
  // Gate 评审要素
  'ipd:gate-element:list': '查看评审要素',
  'ipd:gate-element:add': '新增评审要素',
  'ipd:gate-element:edit': '修改评审要素',
  'ipd:gate-element:remove': '停用评审要素',
  'ipd:gate-element:publish': '发布评审要素',
  'ipd:gate-element:archive': '归档评审要素',
  'ipd:gate-element:copy': '复制评审要素',
  'ipd:gate-element:revert': '回溯评审要素版本',
  'ipd:gate-element:restore': '恢复归档评审要素',
  // 删除申请
  'ipd:deletion-request:submit': '提交删除申请',
  'ipd:deletion-request:leader': '删除申请组长初审',
  'ipd:deletion-request:admin': '删除申请超管终审',
  'ipd:deletion-request:archive': '归档删除申请',
  'ipd:deletion-request:purge': '彻底清除删除申请',
  'ipd:deletion-request:withdraw': '撤回删除申请',
  // Gate 评审
  'ipd:gate-review:list': '查看 Gate 评审',
  'ipd:gate-review:add': '发起 Gate 评审',
  'ipd:gate-review:edit': '审批 Gate 评审',
  // 考核系数两码已随「业绩窗口（含系数变更）」退役摘除（2026-10-03）
  // 站内通知
  'ipd:notification:read': '查看站内通知',
  'ipd:notification:dispatch': '手动派发通知',
  // AI 文档助手
  'ipd:ai-document:list': '查看 AI 文档',
  'ipd:ai-document:add': '登记 AI 文档',
  'ipd:ai-document:edit': '修订 AI 文档',
  'ipd:ai-document:review': '审核 AI 文档',
  // AI 模型配置
  'ipd:ai-model:list': '查看 AI 模型配置',
  'ipd:ai-model:edit': '修改 AI 模型配置',
  'ipd:ai-copilot:chat': '使用 AI 副驾问答',
  // SOP 模板
  'ipd:sop-template:list': '查看 SOP 模板',
  'ipd:sop-template:edit': '编辑 SOP 模板',
  // KPI 考核
  'ipd:kpi:query': '查询 KPI 考核',
  'ipd:kpi-shared:confirm': '共担 KPI 确认签署',
  'ipd:kpi-shared:collect': '共担 KPI 归集',
  'ipd:kpi:raw:create': 'KPI 原始数据录入',
  'ipd:kpi:raw:query': 'KPI 原始数据查询',
  'ipd:kpi:config': '功能指标量表录入',
  'ipd:kpi:config:query': '功能指标量表查询',
  // 奖金池权限码 —— 2026-10-03 随奖金池功能整体移除
  // 上市后复盘
  'ipd:post-launch-review:create': '创建上市后复盘',
  'ipd:post-launch-review:complete': '完成上市后复盘',
  'ipd:post-launch-review:query': '查看上市后复盘',
  // 贡献度评定
  'ipd:contribution:query': '查看贡献度评定',
  'ipd:contribution:save': '保存贡献度评定',
  'ipd:contribution:confirm': '确认贡献度评定',
  // 负反馈
  'ipd:negative-feedback:query': '查看负反馈',
  'ipd:negative-feedback:create': '录入负反馈',
  'ipd:negative-feedback:decide': '认定/解除负反馈',
  // 切换验收
  'ipd:switching-acceptance:query': '查看切换验收',
  'ipd:switching-acceptance:admin': '切换验收管理（历史别名）',
  'ipd:switching-acceptance:lock': '锁定切换验收月结',
  'ipd:switching-acceptance:unlock': '解锁切换验收月结',
  // 审计日志
  'ipd:audit-log:list': '查看审计日志',
  'ipd:audit-log:verify': '校验审计日志',
  'ipd:audit-log:export': '导出审计日志',
  // 合规
  'ipd:compliance:read': '查看合规数据',
  'ipd:compliance:write': '修改合规数据',
  // 系统参数
  'ipd:system-config:list': '查看系统参数',
  'ipd:system-config:read': '读取系统参数',
  'ipd:system-config:update': '修改系统参数',
  // 招标
  'ipd:bid-invitation:create': '创建招标单',
  'ipd:bid-invitation:admin-assign': '指派招标超管',
  // 项目移交
  'ipd:handover:cancel': '撤销项目移交',
  // 90 日回款预警
  'ipd:recovery:check-90d': '触发回款预警扫描',
  'ipd:recovery:warnings:query': '查看回款预警',
  // 需求变更单
  'ipd:requirement-change:submit': '提交需求变更单',
  'ipd:requirement-change:sign': '签收需求变更单',
  // 落地场景
  'ipd:scenario:landed:create': '登记落地场景',
  'ipd:scenario:landed:query': '查看落地场景',
  // 业务参数
  'ipd:business-config:read': '查看业务参数',
  'ipd:business-config:write': '修改业务参数',
  // 数据治理
  'ipd:permanent-delete:execute': '永久清除数据',
  // P0 升级链
  'ipd:p0-escalation:read': '查看 P0 升级链',
  // 角色权限配置（元权限，固定仅超管）
  'ipd:role-permission:query': '查看角色权限配置',
  'ipd:role-permission:edit': '修改角色权限配置',
};

/** 权限码中文名（未收录的码回显原码；空值返回 fallback 或空串）。 */
export function permissionText(code: null | string | undefined, fallback?: string): string {
  if (!code) return fallback ?? '';
  return IPD_PERMISSION_TEXT[code] ?? fallback ?? code;
}

/** 六阶段 UI 配色。 */
export const STAGE_TONE: Record<string, string> = {
  CONCEPT: 'default',
  DEV: 'processing',
  LAUNCH: 'success',
  LIFECYCLE: 'default',
  PLAN: 'warning',
  VALID: 'warning',
};

/** 通用 status 配色（兜底）。 */
export const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'processing',
  APPROVED: 'success',
  ARCHIVED: 'default',
  CANCELLED: 'default',
  CLOSED: 'default',
  CONFIRMED: 'processing',
  DISABLED: 'default',
  DISTRIBUTED: 'success',
  DRAFT: 'default',
  EXPIRED: 'warning',
  FAILED: 'error',
  IN_PROGRESS: 'warning',
  PENDING: 'warning',
  REJECTED: 'error',
  SELECTED: 'success',
  SUSPENDED: 'warning',
};

/** 优先级 3 档文案。 */
export const PRIORITY_TEXT: Record<string, string> = {
  HIGH: '高',
  LOW: '低',
  NORMAL: '中',
};

export const PRIORITY_TONE: Record<string, string> = {
  HIGH: 'error',
  LOW: 'default',
  NORMAL: 'processing',
};

export function priorityText(priority: null | string | undefined, fallback = '待补充'): string {
  if (!priority) return fallback;
  return PRIORITY_TEXT[priority] ?? fallback;
}

export function priorityTone(priority: null | string | undefined, fallback = 'default'): string {
  if (!priority) return fallback;
  return PRIORITY_TONE[priority] ?? fallback;
}

/** 严重度 3 档文案（负反馈执行使用）。 */
export const SEVERITY_TEXT: Record<string, string> = {
  CRITICAL: '严重',
  MAJOR: '主要',
  MINOR: '轻微',
};

export const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'red',
  MAJOR: 'orange',
  MINOR: 'gold',
};

export function severityText(severity: null | string | undefined, fallback = '待补充'): string {
  if (!severity) return fallback;
  return SEVERITY_TEXT[severity] ?? fallback;
}

export function severityTone(severity: null | string | undefined, fallback = 'default'): string {
  if (!severity) return fallback;
  return SEVERITY_TONE[severity] ?? fallback;
}

// ============ 业务状态机导出（统一查表） ============
/** 项目状态中文：stateLabel(PROJECT_STATUS_MACHINE, code)。 */
export const projectStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(PROJECT_STATUS_MACHINE, code, fallback);

export const projectStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(PROJECT_STATUS_MACHINE, code, fallback);

/** 需求状态中文。 */
export const demandStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(DEMAND_STATUS_MACHINE, code, fallback);

export const demandStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(DEMAND_STATUS_MACHINE, code, fallback);

/** 删除申请状态中文。 */
export const deletionStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(DELETION_STATUS_MACHINE, code, fallback);

export const deletionStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(DELETION_STATUS_MACHINE, code, fallback);

/** Gate 评审状态中文。 */
export const gateStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(GATE_STATUS_MACHINE, code, fallback);

export const gateStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(GATE_STATUS_MACHINE, code, fallback);

/** 需求变更状态中文。 */
export const changeStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(CHANGE_STATUS_MACHINE, code, fallback);

export const changeStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(CHANGE_STATUS_MACHINE, code, fallback);

/** 阶段动作状态中文（由 ACTION_STATUS_MACHINE 派生）。 */
export const actionStatusLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(ACTION_STATUS_MACHINE, code, fallback);

export const actionStatusTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(ACTION_STATUS_MACHINE, code, fallback);

/** 招标单状态中文（由 BID_STATUS_MACHINE 派生）。 */
export const bidStatusLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(BID_STATUS_MACHINE, code, fallback);

export const bidStatusTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(BID_STATUS_MACHINE, code, fallback);

/** 应标状态中文（由 BID_RESPONSE_STATUS_MACHINE 派生）。 */
export const bidResponseStatusLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(BID_RESPONSE_STATUS_MACHINE, code, fallback);

export const bidResponseStatusTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(BID_RESPONSE_STATUS_MACHINE, code, fallback);

/** 项目角色中文（仅 GROUP_LEADER/MARKET_PM/RD_PM/SUPER_ADMIN；INTERNAL 不属于项目级角色显示）。 */
export const PERSON_TYPE_TEXT_FROM_ROLE: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

export function personTypeText(type: null | string | undefined, fallback = '待补充'): string {
  if (!type) return fallback;
  return PERSON_TYPE_TEXT_FROM_ROLE[type] ?? fallback;
}

// ============ 显示映射表（非状态机；仅 label/tone 查表）============
/** 招标单状态中文（由 BID_STATUS_MACHINE 派生）。 */
export const BID_STATUS_TEXT: Record<string, string> = Object.fromEntries(
  BID_STATUS_MACHINE.states.map((s) => [s.code, s.label]),
);
export const BID_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  BID_STATUS_MACHINE.states.map((s) => [s.code, s.tone]),
);

/** 招标方式中文（静态映射；非状态机）。 */
export const BID_MODE_TEXT: Record<string, string> = {
  ONE_TO_ONE: '定向邀请',
  PUBLIC: '公开征集',
};

/** 应标状态中文（由 BID_RESPONSE_STATUS_MACHINE 派生）。 */
export const BID_RESPONSE_STATUS_TEXT: Record<string, string> = Object.fromEntries(
  BID_RESPONSE_STATUS_MACHINE.states.map((s) => [s.code, s.label]),
);
export const BID_RESPONSE_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  BID_RESPONSE_STATUS_MACHINE.states.map((s) => [s.code, s.tone]),
);

/** 阶段动作状态中文（由 ACTION_STATUS_MACHINE 派生）。 */
export const ACTION_STATUS_TEXT: Record<string, string> = Object.fromEntries(
  ACTION_STATUS_MACHINE.states.map((s) => [s.code, s.label]),
);
export const ACTION_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  ACTION_STATUS_MACHINE.states.map((s) => [s.code, s.tone]),
);

/** 六阶段 UI 配色（含 label；CONCEPT→PLAN→DEV→VALID→LAUNCH→LIFECYCLE）。 */
export const STAGE_TEXT: Record<string, string> = {
  CONCEPT: '概念阶段',
  DEV: '开发阶段',
  LAUNCH: '发布阶段',
  LIFECYCLE: '生命周期',
  PLAN: '计划阶段',
  VALID: '验证阶段',
};

/** 立项级别 S/A/B（前端仅展示文本，coefficient 由后端 ProjectLevelCoefficient 决定）。 */
export const LEVEL_TEXT: Record<string, string> = {
  A: 'A 级（标准）',
  B: 'B 级（差异化下调）',
  S: 'S 级（战略）',
};

/** 模板类型 HARDWARE/SOFTWARE/SOLUTION（BR-PROD-02 三模板分支）。 */
export const TEMPLATE_TEXT: Record<string, string> = {
  HARDWARE: '硬件',
  SOFTWARE: '软件',
  SOLUTION: '解决方案',
};

/** 项目来源 NEW/LEGACY（存量导入）。 */
export const SOURCE_TEXT: Record<string, string> = {
  LEGACY: '存量导入',
  NEW: '新建',
};

/** 补齐状态（存量项目 IN_PROGRESS/COMPLETE）。 */
export const CATCHUP_TEXT: Record<string, string> = {
  COMPLETE: '已补齐',
  IN_PROGRESS: '补齐中',
};

/** 动作深度 DEEP/LIGHT（公共规范第六节 + BR-IPD-03/04）。 */
export const DEPTH_TEXT: Record<string, string> = {
  DEEP: '深管动作',
  LIGHT: '轻管动作',
};
export const DEPTH_COLOR: Record<string, string> = {
  DEEP: 'processing',
  LIGHT: 'default',
};

/** 算法分类 FINGERPRINT/FACE/PALM/VEIN/MULTI。 */
export const ALGO_TEXT: Record<string, string> = {
  FACE: '人脸',
  FINGERPRINT: '指纹',
  MULTI: '多模态',
  PALM: '掌纹',
  VEIN: '指静脉',
};

/** 产品 workspace 状态 → 原型 lifecycle 展示词（后端无 lifecycle_status，按 listing status 映射）。 */
export const PRODUCT_STATUS_TEXT: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  IN_RD: '研发中',
  ON_SALE: '在售',
};

/** 工作台任务状态中文（后端各聚合器 status 值域全集）。 */
export const WORKBENCH_TASK_STATUS_TEXT: Record<string, string> = {
  ADMIN_REVIEW: '待终审',
  CONFIRMED: '已确认',
  DRAFT: '待确认',
  DELAYED: '已延期',
  IN_PROGRESS: '进行中',
  LEADER_REVIEW: '待初审',
  NOT_STARTED: '未开始',
  PENDING: '待处理',
  SUBMITTED: '待评定',
};

/** 工作台任务类型中文（16 类 taskType，按 spec batch-01 页03:165；
 * bonus_lock「奖金锁定」已于 2026-10-03 随「奖金池」功能块退役移除，17 → 16）。 */
export const WORKBENCH_TASK_TYPE_TEXT: Record<string, string> = {
  capacity_approval: '产能审批',
  change_implementation: '变更实施',
  change_verify: '变更验收',
  closeout: '项目收尾',
  contribution_confirm: '贡献确认',
  deletion_review: '删除审批',
  handover: '项目移交',
  key_gate: '关键 Gate 评审',
  key_gate_arbitration: 'Gate 仲裁',
  kpi_fill: 'KPI 填写',
  rd_replacement: '研发替补',
  receipt_review: '回执审核',
  retirement_review: '退役评审',
  stage_sign: '阶段签署',
  strategic_change: '战略变更',
  waiver_review: '豁免审批',
};

/** taskType 查表函数（未知值原样返回，便于渲染层 fallback）。 */
export function taskTypeText(value: string): string {
  return WORKBENCH_TASK_TYPE_TEXT[value] ?? value;
}

/**
 * 工作台首屏三类决定。
 * 审核类即使 isBlocking 为 1 也归「待我审核」：聚合器把该标志写成 1，只表示下游被挡住。
 * 只有 stage_sign 的 isBlocking 来自动作自身，才归「被阻断需我决定」。
 */
export type WorkbenchDecisionBucket = 'blocked' | 'fact' | 'review';

const REVIEW_TASK_TYPES = new Set([
  'capacity_approval',
  'contribution_confirm',
  'deletion_review',
  'key_gate',
  'key_gate_arbitration',
  'receipt_review',
  'retirement_review',
  'strategic_change',
  'waiver_review',
]);

export const DECISION_BUCKET_TEXT: Record<WorkbenchDecisionBucket, string> = {
  blocked: '被阻断需我决定',
  fact: '需要我补充事实',
  review: '待我审核',
};

export const DECISION_BUCKET_ACTION: Record<WorkbenchDecisionBucket, string> = {
  blocked: '去决定',
  fact: '去补充',
  review: '去审核',
};

/** 按现有 taskType 归入三类；未知类型归补充事实，不另开第四栏。 */
export function decisionBucket(
  taskType: string,
  isBlocking: null | string,
): WorkbenchDecisionBucket {
  if (taskType === 'stage_sign' && isBlocking === '1') {
    return 'blocked';
  }
  if (REVIEW_TASK_TYPES.has(taskType)) {
    return 'review';
  }
  return 'fact';
}

/** 决策动作 APPROVE/REJECT（系数变更等审批页用）。 */
export const DECISION_LABEL: Record<string, string> = {
  APPROVE: '通过',
  REJECT: '驳回',
};

/** 系数变更审批状态（项目详情 changes 页自定义 4 态；非通用状态机）。 */
export const COEF_CHANGE_STATUS_TEXT: Record<string, string> = {
  CONFIRMED: '已确认生效',
  PENDING_LEADER: '待产品组长确认',
  PENDING_SECOND: '待对方确认',
  REJECTED: '已驳回',
};

/** 需求状态色调补充（demand/index.vue 原型色系；非业务状态机 tone）。 */
export const DEMAND_STATUS_TONE: Record<string, string> = {
  ACCEPTED: 'blue',
  ARCHIVED: 'gray',
  CLOSED: 'gray',
  EVALUATING: 'blue',
  PROCESSING: 'blue',
  SCHEDULED: 'green',
  SUBMITTED: 'amber',
};

/** 删除申请状态中文（api/ipd/deletion 实际使用的 code 与 _shared/ipd-state-machines.DELETION_STATUS_MACHINE 不同，
 *  前端展示仍按此 5 态：ADMIN_REVIEW/DELETED/LEADER_REVIEW/REJECTED/WITHDRAWN）。 */
export const DELETION_STATUS_TEXT: Record<string, string> = {
  ADMIN_REVIEW: '超管终审中',
  DELETED: '已删除（归档）',
  LEADER_REVIEW: '组长初审中',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
};

// ============ AI 执行模式与任务状态（R236 生命周期节点智能体接线） ============

/**
 * AI 执行模式中文（R236 裁决 C：ActionDef.execMode 三档）。
 * 真值源：后端 ActionCatalog 69 码 × execMode 列（AI_DIRECT / AI_GENERATE / HUMAN_GATE）。
 */
export const EXEC_MODE_TEXT: Record<string, string> = {
  AI_DIRECT: 'AI 直接执行',
  AI_GENERATE: 'AI 生成草稿',
  HUMAN_GATE: '人工评审 Gate',
};

export const EXEC_MODE_TONE: Record<string, string> = {
  AI_DIRECT: 'processing',
  AI_GENERATE: 'warning',
  HUMAN_GATE: 'error',
};

export function execModeText(mode: null | string | undefined, fallback = '—'): string {
  if (!mode) return fallback;
  return EXEC_MODE_TEXT[mode] ?? fallback;
}

export function execModeTone(mode: null | string | undefined, fallback = 'default'): string {
  if (!mode) return fallback;
  return EXEC_MODE_TONE[mode] ?? fallback;
}

/**
 * AI 任务状态中文（R221 outbox 状态机：PENDING→RUNNING→SUCCEEDED/FAILED/DEAD）。
 * DEAD = ≥3 次退避失败后转人工介入（视觉必须区别于普通 FAILED）。
 */
export const AI_TASK_STATUS_TEXT: Record<string, string> = {
  DEAD: '已转人工',
  FAILED: '已失败',
  PENDING: '待执行',
  RUNNING: '执行中',
  SUCCEEDED: '已成功',
};

export const AI_TASK_STATUS_TONE: Record<string, string> = {
  DEAD: 'error',
  FAILED: 'warning',
  PENDING: 'default',
  RUNNING: 'processing',
  SUCCEEDED: 'success',
};

export function aiTaskStatusText(status: null | string | undefined, fallback = '—'): string {
  if (!status) return fallback;
  return AI_TASK_STATUS_TEXT[status] ?? fallback;
}

export function aiTaskStatusTone(status: null | string | undefined, fallback = 'default'): string {
  if (!status) return fallback;
  return AI_TASK_STATUS_TONE[status] ?? fallback;
}

/**
 * 67 码 → execMode 静态映射（R236 §5 SSOT 矩阵，与后端 ActionCatalog 逐行对齐）。
 * 2026-10-03：LC01（上市后销售与回款跟踪，随「回款台账」退役）与 LC03（上市后6个月终算，
 * 随「奖金池」退役）两码已从后端 ActionCatalog 移除，本表同步删除（69 → 67）。
 * 用途：flow.vue 在尚无 AI 任务时仍可展示节点的执行模式徽标——`/stage-actions` 的 VO 不带
 * execMode，只有已产生 AI 任务时 AiAgentTaskView 才带，故此处存一份前端副本。
 * 维护纪律：后端 ActionCatalog 改档位须同步此表——由后端哨兵
 * `ExecutorCoverageSentinelTest#frontEndExecModeMapMatchesActionCatalog` 跨仓逐码对账，
 * 不同步即红（跨仓定位用 IPD_FE_SHARED_DIR，与 guard 契约测试同一约定）。
 */
export const ACTION_EXEC_MODE: Record<string, string> = {
  C01: 'AI_GENERATE', C02: 'AI_GENERATE', C03: 'AI_GENERATE', C04: 'AI_GENERATE',
  C05: 'AI_GENERATE', C06: 'AI_GENERATE', C07: 'AI_DIRECT', C08: 'AI_DIRECT',
  C09: 'AI_DIRECT', C10: 'AI_DIRECT', C11: 'HUMAN_GATE', C12: 'AI_GENERATE',
  P01: 'AI_GENERATE', P02: 'AI_DIRECT', P03: 'AI_GENERATE', P04: 'AI_GENERATE',
  P05: 'AI_GENERATE', P06: 'AI_GENERATE', P07: 'AI_GENERATE', P08: 'AI_DIRECT',
  P09: 'AI_DIRECT', P10: 'AI_DIRECT', P11: 'AI_GENERATE', P12: 'AI_DIRECT',
  P13: 'HUMAN_GATE',
  D01: 'AI_GENERATE', D02: 'AI_DIRECT', D03: 'AI_DIRECT', D04: 'AI_GENERATE',
  D05: 'HUMAN_GATE', D06: 'AI_GENERATE', D07: 'AI_DIRECT', D08: 'AI_DIRECT',
  D09: 'AI_DIRECT', D10: 'AI_DIRECT', D11: 'AI_DIRECT',
  V01: 'AI_DIRECT', V02: 'AI_DIRECT', V03: 'AI_DIRECT', V04: 'AI_DIRECT',
  V05: 'AI_DIRECT', V06: 'AI_GENERATE', V07: 'AI_GENERATE', V08: 'AI_GENERATE',
  V09: 'AI_DIRECT', V10: 'AI_DIRECT', V11: 'AI_DIRECT', V12: 'AI_DIRECT',
  L01: 'AI_GENERATE', L02: 'AI_DIRECT', L03: 'AI_GENERATE', L04: 'AI_GENERATE',
  L05: 'AI_DIRECT', L06: 'AI_DIRECT', L07: 'HUMAN_GATE', L08: 'AI_DIRECT',
  LC02: 'HUMAN_GATE', LC04: 'AI_DIRECT',
  LC05: 'AI_DIRECT', LC06: 'AI_DIRECT', LC07: 'AI_DIRECT', LC08: 'AI_GENERATE',
  LC09: 'AI_DIRECT',
  K01: 'AI_DIRECT', K02: 'AI_DIRECT', K03: 'AI_DIRECT', K04: 'AI_DIRECT',
};
