/**
 * 蜂群进度卡组件 + 单轨红线扫描（AG-UI 单轨，2026-09-29）。
 *
 * 覆盖：swarm-progress.vue 挂载渲染（汇总计数 / 任务名 / 状态 / 耗时 / 产出 / 失败 / 步骤 / 空态）+
 * 源码红线扫描（颜色三级机制走 --ipd-* 令牌、宿主复用 agentId 走 subscribe 订阅不进 card-registry、
 * 零 TODO）。fixture 帧形状=后端 AgUiEvents 工厂 wire（前后端锁同一契约）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { foldSwarmEvents, type SwarmEvent } from './swarm-progress';
import SwarmProgressCard from './swarm-progress.vue';

/** 两子智能体样本：sa-1 走完（含步骤+产出+耗时），sa-2 失败。wire 形状=后端工厂。 */
const EVENTS: SwarmEvent[] = [
  { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-1', name: '痛点访谈员', description: '负责 JTBD 访谈', timestamp: 1000 },
  { type: 'STEP_STARTED', stepName: '准备提纲', subagentRunId: 'sa-1' },
  { type: 'STEP_FINISHED', stepName: '准备提纲', subagentRunId: 'sa-1' },
  { type: 'SUBAGENT_FINISHED', subagentRunId: 'sa-1', result: '访谈纪要已生成', timestamp: 3000 },
  { type: 'SUBAGENT_STARTED', subagentRunId: 'sa-2', name: '竞品分析员' },
  { type: 'SUBAGENT_ERROR', subagentRunId: 'sa-2', message: '超时', code: '50002' },
];

describe('swarm-progress.vue 渲染', () => {
  it('挂载渲染：汇总计数 + 任务名/状态/耗时/产出/失败/步骤', () => {
    const wrapper = mount(SwarmProgressCard, { props: { vm: foldSwarmEvents(EVENTS) } });
    expect(wrapper.find('[data-testid="ipd-swarm-progress"]').exists()).toBe(true);

    const counts = wrapper.get('[data-testid="ipd-swarm-counts"]').text();
    expect(counts).toContain('共 2');
    expect(counts).toContain('已完成 1');
    expect(counts).toContain('失败 1');

    expect(wrapper.get('[data-testid="ipd-swarm-task-sa-1"]').text()).toContain('痛点访谈员');
    expect(wrapper.get('[data-testid="ipd-swarm-task-sa-2"]').text()).toContain('竞品分析员');

    const text = wrapper.text();
    expect(text).toContain('负责 JTBD 访谈'); // 描述
    expect(text).toContain('访谈纪要已生成'); // 产出摘要（面板 force-render）
    expect(text).toContain('准备提纲'); // 步骤节拍
    expect(text).toContain('超时（50002）'); // 失败信息
    expect(text).toContain('2.0s'); // sa-1 耗时（3000-1000）
    expect(wrapper.get('[data-testid="ipd-swarm-output-sa-1"]').text()).toContain('访谈纪要已生成');
  });

  it('空 VM → Empty 空态、无任务面板（优雅降级）', () => {
    const wrapper = mount(SwarmProgressCard, { props: { vm: foldSwarmEvents([]) } });
    expect(wrapper.find('[data-testid="ipd-swarm-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('暂无子智能体任务');
    expect(wrapper.find('[data-testid="ipd-swarm-task-sa-1"]').exists()).toBe(false);
  });

  it('BR-AI-04 / C08 口径常驻（纯展示不落库、内容未审提示）', () => {
    const wrapper = mount(SwarmProgressCard, { props: { vm: foldSwarmEvents(EVENTS) } });
    expect(wrapper.text()).toContain('C08');
    expect(wrapper.text()).toContain('BR-AI-04');
  });
});

describe('源码红线扫描（颜色三级机制 / 单轨红线 #2 / 零 TODO）', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (relative: string) => readFileSync(resolve(here, relative), 'utf8');

  it('样式块零硬编码色值零 :root，仅走 --ipd-* 令牌（颜色三级机制）', () => {
    const source = read('./swarm-progress.vue');
    const styleBlocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');
    expect(styleBlocks.length).toBeGreaterThan(0);
    for (const css of styleBlocks) {
      expect(css, '零 :root').not.toMatch(/:root\b/);
      expect(css, '零硬编码 hex 色值').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, '走 --ipd-* 令牌').toContain('var(--ipd-');
    }
  });

  it('单轨红线 #2：宿主复用 agentId ipd_copilot + subscribe 订阅，不进 card-registry', () => {
    const host = read('./swarm-progress-host.ts');
    expect(host).toContain("'ipd_copilot'");
    expect(host).toMatch(/\buseAgent\b/);
    expect(host).toMatch(/\.subscribe\(/);
    // 非平行卡片体系：不引 card-registry / useRenderTool（活动订阅是 CopilotKit 一等子系统）
    expect(host).not.toMatch(/card-registry|useRenderTool|registerCard/);
  });

  it('词表同源：宿主订阅的 SUBAGENT_/STEP_ 回调名与官方 AgentSubscriber 一致（禁发明）', () => {
    const host = read('./swarm-progress-host.ts');
    for (const cb of [
      'onSubagentStartedEvent',
      'onSubagentFinishedEvent',
      'onSubagentErrorEvent',
      'onStepStartedEvent',
      'onStepFinishedEvent',
    ]) {
      expect(host, cb).toContain(cb);
    }
  });

  it('零 TODO/FIXME 残留（新增接线文件）', () => {
    for (const file of ['./swarm-progress.ts', './swarm-progress.vue', './swarm-progress-host.ts']) {
      expect(read(file), file).not.toMatch(/\bTODO\b|\bFIXME\b/);
    }
  });
});
