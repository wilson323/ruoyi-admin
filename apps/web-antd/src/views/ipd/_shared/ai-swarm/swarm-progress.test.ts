/**
 * 蜂群进度纯函数测试（AG-UI 单轨，2026-09-29）：SUBAGENT_* 与 STEP_* 帧 → SwarmProgressVm。
 *
 * fixture 帧形状与后端 AgUiEvents.subagentStarted/... 工厂产出逐一对齐（AgUiEventsSwarmTest 已钉死
 * 后端 wire），前后端锁同一契约（SSOT：docs/copilotkit单轨融合契约-20260928.md）。
 * IPD 目录下的测试文件已被 vitest 白名单纳入（vitest.ipd.config.mts，配置无需改动）。
 */
import { describe, expect, it } from 'vitest';

import {
  foldSwarmEvents,
  formatDuration,
  swarmStatusMeta,
  MAIN_FLOW_NAME,
  MAX_SUMMARY_CHARS,
  type SwarmEvent,
} from './swarm-progress';

describe('foldSwarmEvents：蜂群事件折叠', () => {
  it('空事件 → 空 VM（优雅空态，无生产者时 tasks 为空、计数全 0）', () => {
    const vm = foldSwarmEvents([]);
    expect(vm.tasks).toEqual([]);
    expect(vm).toMatchObject({ total: 0, running: 0, finished: 0, errored: 0 });
  });

  it('SUBAGENT_STARTED → 单任务 running（name/description 映射，wire 形状=后端工厂）', () => {
    const events: SwarmEvent[] = [
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '痛点访谈员', description: '负责 JTBD 访谈' },
    ];
    const vm = foldSwarmEvents(events);
    expect(vm.tasks).toHaveLength(1);
    expect(vm.tasks[0]).toMatchObject({
      subagentRunId: 'sa-1', name: '痛点访谈员', description: '负责 JTBD 访谈', status: 'running',
    });
    expect(vm).toMatchObject({ total: 1, running: 1, finished: 0, errored: 0 });
  });

  it('STARTED + FINISHED → finished + 产出摘要；计数流转', () => {
    const events: SwarmEvent[] = [
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '访谈员' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1', result: '访谈纪要已生成', outcome: { type: 'success' } },
    ];
    const vm = foldSwarmEvents(events);
    expect(vm.tasks[0]).toMatchObject({ status: 'finished', outputSummary: '访谈纪要已生成' });
    expect(vm).toMatchObject({ total: 1, running: 0, finished: 1, errored: 0 });
  });

  it('STARTED + ERROR → error + 失败信息（message 附 code）', () => {
    const events: SwarmEvent[] = [
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '访谈员' },
      { type: 'SUBAGENT_ERROR', subagentRunId: 'sa-1', message: '子智能体超时', code: '50002' },
    ];
    const vm = foldSwarmEvents(events);
    expect(vm.tasks[0]).toMatchObject({ status: 'error', errorMessage: '子智能体超时（50002）' });
    expect(vm).toMatchObject({ errored: 1, running: 0, finished: 0 });
  });

  it('ERROR 无 code → 仅 message（不产空括号）', () => {
    const vm = foldSwarmEvents([
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: 'x' },
      { type: 'SUBAGENT_ERROR', subagentRunId: 'sa-1', message: '崩溃' },
    ]);
    expect(vm.tasks[0]!.errorMessage).toBe('崩溃');
  });

  it('多子智能体并行 → 各任务独立状态 + 汇总计数', () => {
    const events: SwarmEvent[] = [
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '访谈员' },
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-2', name: '竞品分析员' },
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-3', name: '数据员' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1', result: 'done' },
      { type: 'SUBAGENT_ERROR', subagentRunId: 'sa-2', message: 'timeout' },
    ];
    const vm = foldSwarmEvents(events);
    expect(vm.tasks.map((t) => t.subagentRunId)).toEqual(['sa-1', 'sa-2', 'sa-3']);
    expect(vm).toMatchObject({ total: 3, finished: 1, errored: 1, running: 1 });
  });

  it('STEP_* 带 subagentRunId → 归属对应任务；STARTED→FINISHED 步骤状态流转', () => {
    const events: SwarmEvent[] = [
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '访谈员' },
      { type: 'STEP_STARTED', stepName: '准备提纲', subagentRunId: 'sa-1' },
      { type: 'STEP_STARTED', stepName: '执行访谈', subagentRunId: 'sa-1' },
      { type: 'STEP_FINISHED', stepName: '准备提纲', subagentRunId: 'sa-1' },
    ];
    const vm = foldSwarmEvents(events);
    expect(vm.tasks).toHaveLength(1);
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

  it('耗时：started/finished 均带 timestamp → durationMs 计算；缺 timestamp → null', () => {
    const withTs = foldSwarmEvents([
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: 'x', timestamp: 1000 },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1', timestamp: 2500 },
    ]);
    expect(withTs.tasks[0]!.durationMs).toBe(1500);
    const noTs = foldSwarmEvents([
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: 'x' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1' },
    ]);
    expect(noTs.tasks[0]!.durationMs).toBeNull();
  });

  it('result 为对象 → JSON 摘要；超长截断至 MAX_SUMMARY_CHARS + 省略号', () => {
    const obj = foldSwarmEvents([
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: 'x' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1', result: { ok: true, n: 2 } },
    ]);
    expect(obj.tasks[0]!.outputSummary).toBe('{"ok":true,"n":2}');
    const long = foldSwarmEvents([
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-2', name: 'x' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-2', result: 'y'.repeat(MAX_SUMMARY_CHARS + 50) },
    ]);
    expect(long.tasks[0]!.outputSummary).toHaveLength(MAX_SUMMARY_CHARS + 1);
    expect(long.tasks[0]!.outputSummary.endsWith('…')).toBe(true);
  });

  it('非法帧（非对象/未知 type/缺字段）不崩、被跳过', () => {
    const bad = [
      null,
      { type: 'UNKNOWN_EVENT' },
      { type: 'SUBAGENT_STARTED' }, // 缺 subagentRunId/name → runId='' 主流程占位，不崩
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1' }, // 无对应 STARTED → 惰性建任务
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
