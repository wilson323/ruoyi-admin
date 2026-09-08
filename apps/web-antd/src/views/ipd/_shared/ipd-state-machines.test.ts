// IPD 业务状态机单测：迁移图、查表、未知值兜底。
import { describe, expect, it } from 'vitest';

import {
  ACTION_STATUS_MACHINE,
  BID_RESPONSE_STATUS_MACHINE,
  BID_STATUS_MACHINE,
  BONUS_STATUS_MACHINE,
  CHANGE_STATUS_MACHINE,
  DELETION_STATUS_MACHINE,
  DEMAND_STATUS_MACHINE,
  GATE_STATUS_MACHINE,
  PROJECT_STATUS_MACHINE,
  isState,
  nextStates,
  stateLabel,
  stateTone,
} from './ipd-state-machines';

describe('PROJECT_STATUS 5 态', () => {
  it('DRAFT 只能迁移到 TEAMING', () => {
    expect(nextStates(PROJECT_STATUS_MACHINE, 'DRAFT')).toEqual(['TEAMING']);
  });

  it('ARCHIVED 终态：无下一态', () => {
    expect(nextStates(PROJECT_STATUS_MACHINE, 'ARCHIVED')).toEqual([]);
  });

  it('ACTIVE 可挂起到 SUSPENDED 或归档', () => {
    const next = nextStates(PROJECT_STATUS_MACHINE, 'ACTIVE');
    expect(next).toContain('SUSPENDED');
    expect(next).toContain('ARCHIVED');
  });

  it('未知码不抛错且 label 返回 fallback', () => {
    expect(isState(PROJECT_STATUS_MACHINE, 'UNKNOWN')).toBe(false);
    expect(stateLabel(PROJECT_STATUS_MACHINE, 'UNKNOWN')).toBe('待补充');
    expect(stateLabel(PROJECT_STATUS_MACHINE, 'UNKNOWN', '兜底')).toBe('兜底');
  });
});

describe('BONUS_STATUS 3 态', () => {
  it('DRAFT → CONFIRMED → DISTRIBUTED 单链', () => {
    expect(nextStates(BONUS_STATUS_MACHINE, 'DRAFT')).toEqual(['CONFIRMED']);
    expect(nextStates(BONUS_STATUS_MACHINE, 'CONFIRMED')).toEqual(['DISTRIBUTED']);
    expect(nextStates(BONUS_STATUS_MACHINE, 'DISTRIBUTED')).toEqual([]);
  });

  it('DISTRIBUTED tone = success（终态高亮）', () => {
    expect(stateTone(BONUS_STATUS_MACHINE, 'DISTRIBUTED')).toBe('success');
  });
});

describe('CHANGE_STATUS 4 态', () => {
  it('DRAFT → PENDING_SIGN → APPROVED/REJECTED', () => {
    expect(nextStates(CHANGE_STATUS_MACHINE, 'DRAFT')).toEqual(['PENDING_SIGN']);
    const next = nextStates(CHANGE_STATUS_MACHINE, 'PENDING_SIGN');
    expect(next).toContain('APPROVED');
    expect(next).toContain('REJECTED');
  });

  it('APPROVED/REJECTED 终态', () => {
    expect(nextStates(CHANGE_STATUS_MACHINE, 'APPROVED')).toEqual([]);
    expect(nextStates(CHANGE_STATUS_MACHINE, 'REJECTED')).toEqual([]);
  });
});

describe('GATE_STATUS 4 态', () => {
  it('FAILED 可重评审回 IN_PROGRESS', () => {
    expect(nextStates(GATE_STATUS_MACHINE, 'FAILED')).toContain('IN_PROGRESS');
  });
});

describe('DELETION_STATUS 6 态', () => {
  it('PENDING 可撤回/组长通过/驳回（三路）', () => {
    const next = nextStates(DELETION_STATUS_MACHINE, 'PENDING');
    expect(next).toContain('WITHDRAWN');
    expect(next).toContain('LEADER_APPROVED');
    expect(next).toContain('REJECTED');
  });

  it('LEADER_APPROVED → PURGED 或 REJECTED', () => {
    const next = nextStates(DELETION_STATUS_MACHINE, 'LEADER_APPROVED');
    expect(next).toContain('PURGED');
    expect(next).toContain('REJECTED');
  });
});

describe('DEMAND_STATUS 8 态', () => {
  it('SUBMITTED 仅可受理', () => {
    expect(nextStates(DEMAND_STATUS_MACHINE, 'SUBMITTED')).toEqual(['ACCEPTED']);
  });

  it('EVALUATING → SCHEDULED', () => {
    expect(nextStates(DEMAND_STATUS_MACHINE, 'EVALUATING')).toEqual(['SCHEDULED']);
  });

  it('SCHEDULED 可同时进入 PROCESSING 或 IN_DEV', () => {
    const next = nextStates(DEMAND_STATUS_MACHINE, 'SCHEDULED');
    expect(next).toContain('PROCESSING');
    expect(next).toContain('IN_DEV');
  });
});

describe('通用 fallback 语义', () => {
  it('null/undefined 输入返回 fallback 而非空串', () => {
    expect(stateLabel(PROJECT_STATUS_MACHINE, null)).toBe('待补充');
    expect(stateLabel(PROJECT_STATUS_MACHINE, undefined)).toBe('待补充');
    expect(stateTone(PROJECT_STATUS_MACHINE, null)).toBe('default');
  });
});

describe('A28 新增状态机', () => {
  it('BID_STATUS 4 态迁移：OPEN → SELECTED/EXPIRED/CLOSED', () => {
    const next = nextStates(BID_STATUS_MACHINE, 'OPEN');
    expect(next).toContain('SELECTED');
    expect(next).toContain('EXPIRED');
    expect(next).toContain('CLOSED');
  });

  it('BID_STATUS EXPIRED/CLOSED 终态', () => {
    expect(nextStates(BID_STATUS_MACHINE, 'EXPIRED')).toEqual([]);
    expect(nextStates(BID_STATUS_MACHINE, 'CLOSED')).toEqual([]);
  });

  it('BID_RESPONSE_STATUS PENDING → 三路（ACCEPTED/REJECTED/WITHDRAWN）', () => {
    const next = nextStates(BID_RESPONSE_STATUS_MACHINE, 'PENDING');
    expect(next).toContain('ACCEPTED');
    expect(next).toContain('REJECTED');
    expect(next).toContain('WITHDRAWN');
  });

  it('ACTION_STATUS 5 态：IN_PROGRESS → DONE/DELAYED', () => {
    const next = nextStates(ACTION_STATUS_MACHINE, 'IN_PROGRESS');
    expect(next).toContain('DONE');
    expect(next).toContain('DELAYED');
  });

  it('ACTION_STATUS DONE/NA 终态', () => {
    expect(nextStates(ACTION_STATUS_MACHINE, 'DONE')).toEqual([]);
    expect(nextStates(ACTION_STATUS_MACHINE, 'NA')).toEqual([]);
  });
});
