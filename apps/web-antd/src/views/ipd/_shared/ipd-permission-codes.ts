/**
 * IPD 模块权限码集中常量（前端单一权威源）。
 *
 * 镜像后端 `org.ruoyi.ipd.security.IpdPermissionCode`（53 个码）。
 * 路由表与按钮 v-access:code 引用本文件常量，禁止直接书写字面量。
 *
 * <p>使用方式：
 * <pre>
 * import { IPD_PERMISSION_CODES } from '../_shared/ipd-permission-codes';
 * meta: { access: [IPD_PERMISSION_CODES.PROJECT_LIST] }
 * &lt;Button v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_DISTRIBUTE"&gt;分配&lt;/Button&gt;
 * </pre>
 *
 * <p>新增流程：后端加新码 → 同步在本表加 key+value（与后端常量名保持一致）；
 * 严禁在路由表 / 组件内自建裸字面量。
 */
export const IPD_PERMISSION_CODES = {
  // 项目模块
  PROJECT_LIST: 'ipd:project:list',
  PROJECT_QUERY: 'ipd:project:query',
  PROJECT_CREATE: 'ipd:project:add',
  PROJECT_STATUS_CHANGE: 'ipd:project:edit',

  // 产品模块
  PRODUCT_LIST: 'ipd:product:list',
  PRODUCT_QUERY: 'ipd:product:query',
  PRODUCT_CREATE: 'ipd:product:add',
  PRODUCT_BIND_PROJECT: 'ipd:product:edit',

  // 阶段动作
  STAGE_ACTION_LIST: 'ipd:stage-action:list',
  STAGE_ACTION_EXECUTE: 'ipd:stage-action:edit',
  STAGE_ACTION_DELIVERABLE: 'ipd:stage-action:add',
  STAGE_ACTION_INSTANTIATE: 'ipd:stage-action:add',

  // 国别认证模板
  CERT_TEMPLATE_LIST: 'ipd:cert-template:list',
  CERT_TEMPLATE_CREATE: 'ipd:cert-template:add',
  CERT_TEMPLATE_DELETE: 'ipd:cert-template:remove',

  // Gate 评审要素
  GATE_ELEMENT_LIST: 'ipd:gate-element:list',
  GATE_ELEMENT_CREATE: 'ipd:gate-element:add',
  GATE_ELEMENT_UPDATE: 'ipd:gate-element:edit',
  GATE_ELEMENT_DISABLE: 'ipd:gate-element:remove',
  GATE_ELEMENT_PUBLISH: 'ipd:gate-element:publish',
  GATE_ELEMENT_ARCHIVE: 'ipd:gate-element:archive',
  GATE_ELEMENT_COPY: 'ipd:gate-element:copy',
  GATE_ELEMENT_REVERT: 'ipd:gate-element:revert',

  // 删除申请
  DELETION_REQUEST_ARCHIVE: 'ipd:deletion-request:archive',
  DELETION_REQUEST_PURGE: 'ipd:deletion-request:purge',
  DELETION_REQUEST_SUBMIT: 'ipd:deletion-request:submit',
  DELETION_REQUEST_LEADER: 'ipd:deletion-request:leader',
  DELETION_REQUEST_ADMIN: 'ipd:deletion-request:admin',

  // Gate 评审
  GATE_REVIEW_LIST: 'ipd:gate-review:list',
  GATE_REVIEW_INITIATE: 'ipd:gate-review:add',
  GATE_REVIEW_APPROVE: 'ipd:gate-review:edit',

  // 系数提议/确认（AC-INC-15c）
  COEFFICIENT_PROPOSE: 'ipd:coefficient:propose',
  COEFFICIENT_CONFIRM: 'ipd:coefficient:confirm',

  // 通知收件箱
  NOTIFICATION_READ: 'ipd:notification:read',
  NOTIFICATION_DISPATCH: 'ipd:notification:dispatch',

  // AI 文档助手（P1-10.1）
  AI_DOCUMENT_LIST: 'ipd:ai-document:list',
  AI_DOCUMENT_CREATE: 'ipd:ai-document:add',
  AI_DOCUMENT_REVISE: 'ipd:ai-document:edit',
  AI_DOCUMENT_REVIEW: 'ipd:ai-document:review',

  // AI 模型配置（P4-2.1）
  AI_MODEL_LIST: 'ipd:ai-model:list',
  AI_MODEL_EDIT: 'ipd:ai-model:edit',

  // SOP 模板
  SOP_TEMPLATE_EDIT: 'ipd:sop-template:edit',
  SOP_TEMPLATE_LIST: 'ipd:sop-template:list',

  // KPI 考核
  KPI_QUERY: 'ipd:kpi:query',

  // 奖金池（P3-4.4）
  BONUS_POOL_QUERY: 'ipd:bonus-pool:query',
  BONUS_POOL_COMPUTE: 'ipd:bonus-pool:compute',
  BONUS_POOL_FREEZE: 'ipd:bonus-pool:freeze',
  BONUS_POOL_DISTRIBUTE: 'ipd:bonus-pool:distribute',

  // 贡献度（P3-6.2）
  CONTRIBUTION_QUERY: 'ipd:contribution:query',
  CONTRIBUTION_SAVE: 'ipd:contribution:save',
  CONTRIBUTION_CONFIRM: 'ipd:contribution:confirm',

  // 负反馈（P3-8.2）
  NEGATIVE_FEEDBACK_QUERY: 'ipd:negative-feedback:query',
  NEGATIVE_FEEDBACK_CREATE: 'ipd:negative-feedback:create',
  NEGATIVE_FEEDBACK_DECIDE: 'ipd:negative-feedback:decide',

  // 切换验收（P3-7.1）
  SWITCHING_ACCEPTANCE_QUERY: 'ipd:switching-acceptance:query',
  SWITCHING_ACCEPTANCE_ADMIN: 'ipd:switching-acceptance:admin',

  // 审计日志（SEC-02）
  AUDIT_LOG_LIST: 'ipd:audit-log:list',
  AUDIT_LOG_VERIFY: 'ipd:audit-log:verify',
  AUDIT_LOG_EXPORT: 'ipd:audit-log:export',

  // 合规（AC-COMP-01/04/05）
  COMPLIANCE_READ: 'ipd:compliance:read',
  COMPLIANCE_WRITE: 'ipd:compliance:write',

  // 系统参数
  SYSTEM_CONFIG_LIST: 'ipd:system-config:list',
  SYSTEM_CONFIG_READ: 'ipd:system-config:read',
  SYSTEM_CONFIG_UPDATE: 'ipd:system-config:update',

  // 招标超管指派（P2-3.3）
  BID_INVITATION_ADMIN_ASSIGN: 'ipd:bid-invitation:admin-assign',

  // 移交撤销（HIGH-3.1）
  HANDOVER_CANCEL: 'ipd:handover:cancel',
} as const;

export type IpdPermissionCode = (typeof IPD_PERMISSION_CODES)[keyof typeof IPD_PERMISSION_CODES];

/** 全部 53 个权限码（用于测试断言、批量校验、初始化菜单树）。 */
export const ALL_IPD_PERMISSION_CODES: readonly IpdPermissionCode[] = Object.freeze(
  Object.values(IPD_PERMISSION_CODES),
);

/** 按 49 页导航地图分组：路由 meta.access 直接引用本组常量数组。 */
export const PAGE_PERMISSIONS: Record<string, readonly IpdPermissionCode[]> = {
  // 页07-15 项目空间
  '/ipd/projects': [IPD_PERMISSION_CODES.PROJECT_LIST],
  '/ipd/projects/create': [IPD_PERMISSION_CODES.PROJECT_CREATE],
  // 页16-17 产品空间
  '/ipd/products': [IPD_PERMISSION_CODES.PRODUCT_LIST],
  // 页18 国别认证清单
  '/ipd/admin/cert-templates': [IPD_PERMISSION_CODES.CERT_TEMPLATE_LIST],
  // 页19-22 研发招募
  '/ipd/bids': [IPD_PERMISSION_CODES.BID_INVITATION_ADMIN_ASSIGN],
  // 页23 Gate 评审
  '/ipd/admin/gate-elements': [IPD_PERMISSION_CODES.GATE_ELEMENT_LIST],
  // 页27 项目移交
  '/ipd/handover': [IPD_PERMISSION_CODES.HANDOVER_CANCEL],
  // 页29-32 KPI 考核
  '/ipd/kpi/functional': [IPD_PERMISSION_CODES.KPI_QUERY],
  '/ipd/kpi/project-score': [IPD_PERMISSION_CODES.KPI_QUERY],
  // 页33 津贴台账
  '/ipd/incentive/allowance': [IPD_PERMISSION_CODES.SYSTEM_CONFIG_READ],
  // 页34 奖金池核算
  '/ipd/incentive/bonus-pool': [
    IPD_PERMISSION_CODES.BONUS_POOL_QUERY,
    IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE,
    IPD_PERMISSION_CODES.BONUS_POOL_FREEZE,
    IPD_PERMISSION_CODES.BONUS_POOL_DISTRIBUTE,
  ],
  // 页35 贡献度评定
  '/ipd/incentive/contribution': [
    IPD_PERMISSION_CODES.CONTRIBUTION_QUERY,
    IPD_PERMISSION_CODES.CONTRIBUTION_SAVE,
    IPD_PERMISSION_CODES.CONTRIBUTION_CONFIRM,
  ],
  // 页36 负反馈执行
  '/ipd/incentive/negative-feedback': [
    IPD_PERMISSION_CODES.NEGATIVE_FEEDBACK_QUERY,
    IPD_PERMISSION_CODES.NEGATIVE_FEEDBACK_CREATE,
    IPD_PERMISSION_CODES.NEGATIVE_FEEDBACK_DECIDE,
  ],
  // 页40 需求管理
  '/ipd/requirements': [IPD_PERMISSION_CODES.PRODUCT_QUERY],
  // 页42 AI 文档助手
  '/ipd/ai-assistant': [
    IPD_PERMISSION_CODES.AI_DOCUMENT_LIST,
    IPD_PERMISSION_CODES.AI_DOCUMENT_CREATE,
    IPD_PERMISSION_CODES.AI_DOCUMENT_REVISE,
    IPD_PERMISSION_CODES.AI_DOCUMENT_REVIEW,
  ],
  // 页46 SOP 模板
  '/ipd/admin/sop': [IPD_PERMISSION_CODES.SOP_TEMPLATE_EDIT],
  // 页48 AI 模型配置
  '/ipd/admin/ai-config': [IPD_PERMISSION_CODES.AI_MODEL_EDIT],
  // 页49 超管移交
  '/ipd/admin/handover': [IPD_PERMISSION_CODES.HANDOVER_CANCEL],
  // 审计日志
  '/ipd/audit-logs': [
    IPD_PERMISSION_CODES.AUDIT_LOG_LIST,
    IPD_PERMISSION_CODES.AUDIT_LOG_VERIFY,
    IPD_PERMISSION_CODES.AUDIT_LOG_EXPORT,
  ],
  // 系统参数
  '/ipd/admin/config': [
    IPD_PERMISSION_CODES.SYSTEM_CONFIG_LIST,
    IPD_PERMISSION_CODES.SYSTEM_CONFIG_UPDATE,
  ],
};

/** 给定路径返回该页所需的权限码（无映射返回空数组 = 内部全员可访问）。 */
export function getRequiredCodes(path: string): readonly IpdPermissionCode[] {
  if (PAGE_PERMISSIONS[path]) return PAGE_PERMISSIONS[path];
  // 子路径向上回溯（如 /ipd/projects/123/overview → /ipd/projects）
  for (const key of Object.keys(PAGE_PERMISSIONS).sort((a, b) => b.length - a.length)) {
    if (path.startsWith(`${key}/`)) return PAGE_PERMISSIONS[key];
  }
  return [];
}
