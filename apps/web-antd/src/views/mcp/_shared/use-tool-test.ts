/**
 * 连接测试执行 composable（Track E1）。
 *
 * <p>runner 注入（调用方传 `mcpToolTest`），本文件同样零 api import——测试可注入
 * stub 直测并发护栏（running 期间重复调用直接忽略，对齐约束 #5 guard-on-status
 * 的「状态未变不再触发」口径）。计时器 now 注入，单测断言耗时确定性。
 */
import type { Ref } from 'vue';

import type { ToolTestResponse, ToolTestViewState } from './tool-test';

import { computed, ref } from 'vue';

import {
  failedToolTestState,
  idleToolTestState,
  normalizeToolTestResult,
} from './tool-test';

export type ToolTestRunner = (toolId: number) => Promise<ToolTestResponse>;

export interface UseToolTestResult {
  hasResult: Ref<boolean>;
  run: (toolId: number) => Promise<void>;
  running: Ref<boolean>;
  state: Ref<ToolTestViewState>;
}

export function useToolTest(
  runner: ToolTestRunner,
  now: () => number = () => Date.now(),
): UseToolTestResult {
  const state = ref<ToolTestViewState>(idleToolTestState());
  const running = ref(false);
  const hasResult = computed(() => state.value.testedAt !== null);

  async function run(toolId: number): Promise<void> {
    if (running.value) return;
    running.value = true;
    state.value = { ...idleToolTestState(), phase: 'executing' };
    const startedAt = now();
    const durationOf = () => Math.max(0, now() - startedAt);
    const testedAt = new Date(startedAt).toISOString();
    try {
      const response = await runner(toolId);
      state.value = normalizeToolTestResult(response, durationOf(), testedAt);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      state.value = failedToolTestState(
        `连接测试请求失败：${detail}`,
        durationOf(),
        testedAt,
      );
    } finally {
      running.value = false;
    }
  }

  return { hasResult, run, running, state };
}
