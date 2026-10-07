/**
 * Gate 评审详情页 button-policy 决策矩阵单测（R177-A6）。
 *
 * 4 状态 × 9 按钮 = 36 决策点全覆盖；任一回归立即在矩阵格内点亮。
 *
 * 2026-10-07 P0 修复（双 PM 功能完善度评估）：仲裁 / 终裁的可见状态由 PENDING 改为
 * REJECTED——后端 GateReviewService.requireArbitratable（arbitrate / finalRuling 共用前置）
 * 只在 Gate 状态 = REJECTED 且当轮双 PM 意见分歧时受理。旧断言把「PENDING 可见」固化了，
 * 属错误断言，随修复一起纠正（不是放宽，而是对齐后端真实受理状态）。
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
    // 后端只在 REJECTED 受理仲裁/终裁（requireArbitratable 前置 STATUS_REJECTED）
    arbitrateApprove: false,
    arbitrateReject: false,
    finalRulingApprove: false,
    finalRulingReject: false,
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
    // 被驳回 = 仲裁/终裁流程的起点（分歧自动开仲裁 openArbitration，两组不一致升级超管终裁）
    arbitrateApprove: true,
    arbitrateReject: true,
    finalRulingApprove: true,
    finalRulingReject: true,
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

  it('PENDING 可见按钮数 = 4（sign/extend/refresh），reopen 与仲裁/终裁隐藏', () => {
    const visible = ROW_BUTTON_ORDER.filter((b) => decideRowButton(b, { status: 'PENDING' }).visible);
    expect(visible).toHaveLength(4);
    expect(visible).toEqual(['signApprove', 'signReject', 'extend', 'refresh']);
    expect(visible).not.toContain('reopen');
    // PENDING 不是仲裁/终裁的受理状态（后端 requireArbitratable 要求 REJECTED）
    expect(visible).not.toContain('arbitrateApprove');
    expect(visible).not.toContain('finalRulingApprove');
  });

  it('REJECTED 可见按钮数 = 6（reopen/仲裁/终裁/refresh）', () => {
    const visible = ROW_BUTTON_ORDER.filter((b) => decideRowButton(b, { status: 'REJECTED' }).visible);
    expect(visible).toHaveLength(6);
    expect(visible).toEqual([
      'reopen',
      'arbitrateApprove',
      'arbitrateReject',
      'finalRulingApprove',
      'finalRulingReject',
      'refresh',
    ]);
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
