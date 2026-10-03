/**
 * 蜂群进度纯函数测试（AG-UI 单轨，2026-09-29；2026-10-02 对齐官方 2.0.3）：STEP_* 帧 → SwarmProgressVm。
 *
 * 官方 2.0.3 词表无 SUBAGENT_* wire 类型（后端从未产出，分支已删）——本组只锁官方 STEP_*
 * 折叠行为（SSOT：docs/copilotkit单轨融合契约-20260928.md）。
 * IPD 目录下的测试文件已被 vitest 白名单纳入（vitest.ipd.config.mts，配置无需改动）。
 */
import { describe, expect, it } from 'vitest';

import {
  foldSwarmEvents,
  formatDuration,
  swarmStatusMeta,
  MAIN_FLOW_NAME,
  type SwarmEvent,
} from './swarm-progress';

describe('foldSwarmEvents：蜂群事件折叠', () => {
  it('空事件 → 空 VM（优雅空态，无生产者时 tasks 为空、计数全 0）', () => {
    const vm = foldSwarmEvents([]);
    expect(vm.tasks).toEqual([]);
    expect(vm).toMatchObject({ total: 0, running: 0, finished: 0, errored: 0 });
  });

  it('SUBAGENT_* 帧（官方无此类型）→ 不建任务不崩（防御性跳过，default 分支）', () => {
    const vm = foldSwarmEvents([
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '访谈员' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1', result: 'x' },
      { type: 'SUBAGENT_ERROR', subagentRunId: 'sa-1', message: 'boom' },
    ]);
    expect(vm.tasks).toEqual([]);
    expect(vm).toMatchObject({ total: 0, running: 0, finished: 0, errored: 0 });
  });

  it('STEP_* 带 subagentRunId → 惰性建任务归属；STARTED→FINISHED 步骤状态流转', () => {
    const events: SwarmEvent[] = [
      { type: 'STEP_STARTED', stepName: '准备提纲', subagentRunId: 'sa-1' },
      { type: 'STEP_STARTED', stepName: '执行访谈', subagentRunId: 'sa-1' },
      { type: 'STEP_FINISHED', stepName: '准备提纲', subagentRunId: 'sa-1' },
    ];
    const vm = foldSwarmEvents(events);
    expect(vm.tasks).toHaveLength(1);
    expect(vm.tasks[0]).toMatchObject({ subagentRunId: 'sa-1', name: 'sa-1', status: 'running' });
    expect(vm.tasks[0]!.steps).toEqual([
      { stepName: '准备提纲', status: 'finished' },
      { stepName: '执行访谈', status: 'running' },
    ]);
  });

  it('STEP_* 无 subagentRunId → 归入保留「主流程」任务（单智能体节拍亦可展示）', () => {
    const vm = foldSwarmEvents([
      { type: 'STEP_STARTED', stepName: '检索知识库' },
      { type: 'STEP_FINISHED', stepName: '检索知识库' },
    ]);
    expect(vm.tasks).toHaveLength(1);
    expect(vm.tasks[0]).toMatchObject({ subagentRunId: '', name: MAIN_FLOW_NAME });
    expect(vm.tasks[0]!.steps).toEqual([{ stepName: '检索知识库', status: 'finished' }]);
  });

  it('STEP_* 带未知 subagentRunId（无 STARTED）→ 惰性建任务，步骤不丢失', () => {
    const vm = foldSwarmEvents([{ type: 'STEP_STARTED', stepName: '匿名步骤', subagentRunId: 'sa-x' }]);
    expect(vm.tasks).toHaveLength(1);
    expect(vm.tasks[0]).toMatchObject({ subagentRunId: 'sa-x', name: 'sa-x' });
    expect(vm.tasks[0]!.steps).toEqual([{ stepName: '匿名步骤', status: 'running' }]);
  });

  it('多任务并行（STEP_* 各自 subagentRunId）→ 各任务独立步骤 + 汇总计数', () => {
    const vm = foldSwarmEvents([
      { type: 'STEP_STARTED', stepName: '访谈', subagentRunId: 'sa-1' },
      { type: 'STEP_STARTED', stepName: '分析', subagentRunId: 'sa-2' },
      { type: 'STEP_STARTED', stepName: '提纲', subagentRunId: 'sa-1' },
    ]);
    expect(vm.tasks.map((t) => t.subagentRunId)).toEqual(['sa-1', 'sa-2']);
    expect(vm.tasks[0]!.steps).toHaveLength(2);
    expect(vm.tasks[1]!.steps).toHaveLength(1);
    expect(vm).toMatchObject({ total: 2, running: 2, finished: 0, errored: 0 });
  });

  it('非法帧（非对象/未知 type/缺字段）不崩、被跳过', () => {
    const bad = [
      null,
      { type: 'UNKNOWN_EVENT' },
      { type: 'STEP_STARTED' }, // 缺 stepName → 空名步骤占位，不崩
      { type: 'STEP_FINISHED', stepName: '检索' }, // 无对应 STARTED → 补 finished 步骤
    ] as unknown as SwarmEvent[];
    expect(() => foldSwarmEvents(bad)).not.toThrow();
    const vm = foldSwarmEvents(bad);
    expect(vm.tasks.every((t) => typeof t.status === 'string')).toBe(true);
  });
});

describe('swarmStatusMeta / formatDuration 视觉映射', () => {
  it('3 态 → Ant Tag preset tone（零新色值）', () => {
    expect(swarmStatusMeta('running')).toEqual({ label: '执行中', tone: 'processing' });
    expect(swarmStatusMeta('finished')).toEqual({ label: '已完成', tone: 'success' });
    expect(swarmStatusMeta('error')).toEqual({ label: '失败', tone: 'error' });
  });

  it('formatDuration：ms/s/占位分支', () => {
    expect(formatDuration(350)).toBe('350ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});
