/**
 * Gate 评审详情页 button-policy 决策矩阵单测（R177-A6）。
 *
 * 4 状态 × 9 按钮 = 36 决策点全覆盖；任一回归立即在矩阵格内点亮。
 */
import { describe, expect, it } from 'vitest';

import {
  ROW_BUTTON_LABEL,
  ROW_BUTTON_ORDER,
  decideRowButton,
  type GateDetailRowButton,
  type GateDetailStatus,
} from './button-policy';

const STATUSES: readonly GateDetailStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'ABSTAINED_TIMEOUT'];

// 期望矩阵：true = 可见，false = 隐藏
const EXPECTED: Readonly<Record<GateDetailStatus, Readonly<Record<GateDetailRowButton, boolean>>>> = {
  PENDING: {
    signApprove: true,
    signReject: true,
    reopen: false,
    extend: true,
    arbitrateApprove: true,
    arbitrateReject: true,
    finalRulingApprove: true,
    finalRulingReject: true,
    refresh: true,
  },
  APPROVED: {
    signApprove: false,
    signReject: false,
    reopen: false,
    extend: false,
    arbitrateApprove: false,
    arbitrateReject: false,
    finalRulingApprove: false,
    finalRulingReject: false,
    refresh: true,
  },
  REJECTED: {
    signApprove: false,
    signReject: false,
    reopen: true,
    extend: false,
    arbitrateApprove: false,
    arbitrateReject: false,
    finalRulingApprove: false,
    finalRulingReject: false,
    refresh: true,
  },
  ABSTAINED_TIMEOUT: {
    signApprove: false,
    signReject: false,
    reopen: false,
    extend: false,
    arbitrateApprove: false,
    arbitrateReject: false,
    finalRulingApprove: false,
    finalRulingReject: false,
    refresh: true,
  },
};

describe('R177-A6 Gate 详情页 button-policy 决策矩阵', () => {
  it('行按钮顺序与显示名一致（9 个按钮，无遗漏）', () => {
    expect(ROW_BUTTON_ORDER).toHaveLength(9);
    expect(Object.keys(ROW_BUTTON_LABEL)).toHaveLength(9);
    for (const b of ROW_BUTTON_ORDER) {
      expect(ROW_BUTTON_LABEL[b]).toBeTruthy();
    }
  });

  for (const status of STATUSES) {
    it(`${status} 状态：每个按钮的可见性符合期望矩阵`, () => {
      for (const button of ROW_BUTTON_ORDER) {
        const decision = decideRowButton(button, { status });
        expect(decision.visible).toBe(EXPECTED[status][button]);
        expect(decision.hidden).toBe(!EXPECTED[status][button]);
        if (decision.hidden) {
          expect(decision.reason).toBeTruthy();
        }
      }
    });
  }

  it('PENDING 可见按钮数 = 8（sign/extend/arbitrate/finalRuling/refresh），reopen 隐藏', () => {
    const visible = ROW_BUTTON_ORDER.filter((b) => decideRowButton(b, { status: 'PENDING' }).visible);
    expect(visible).toHaveLength(8);
    expect(visible).not.toContain('reopen');
  });

  it('REJECTED 可见按钮数 = 2（reopen/refresh）', () => {
    const visible = ROW_BUTTON_ORDER.filter((b) => decideRowButton(b, { status: 'REJECTED' }).visible);
    expect(visible).toHaveLength(2);
    expect(visible).toEqual(['reopen', 'refresh']);
  });

  it('APPROVED 可见按钮数 = 1（仅 refresh）', () => {
    const visible = ROW_BUTTON_ORDER.filter((b) => decideRowButton(b, { status: 'APPROVED' }).visible);
    expect(visible).toEqual(['refresh']);
  });

  it('ABSTAINED_TIMEOUT 可见按钮数 = 1（仅 refresh）', () => {
    const visible = ROW_BUTTON_ORDER.filter((b) => decideRowButton(b, { status: 'ABSTAINED_TIMEOUT' }).visible);
    expect(visible).toEqual(['refresh']);
  });

  it('决策对象是冻结的（防止运行时被覆盖）', () => {
    const decision = decideRowButton('signApprove', { status: 'PENDING' });
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('行顺序与显示名一一对应（9 项配对无缺失无多）', () => {
    const orderKeys = ROW_BUTTON_ORDER.slice().sort();
    const labelKeys = Object.keys(ROW_BUTTON_LABEL).slice().sort();
    expect(orderKeys).toEqual(labelKeys);
  });
});
