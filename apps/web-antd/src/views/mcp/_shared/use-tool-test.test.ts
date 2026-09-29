/**
 * Track E1：连接测试三态流转契约测试（inProgress → executing → complete）。
 *
 * <p>断言锁契约：
 * - 三态流转与 CardToolStatus 同构词汇，不发明第四态；
 * - running 期间重复调用直接忽略（guard-on-status：状态未变不再触发）；
 * - 成功/失败/请求异常均收敛到 complete 终态（异常不断面板）；
 * - 耗时由注入时钟确定（now 注入，无真实计时 flake）。
 */
import { describe, expect, it, vi } from 'vitest';

import type { ToolTestResponse } from './tool-test';

import { useToolTest } from './use-tool-test';

interface Deferred {
  promise: Promise<ToolTestResponse>;
  resolve: (value: ToolTestResponse) => void;
}

function deferred(): Deferred {
  let resolve!: (value: ToolTestResponse) => void;
  const promise = new Promise<ToolTestResponse>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('use-tool-test 三态流转', () => {
  it('inProgress → executing → complete（成功终态 + 耗时确定性）', async () => {
    const gate = deferred();
    const runner = vi.fn(() => gate.promise);
    let clock = 1_000;
    const { hasResult, run, running, state } = useToolTest(
      runner,
      () => clock,
    );

    // 初始：待测试（inProgress）
    expect(state.value.phase).toBe('inProgress');
    expect(state.value.testedAt).toBeNull();
    expect(hasResult.value).toBe(false);

    const flight = run(7);
    // 请求飞行中（executing）
    expect(state.value.phase).toBe('executing');
    expect(running.value).toBe(true);

    // 并发护栏：running 期间重复调用被忽略（runner 只被调用一次）
    void run(8);
    expect(runner).toHaveBeenCalledTimes(1);

    clock = 1_042;
    gate.resolve({ data: { tools: 2 }, message: 'ok', success: true });
    await flight;

    // 结果已达（complete）
    expect(state.value.phase).toBe('complete');
    expect(state.value.success).toBe(true);
    expect(state.value.durationMs).toBe(42);
    expect(hasResult.value).toBe(true);
    expect(running.value).toBe(false);
    expect(state.value.payloadRows).toEqual([{ key: 'tools', value: '2' }]);
  });

  it('后端失败结果 → complete + success=false（不发明第四态）', async () => {
    const runner = vi.fn(async () => ({
      message: 'command not found',
      success: false,
    }));
    const { run, state } = useToolTest(runner, () => 10);
    await run(1);
    expect(state.value.phase).toBe('complete');
    expect(state.value.success).toBe(false);
    expect(state.value.message).toBe('command not found');
  });

  it('请求异常 → complete + success=false 诚实失败文案（不断面板）', async () => {
    const runner = vi.fn(async () => {
      throw new Error('network down');
    });
    const { run, state } = useToolTest(runner, () => 10);
    await run(1);
    expect(state.value.phase).toBe('complete');
    expect(state.value.success).toBe(false);
    expect(state.value.message).toContain('连接测试请求失败');
    expect(state.value.message).toContain('network down');
    expect(state.value.payloadRows).toEqual([]);
  });
});
