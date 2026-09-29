import { describe, expect, it } from 'vitest';

import {
  TOOL_TEST_PAYLOAD_ROW_LIMIT,
  failedToolTestState,
  formatDuration,
  idleToolTestState,
  normalizeToolTestResult,
  payloadToRows,
} from './tool-test';

describe('payloadToRows', () => {
  it('对象逐键展开并保持插入顺序', () => {
    expect(
      payloadToRows({ tools: 3, name: 'fs', ok: true, missing: null }),
    ).toEqual([
      { key: 'tools', value: '3' },
      { key: 'name', value: 'fs' },
      { key: 'ok', value: 'true' },
      { key: 'missing', value: '' },
    ]);
  });

  it('数组/标量折叠为单行 result', () => {
    expect(payloadToRows([1, 2])).toEqual([
      { key: 'result', value: '[1,2]' },
    ]);
    expect(payloadToRows('hello')).toEqual([
      { key: 'result', value: 'hello' },
    ]);
  });

  it('null/undefined 返回空数组', () => {
    expect(payloadToRows(null)).toEqual([]);
    expect(payloadToRows(undefined)).toEqual([]);
  });

  it('超出上限截断', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < TOOL_TEST_PAYLOAD_ROW_LIMIT + 10; i += 1) {
      big[`k${i}`] = `v${i}`;
    }
    expect(payloadToRows(big)).toHaveLength(TOOL_TEST_PAYLOAD_ROW_LIMIT);
  });
});

describe('normalizeToolTestResult', () => {
  it('成功且 message 为空时补诚实成功文案', () => {
    const state = normalizeToolTestResult(
      { data: { tools: 2 }, message: '', success: true },
      42,
      '2026-09-28T00:00:00.000Z',
    );
    expect(state.phase).toBe('complete');
    expect(state.success).toBe(true);
    expect(state.message).toBe('连接测试通过');
    expect(state.durationMs).toBe(42);
    expect(state.payloadRows).toEqual([{ key: 'tools', value: '2' }]);
    expect(state.testedAt).toBe('2026-09-28T00:00:00.000Z');
  });

  it('失败且 message 为空时补诚实失败文案；有 message 原样保留', () => {
    expect(
      normalizeToolTestResult(
        { success: false },
        7,
        '2026-09-28T00:00:00.000Z',
      ).message,
    ).toBe('连接测试失败');
    expect(
      normalizeToolTestResult(
        { message: 'command not found', success: false },
        7,
        '2026-09-28T00:00:00.000Z',
      ).message,
    ).toBe('command not found');
  });
});

describe('状态构造器', () => {
  it('idle 初始态三键为空、phase=inProgress', () => {
    const idle = idleToolTestState();
    expect(idle.phase).toBe('inProgress');
    expect(idle.testedAt).toBeNull();
    expect(idle.success).toBeNull();
    expect(idle.payloadRows).toEqual([]);
  });

  it('failedToolTestState 恒 success=false 且 phase=complete', () => {
    const failed = failedToolTestState(
      '连接测试请求失败：网络异常',
      5,
      '2026-09-28T00:00:00.000Z',
    );
    expect(failed.success).toBe(false);
    expect(failed.phase).toBe('complete');
    expect(failed.payloadRows).toEqual([]);
  });

  it('formatDuration：null 输出长横线', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(128)).toBe('128 ms');
  });
});
