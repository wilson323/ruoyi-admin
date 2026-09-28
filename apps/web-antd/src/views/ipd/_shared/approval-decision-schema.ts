/**
 * 审批决策表单/弹窗 schema（D-3⑧ schema 抽取第二批）。
 *
 * <p>消除的重复面：deletion/review 的「编号 + 通过/驳回 + 意见 + 条件风险提示」决策表单，
 * 与后续 my-requests/p0-escalation/permanent-delete 各页决策弹窗同构——字段名、初始值、
 * 可提交判定、角色条件文案在各页逐字散落重复。
 *
 * <p>口径（防双轨）：只 schema 化「字段集合 + 校验 + 文案」，渲染仍由页面用 antdv 原生
 * 组件完成（不新建动态表单组件，与仓内既有「共享逻辑 composable/schema + 页面自渲染」
 * 模式一致，参照 _shared/use-filter-sync.ts 的 helper 定位）。
 *
 * <p>ID 字符串语义（drift-guard 红线）：entityId 全程 string，禁 Number() 转换。
 */

/** 决策结果：true=通过，false=驳回。 */
export type ApprovalChoice = boolean;

/** 决策草稿（与存量页 reactive({ id, approve, opinion }) 形态对齐）。 */
export interface ApprovalDecisionDraft {
  entityId: string;
  approve: ApprovalChoice;
  opinion: string;
}

/** 角色条件提示的命中条件。 */
export interface ApprovalHintRule {
  /** 提示挂起字段（当前仅 approve 二选一驱动提示）。 */
  dependsOn: 'approve';
  /** dependsOn 字段的命中值。 */
  equals: ApprovalChoice;
  /** 生效角色：'any' = 所有可决策角色。 */
  whenRole: 'admin' | 'any' | 'leader';
  /** 展示文案。 */
  text: string;
  /** 视觉语气：info=普通提示 / danger=高危警示（页面按 tone 选样式类）。 */
  tone: 'danger' | 'info';
}

/** 审批决策表单 schema（字段顺序 + 文案 + 校验 + 条件提示一次声明）。 */
export interface ApprovalDecisionSchema {
  /** 表单标题（Card/Modal 标题）。 */
  title: string;
  /** 提交按钮文案。 */
  submitLabel: string;
  /** 实体编号输入字段文案。 */
  entityIdLabel: string;
  entityIdPlaceholder: string;
  /** 通过/驳回单选文案。 */
  approveText: string;
  rejectText: string;
  /** 意见字段文案（驳回时建议填写）。 */
  opinionLabel: string;
  opinionPlaceholder: string;
  /** 角色条件风险提示（按 draft.approve + 角色命中）。 */
  hints: readonly ApprovalHintRule[];
}

/** 新建空草稿（初始 approve=true，与存量页 decision 初值一致）。 */
export function createDecisionDraft(): ApprovalDecisionDraft {
  return { approve: true, entityId: '', opinion: '' };
}

/** 可提交判定：实体编号非空（trim 后），与存量页 :disabled 逻辑对齐。 */
export function canSubmitDecision(draft: ApprovalDecisionDraft): boolean {
  return draft.entityId.trim() !== '';
}

/** 意见归一：空白 → undefined（存量页 `opinion.trim() || undefined` 口径）。 */
export function normalizedOpinion(draft: ApprovalDecisionDraft): string | undefined {
  return draft.opinion.trim() || undefined;
}

/** 命中提示的渲染视图（文案 + 语气，页面按 tone 选样式类）。 */
export interface VisibleApprovalHint {
  text: string;
  tone: 'danger' | 'info';
}

/** 取当前命中提示（角色 + approve 值双条件过滤，按 schema 声明序）。 */
export function visibleHints(
  schema: ApprovalDecisionSchema,
  role: 'admin' | 'leader',
  approve: ApprovalChoice,
): VisibleApprovalHint[] {
  return schema.hints
    .filter(
      (hint) =>
        hint.dependsOn === 'approve' &&
        hint.equals === approve &&
        (hint.whenRole === 'any' || hint.whenRole === role),
    )
    .map((hint) => ({ text: hint.text, tone: hint.tone }));
}

/**
 * 删除审核决策 schema 实例（deletion/review 页消费；文案与 BR-DEL/AC-DEL 条款口径一致）。
 * 组长初审通过 → 进超管终审；超管终审通过 → 原子软删目标对象（AC-DEL-02）。
 */
export const DELETION_REVIEW_SCHEMA: ApprovalDecisionSchema = {
  title: '审核决策',
  submitLabel: '提交审核意见',
  entityIdLabel: '申请编号（点击列表行可自动填入）',
  entityIdPlaceholder: '待审核的删除申请编号',
  approveText: '通过',
  rejectText: '驳回',
  opinionLabel: '意见说明（驳回时建议填写）',
  opinionPlaceholder: '审核意见，随申请记录与审计留存',
  hints: [
    {
      dependsOn: 'approve',
      equals: true,
      whenRole: 'leader',
      text: '通过后将进入超级管理员终审（AC-DEL-02）。',
      tone: 'info',
    },
    {
      dependsOn: 'approve',
      equals: true,
      whenRole: 'admin',
      text: '终审通过将原子软删目标对象，请谨慎操作。',
      tone: 'danger',
    },
  ],
};
