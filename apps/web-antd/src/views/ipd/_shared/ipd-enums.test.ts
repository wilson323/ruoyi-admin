// IPD 通用展示枚举单测：角色 / 阶段 / 状态 / 优先级 / 严重度。
import { describe, expect, it } from 'vitest';

import {
  PRIORITY_TEXT,
  PRIORITY_TONE,
  ROLE_TEXT,
  SEVERITY_TEXT,
  SEVERITY_TONE,
  STAGE_TONE,
  bonusStateLabel,
  bonusStateTone,
  changeStateLabel,
  changeStateTone,
  demandStateLabel,
  deletionStateLabel,
  gateStateLabel,
  priorityText,
  priorityTone,
  projectStateLabel,
  projectStateTone,
  roleText,
  severityText,
  severityTone,
} from './ipd-enums';

describe('ROLE_TEXT 内部 5 角色', () => {
  it('所有 5 角色映射存在', () => {
    expect(ROLE_TEXT.GROUP_LEADER).toBe('产品组长');
    expect(ROLE_TEXT.MARKET_PM).toBe('市场PM');
    expect(ROLE_TEXT.RD_PM).toBe('研发PM');
    expect(ROLE_TEXT.SUPER_ADMIN).toBe('超级管理员');
    expect(ROLE_TEXT.INTERNAL).toBe('内部成员');
  });

  it('roleText 未知值返回 fallback', () => {
    expect(roleText('WEIRD')).toBe('未知角色');
    expect(roleText(null)).toBe('未知角色');
    expect(roleText('WEIRD', '兜底')).toBe('兜底');
  });
});

describe('STAGE_TONE 六阶段配色', () => {
  it('6 阶段齐全', () => {
    expect(Object.keys(STAGE_TONE).sort()).toEqual(
      ['CONCEPT', 'DEV', 'LAUNCH', 'LIFECYCLE', 'PLAN', 'VALID'].sort(),
    );
  });
});

describe('PRIORITY_TEXT 优先级 3 档', () => {
  it('高/中/低', () => {
    expect(PRIORITY_TEXT.HIGH).toBe('高');
    expect(PRIORITY_TEXT.NORMAL).toBe('中');
    expect(PRIORITY_TEXT.LOW).toBe('低');
    expect(priorityText('UNKNOWN')).toBe('待补充');
    expect(priorityTone('HIGH')).toBe('error');
    expect(PRIORITY_TONE.NORMAL).toBe('processing');
  });
});

describe('SEVERITY_TEXT 严重度 3 档', () => {
  it('严重/主要/轻微', () => {
    expect(SEVERITY_TEXT.CRITICAL).toBe('严重');
    expect(SEVERITY_TEXT.MAJOR).toBe('主要');
    expect(SEVERITY_TEXT.MINOR).toBe('轻微');
    expect(severityText('UNKNOWN')).toBe('待补充');
    expect(severityTone('MAJOR')).toBe('orange');
    expect(SEVERITY_TONE.CRITICAL).toBe('red');
  });
});

describe('业务状态机 label/tone 转发', () => {
  it('project 状态转发到状态机', () => {
    expect(projectStateLabel('ACTIVE')).toBe('进行中');
    expect(projectStateLabel('ARCHIVED')).toBe('已归档');
    expect(projectStateTone('SUSPENDED')).toBe('warning');
  });

  it('bonus 状态转发', () => {
    expect(bonusStateLabel('DISTRIBUTED')).toBe('已分配');
    expect(bonusStateTone('DRAFT')).toBe('default');
  });

  it('change / gate / demand / deletion 状态转发', () => {
    expect(changeStateLabel('PENDING_SIGN')).toBe('待双签');
    expect(changeStateTone('APPROVED')).toBe('success');
    expect(gateStateLabel('PASSED')).toBe('已通过');
    expect(demandStateLabel('EVALUATING')).toBe('分析中');
    expect(deletionStateLabel('LEADER_APPROVED')).toBe('组长已审');
  });
});
