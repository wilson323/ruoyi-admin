/**
 * ZK-IPD 业务规则显示文案（前端业务逻辑显示统一真理源）
 *
 * 真值来源：ZK-IPD 仓 `/Users/mac/Documents/ZK-IPD/产品流程细化管理工具 2/IPD产品经理管理系统·最终完整版AI开发Prompt（全规则闭环无遗留疑问）.md`
 *
 * 设计原则：
 * 1. 文案按 ZK-IPD Prompt 章节分类（§一~§十一）
 * 2. 每个规则含：key（用于单测断言）、chapter（章节号）、rule（中文规则）、promptRef（Prompt 章节定位）
 * 3. 前端 UI 通过 import 该模块渲染 Alert 提示，确保 UI 显示文案与后端业务逻辑一致
 * 4. 后续如需调整文案，必须同步修改 promptRef 对应的 Prompt 章节
 */

export interface ZkIpdRule {
  key: string;
  chapter: string;
  rule: string;
  promptRef: string;
}

/** ZK-IPD §二.10：归档后只读 */
export const ZK_RULE_ARCHIVED_READONLY: ZkIpdRule = {
  key: 'archived-readonly',
  chapter: '§二.10',
  rule: '项目归档后仅可查看、导出所有资料，资料只读，禁止任何编辑操作。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §二.10',
};

/** ZK-IPD §三.2.1：奖金池公式 = 实际回款 × 5% × S/A/B 系数 */
export const ZK_RULE_BONUS_POOL_FORMULA: ZkIpdRule = {
  key: 'bonus-pool-formula',
  chapter: '§三.2.1',
  rule: '奖金池 = 上市后连续 6 个月实际回款金额 × 5% × 项目 S/A/B 差异化系数。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §三.2.1',
};

/** ZK-IPD §三.2.4：分配比例市场 40-65% / 研发 35-60% */
export const ZK_RULE_BONUS_DISTRIBUTION: ZkIpdRule = {
  key: 'bonus-distribution',
  chapter: '§三.2.4',
  rule: '市场 PM 分配比例 40%-65%；研发 PM 分配比例 35%-60%。上市 90 天复盘后由双 PM + 上级三方最终评定。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §三.2.4',
};

/** ZK-IPD §三.1.2：多项目津贴叠加封顶 2 倍 */
export const ZK_RULE_ALLOWANCE_CAP: ZkIpdRule = {
  key: 'allowance-cap-2x',
  chapter: '§三.1.2',
  rule: '多项目津贴叠加，个人月度总额封顶为自身等级额度 2 倍（L1=1000, L2=1500, L3=2000, L4=2500, L5=3000）。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §三.1.1 + §三.1.2',
};

/** ZK-IPD §三.1.4：长期无产出提醒（仅提醒不自动停发） */
export const ZK_RULE_LONG_NO_OUTPUT_ALERT: ZkIpdRule = {
  key: 'long-no-output-alert',
  chapter: '§三.1.4',
  rule: '项目连续 2 个月无实质产出时，系统自动提醒管理员复核津贴发放资格，仅提醒不自动停发。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §三.1.4',
};

/** ZK-IPD §三.1.5：月度考核 < 60 分停发 */
export const ZK_RULE_SCORE_BELOW_60_STOP: ZkIpdRule = {
  key: 'score-below-60-stop',
  chapter: '§三.1.5',
  rule: '月度考核分数 < 60 分当月停发津贴；PM 中途移交项目，新 PM 按自身等级核算津贴，过往阶段不追溯重算。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §三.1.5',
};

/** ZK-IPD §四.1.3：招标到期无人应标提醒市场 PM */
export const ZK_RULE_BID_EXPIRED_NOTIFY: ZkIpdRule = {
  key: 'bid-expired-notify',
  chapter: '§四.1.3',
  rule: '招标单到期无人应标，系统自动置「已过期」并通知市场 PM 重新发起。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §四.1.3',
};

/** ZK-IPD §四.1.5：招标条件变更通知所有 PENDING 应标者 */
export const ZK_RULE_BID_CONDITIONS_CHANGE_NOTIFY: ZkIpdRule = {
  key: 'bid-conditions-change-notify',
  chapter: '§四.1.5',
  rule: '市场 PM 可在招标有效期内随时修改招标条件，所有变更将通知所有 PENDING 应标者。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §四.1.5',
};

/** ZK-IPD §四.1.4：研发 PM 拒绝应标不留痕 */
export const ZK_RULE_BID_REJECT_NO_TRACE: ZkIpdRule = {
  key: 'bid-reject-no-trace',
  chapter: '§四.1.4',
  rule: '研发 PM 可拒绝应标，拒绝行为不留系统痕迹（不记录、不通知、不写审计）。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §四.1.4 + §四.1',
};

/** ZK-IPD §四.1.6：挂起超 30 日超管可指派 */
export const ZK_RULE_BID_ADMIN_ASSIGN_30D: ZkIpdRule = {
  key: 'bid-admin-assign-30d',
  chapter: '§四.1.6',
  rule: '招标单挂起超 30 日无应标，超管可一键指派研发 PM，无需应标行。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §四.1（衍生工程规则）',
};

/** ZK-IPD §九：超管权限移交专属路径 */
export const ZK_RULE_SUPER_ADMIN_TRANSFER: ZkIpdRule = {
  key: 'super-admin-transfer',
  chapter: '§九',
  rule: '超管权限移交完成后，原超管账号作废失效（accountStatus=DISABLED + 企微解绑），新人 personType 提升为 SUPER_ADMIN。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §九',
};

/** ZK-IPD §六.2：项目移交保留全部历史 */
export const ZK_RULE_HANDOVER_KEEP_HISTORY: ZkIpdRule = {
  key: 'handover-keep-history',
  chapter: '§六.2',
  rule: '项目移交时，全部历史审批、Gate 评审、决策日志、文档资料、奖金台账、流程记录完整保留并跟随项目迁移。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §六.2',
};

/** ZK-IPD §十.2：审计日志所有角色可导出 + 不可篡改 */
export const ZK_RULE_AUDIT_EXPORTABLE: ZkIpdRule = {
  key: 'audit-exportable',
  chapter: '§十.2',
  rule: '系统所有角色均可导出审计日志，日志不可篡改、永久可追溯。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §十.2',
};

/** ZK-IPD §五.5：需求池删除走双审 */
export const ZK_RULE_DEMAND_POOL_DUAL_REVIEW: ZkIpdRule = {
  key: 'demand-pool-dual-review',
  chapter: '§五.5',
  rule: '需求池所有需求记录属于核心重大数据，删除需走「产品组长初审 + 超级管理员终审」双审流程。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §五.5',
};

/** ZK-IPD §五.6：共担 KPI 按 revision 累加 */
export const ZK_RULE_SHARED_KPI_REVISION: ZkIpdRule = {
  key: 'shared-kpi-revision',
  chapter: '§五.6',
  rule: '共担 KPI 双 PM 各自维护一份同 revision 的归集记录；多次归集 ⇒ revision 递增追加；服务层按 revision DESC 排序，综合分取最新条。',
  promptRef: 'IPD产品经理管理系统·最终完整版AI开发Prompt §五.6',
};

/** 所有规则按页面归类（用于不同页面渲染不同集合） */
export const RULES_BY_PAGE = {
  projectCreate: [ZK_RULE_ARCHIVED_READONLY, ZK_RULE_BONUS_POOL_FORMULA, ZK_RULE_ALLOWANCE_CAP],
  bidRespond: [ZK_RULE_BID_REJECT_NO_TRACE],
  adminConfig: [ZK_RULE_SUPER_ADMIN_TRANSFER, ZK_RULE_AUDIT_EXPORTABLE],
  bidList: [ZK_RULE_BID_EXPIRED_NOTIFY, ZK_RULE_BID_CONDITIONS_CHANGE_NOTIFY, ZK_RULE_BID_ADMIN_ASSIGN_30D],
  workbench: [ZK_RULE_LONG_NO_OUTPUT_ALERT, ZK_RULE_SCORE_BELOW_60_STOP, ZK_RULE_ALLOWANCE_CAP],
  demand: [ZK_RULE_DEMAND_POOL_DUAL_REVIEW],
} as const;

export type PageKey = keyof typeof RULES_BY_PAGE;

/** 把规则数组拼成 Alert description 字符串（用句号 + 换行分段） */
export function renderRulesDescription(rules: readonly ZkIpdRule[]): string {
  return rules
    .map((r, i) => `${i + 1}. ${r.rule}（${r.chapter}）`)
    .join('\n');
}
