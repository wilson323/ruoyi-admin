/**
 * button-policy 决策矩阵回归保护：R175-A 接入评审要素全生命周期 9 按钮，
 * 防止后续重构无意中改写决策矩阵导致前端请求被后端拒。
 *
 * 决策矩阵（4 状态 × 9 按钮 = 36 决策点）：
 *
 * | 状态 \\ 按钮     | edit | disable | enable | publish | archive | copy | duplicate | revert | restore |
 * | DRAFT(enabled=0) |  ✓  |   ✗    |   ✗   |   ✓   |   ✓    |  ✓  |    ✓    |   ✓  |    ✗   |
 * | PUBLISHED(on)    |  ✓  |   ✓    |   ✗   |   ✗   |   ✓    |  ✓  |    ✓    |   ✓  |    ✗   |
 * | PUBLISHED(off)   |  ✗  |   ✗    |   ✓   |   ✗   |   ✓    |  ✓  |    ✓    |   ✓  |    ✗   |
 * | ARCHIVED         |  ✗  |   ✗    |   ✗   |   ✗   |   ✗    |  ✓  |    ✓    |   ✗  |    ✓   |
 */
import { describe, expect, it } from 'vitest';

import {
  ROW_BUTTON_LABEL,
  ROW_BUTTON_ORDER,
  decideRowButton,
  type GateElementButtonState,
  type GateElementRowButton,
} from './button-policy';

const STATES: readonly GateElementButtonState[] = Object.freeze([
  { lifecycle: 'draft', enabled: '0' },
  { lifecycle: 'published', enabled: '1' },
  { lifecycle: 'published', enabled: '0' },
  { lifecycle: 'archived', enabled: '0' },
]);

/** 期望决策矩阵（true=visible, false=hidden）。 */
const EXPECTED: Readonly<Record<GateElementRowButton, readonly [boolean, boolean, boolean, boolean]>> = Object.freeze({
  edit: [true, true, false, false],
  disable: [false, true, false, false],
  enable: [false, false, true, false],
  publish: [true, false, false, false],
  archive: [true, true, true, false],
  copy: [true, true, true, true],
  duplicate: [true, true, true, true],
  revert: [true, true, true, false],
  restore: [false, false, false, true],
});

describe('Gate 评审要素 button-policy 决策矩阵', () => {
  it('ROW_BUTTON_ORDER = 9 个按钮（与 R174-P0.8 规范一致）', () => {
    expect(ROW_BUTTON_ORDER.length).toBe(9);
    // 关键按钮必含：edit/disable/enable/publish/archive/copy/duplicate/revert/restore
    expect(ROW_BUTTON_ORDER).toEqual([
      'edit',
      'enable',
      'disable',
      'publish',
      'archive',
      'copy',
      'duplicate',
      'revert',
      'restore',
    ]);
  });

  it('STATES = 4 状态（DRAFT / PUBLISHED-on / PUBLISHED-off / ARCHIVED）', () => {
    expect(STATES.length).toBe(4);
  });

  it('4 状态 × 9 按钮 = 36 决策点矩阵（防止矩阵漂移）', () => {
    expect(ROW_BUTTON_ORDER.length * STATES.length).toBe(36);
    for (const [idx, state] of STATES.entries()) {
      for (const button of ROW_BUTTON_ORDER) {
        const decision = decideRowButton(button, state);
        const expected = EXPECTED[button][idx];
        expect(decision.visible, `${state.lifecycle}(enabled=${state.enabled}) + ${button}`).toBe(expected);
        // 隐藏必有 reason；显示则无 reason
        if (!decision.visible) {
          expect(decision.hidden).toBe(true);
          expect(decision.reason, `${button} 隐藏原因不可为空`).toBeTypeOf('string');
          expect(decision.reason!.length).toBeGreaterThan(0);
        } else {
          expect(decision.hidden).toBe(false);
        }
      }
    }
  });

  it('DRAFT(enabled=0)：edit / publish / archive / copy / duplicate / revert 可见', () => {
    const state: GateElementButtonState = { lifecycle: 'draft', enabled: '0' };
    expect(decideRowButton('edit', state).visible).toBe(true);
    expect(decideRowButton('publish', state).visible).toBe(true);
    expect(decideRowButton('archive', state).visible).toBe(true);
    expect(decideRowButton('copy', state).visible).toBe(true);
    expect(decideRowButton('duplicate', state).visible).toBe(true);
    expect(decideRowButton('revert', state).visible).toBe(true);
    expect(decideRowButton('disable', state).visible).toBe(false);
    expect(decideRowButton('enable', state).visible).toBe(false);
    expect(decideRowButton('restore', state).visible).toBe(false);
  });

  it('PUBLISHED(enabled=1)：edit / disable / archive / copy / duplicate / revert 可见', () => {
    const state: GateElementButtonState = { lifecycle: 'published', enabled: '1' };
    expect(decideRowButton('edit', state).visible).toBe(true);
    expect(decideRowButton('disable', state).visible).toBe(true);
    expect(decideRowButton('archive', state).visible).toBe(true);
    expect(decideRowButton('copy', state).visible).toBe(true);
    expect(decideRowButton('duplicate', state).visible).toBe(true);
    expect(decideRowButton('revert', state).visible).toBe(true);
    expect(decideRowButton('enable', state).visible).toBe(false);
    expect(decideRowButton('publish', state).visible).toBe(false);
    expect(decideRowButton('restore', state).visible).toBe(false);
  });

  it('PUBLISHED(enabled=0)：enable / archive / copy / duplicate / revert 可见', () => {
    const state: GateElementButtonState = { lifecycle: 'published', enabled: '0' };
    expect(decideRowButton('enable', state).visible).toBe(true);
    expect(decideRowButton('archive', state).visible).toBe(true);
    expect(decideRowButton('copy', state).visible).toBe(true);
    expect(decideRowButton('duplicate', state).visible).toBe(true);
    expect(decideRowButton('revert', state).visible).toBe(true);
    expect(decideRowButton('edit', state).visible).toBe(false);
    expect(decideRowButton('disable', state).visible).toBe(false);
    expect(decideRowButton('publish', state).visible).toBe(false);
    expect(decideRowButton('restore', state).visible).toBe(false);
  });

  it('ARCHIVED：copy / duplicate / restore 可见', () => {
    const state: GateElementButtonState = { lifecycle: 'archived', enabled: '0' };
    expect(decideRowButton('copy', state).visible).toBe(true);
    expect(decideRowButton('duplicate', state).visible).toBe(true);
    expect(decideRowButton('restore', state).visible).toBe(true);
    expect(decideRowButton('edit', state).visible).toBe(false);
    expect(decideRowButton('disable', state).visible).toBe(false);
    expect(decideRowButton('enable', state).visible).toBe(false);
    expect(decideRowButton('publish', state).visible).toBe(false);
    expect(decideRowButton('archive', state).visible).toBe(false);
    expect(decideRowButton('revert', state).visible).toBe(false);
  });

  it('ROW_BUTTON_LABEL 9 项与 ROW_BUTTON_ORDER 一一对应', () => {
    for (const button of ROW_BUTTON_ORDER) {
      expect(ROW_BUTTON_LABEL[button]).toBeTruthy();
      expect(ROW_BUTTON_LABEL[button].length).toBeGreaterThan(0);
    }
  });
});