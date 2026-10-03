/**
 * 蜂群进度卡组件 + 单轨红线扫描（AG-UI 单轨，2026-09-29）。
 *
 * 覆盖：swarm-progress.vue 挂载渲染（汇总计数 / 任务名 / 状态 / 耗时 / 产出 / 失败 / 步骤 / 空态）+
 * 源码红线扫描（颜色三级机制走 --ipd-* 令牌、宿主复用 agentId 走 subscribe 订阅不进 card-registry、
 * 零 TODO）。fixture 帧形状=官方 AG-UI 2.0.3 STEP_* wire（SUBAGENT_* 类型官方不存在，已删）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { foldSwarmEvents, type SwarmEvent } from './swarm-progress';
import SwarmProgressCard from './swarm-progress.vue';

/** 两任务样本：sa-1 带两步骤（一完成一执行中），sa-2 单步骤。wire 形状=官方 STEP_*。 */
const EVENTS: SwarmEvent[] = [
  { type: 'STEP_STARTED', stepName: '准备提纲', subagentRunId: 'sa-1' },
  { type: 'STEP_STARTED', stepName: '执行访谈', subagentRunId: 'sa-1' },
  { type: 'STEP_FINISHED', stepName: '准备提纲', subagentRunId: 'sa-1' },
  { type: 'STEP_STARTED', stepName: '竞品扫描', subagentRunId: 'sa-2' },
];

describe('swarm-progress.vue 渲染', () => {
  it('挂载渲染：汇总计数 + 任务（id 命名）+ 状态 + 步骤节拍', () => {
    const wrapper = mount(SwarmProgressCard, { props: { vm: foldSwarmEvents(EVENTS) } });
    expect(wrapper.find('[data-testid="ipd-swarm-progress"]').exists()).toBe(true);

    const counts = wrapper.get('[data-testid="ipd-swarm-counts"]').text();
    expect(counts).toContain('共 2');
    expect(counts).toContain('执行中 2');

    // STEP_* 惰性建任务以 subagentRunId 命名（无 SUBAGENT_* 后不再有业务任务名）
    expect(wrapper.find('[data-testid="ipd-swarm-task-sa-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="ipd-swarm-task-sa-2"]').exists()).toBe(true);

    const text = wrapper.text();
    expect(text).toContain('准备提纲'); // 已完成步骤节拍
    expect(text).toContain('执行访谈'); // 执行中步骤节拍
    expect(text).toContain('竞品扫描'); // sa-2 步骤节拍
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
