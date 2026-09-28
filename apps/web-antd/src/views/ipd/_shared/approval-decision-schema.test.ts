/**
 * approval-decision-schema 单测（D-3⑧）：草稿初始值、可提交判定、
 * 意见归一、角色×approve 条件提示命中、删除审核 schema 实例与存量页文案一致性。
 */
import { describe, expect, it } from 'vitest';

import {
  canSubmitDecision,
  createDecisionDraft,
  DELETION_REVIEW_SCHEMA,
  normalizedOpinion,
  visibleHints,
} from './approval-decision-schema';

describe('createDecisionDraft', () => {
  it('初始值与存量页 decision 对齐：approve=true，其余空串', () => {
    expect(createDecisionDraft()).toEqual({ approve: true, entityId: '', opinion: '' });
  });
  it('实例间互不共享', () => {
    const a = createDecisionDraft();
    const b = createDecisionDraft();
    a.entityId = '1';
    expect(b.entityId).toBe('');
  });
});

describe('canSubmitDecision', () => {
  it('空/纯空白编号不可提交（与存量页 :disabled 口径一致）', () => {
    expect(canSubmitDecision(createDecisionDraft())).toBe(false);
    expect(canSubmitDecision({ ...createDecisionDraft(), entityId: '   ' })).toBe(false);
  });
  it('有编号可提交（字符串 ID 不做数值校验，long ID 原文通过）', () => {
    expect(canSubmitDecision({ ...createDecisionDraft(), entityId: '1234567890123456789' })).toBe(true);
  });
});

describe('normalizedOpinion', () => {
  it('空白意见 → undefined（trim() || undefined 口径）', () => {
    expect(normalizedOpinion({ ...createDecisionDraft(), opinion: '  ' })).toBeUndefined();
  });
  it('有效意见 trim 返回', () => {
    expect(normalizedOpinion({ ...createDecisionDraft(), opinion: ' 驳回理由 ' })).toBe('驳回理由');
  });
});

describe('visibleHints（角色 × approve 命中矩阵）', () => {
  it('leader + approve=true → 仅初审提示（info 语气）', () => {
    expect(visibleHints(DELETION_REVIEW_SCHEMA, 'leader', true)).toEqual([
      { text: '通过后将进入超级管理员终审（AC-DEL-02）。', tone: 'info' },
    ]);
  });
  it('admin + approve=true → 仅终审软删警示（danger 语气）', () => {
    expect(visibleHints(DELETION_REVIEW_SCHEMA, 'admin', true)).toEqual([
      { text: '终审通过将原子软删目标对象，请谨慎操作。', tone: 'danger' },
    ]);
  });
  it('approve=false → 无提示（驳回不触发风险文案）', () => {
    expect(visibleHints(DELETION_REVIEW_SCHEMA, 'leader', false)).toEqual([]);
    expect(visibleHints(DELETION_REVIEW_SCHEMA, 'admin', false)).toEqual([]);
  });
});

describe('DELETION_REVIEW_SCHEMA 文案与存量页一致', () => {
  it('字段文案与改造前 review 页逐字一致（防行为漂移）', () => {
    expect(DELETION_REVIEW_SCHEMA.submitLabel).toBe('提交审核意见');
    expect(DELETION_REVIEW_SCHEMA.entityIdLabel).toBe('申请编号（点击列表行可自动填入）');
    expect(DELETION_REVIEW_SCHEMA.entityIdPlaceholder).toBe('待审核的删除申请编号');
    expect(DELETION_REVIEW_SCHEMA.approveText).toBe('通过');
    expect(DELETION_REVIEW_SCHEMA.rejectText).toBe('驳回');
    expect(DELETION_REVIEW_SCHEMA.opinionLabel).toBe('意见说明（驳回时建议填写）');
    expect(DELETION_REVIEW_SCHEMA.opinionPlaceholder).toBe('审核意见，随申请记录与审计留存');
  });
});
