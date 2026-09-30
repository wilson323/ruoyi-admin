import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { SubStage } from '../../../../api/ipd/stage-sub-stages';
import StageCanvas from './stage-canvas.vue';

function stage(code: string, stageCode: string, sortOrder: number, gateCode: null | string = null): SubStage {
  return {
    actions: [], code, gateCode, id: String(sortOrder), isGate: gateCode ? 'Y' : 'N',
    name: code, ownerRole: 'MARKET_PM', skillHint: null, sortOrder, stageCode,
  };
}

describe('StageCanvas', () => {
  it('从目录自动绘制节点，顺序按 sortOrder，KPI 常驻区独立展示', async () => {
    const wrapper = mount(StageCanvas, { props: {
      activeCode: 'CONCEPT-S1',
      stages: [stage('CONCEPT-S2', 'CONCEPT', 2, 'G1'), stage('KPI-S1', 'KPI', 99), stage('CONCEPT-S1', 'CONCEPT', 1)],
    } });
    const nodes = wrapper.findAll('.flow-node');
    expect(nodes.map((node) => node.text())).toEqual([
      expect.stringContaining('CONCEPT-S1'),
      expect.stringContaining('CONCEPT-S2'),
      expect.stringContaining('KPI-S1'),
    ]);
    expect(wrapper.text()).toContain('常驻指标 · 不参与阶段推进');
    expect(wrapper.get('[data-testid="ipd-ai-canvas-node-CONCEPT-S1"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[data-testid="ipd-ai-canvas-node-CONCEPT-S2"]').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['CONCEPT-S2']]);
  });
});
