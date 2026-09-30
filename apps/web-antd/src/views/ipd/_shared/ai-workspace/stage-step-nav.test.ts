import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { SubStage } from '../../../../api/ipd/stage-sub-stages';
import StageStepNav from './stage-step-nav.vue';

function stage(code: string, stageCode: string, sortOrder: number): SubStage {
  return {
    actions: [],
    code,
    gateCode: null,
    id: String(sortOrder),
    isGate: 'N',
    name: `${code} 名称`,
    ownerRole: 'MARKET_PM',
    skillHint: null,
    sortOrder,
    stageCode,
  };
}

describe('StageStepNav', () => {
  it('按阶段分组并依据目录顺序绘制编号时间线，选中仅表示浏览位置', async () => {
    const later = stage('CONCEPT-S2', 'CONCEPT', 2);
    later.gateCode = 'G1';
    later.actions = [{
      actionCode: 'REVIEW', actionName: '评审', skillNames: [], sortOrder: 1,
      subStageCode: later.code,
    }];
    const wrapper = mount(StageStepNav, { props: {
      activeCode: 'CONCEPT-S1',
      stages: [later, stage('PLAN-S1', 'PLAN', 1), stage('CONCEPT-S1', 'CONCEPT', 1)],
    } });

    expect(wrapper.findAll('.stage-group h3').map((heading) => heading.text())).toEqual(['CONCEPT', 'PLAN']);
    expect(wrapper.findAll('.stage-item').map((item) => item.attributes('data-testid'))).toEqual([
      'ipd-ai-step-CONCEPT-S1', 'ipd-ai-step-CONCEPT-S2', 'ipd-ai-step-PLAN-S1',
    ]);
    expect(wrapper.findAll('.timeline-marker').map((marker) => marker.text())).toEqual(['01', '02', '01']);
    expect(wrapper.get('[data-testid="ipd-ai-step-CONCEPT-S1"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('选中仅切换视图，不表示已执行或已完成');
    expect(wrapper.get('[data-testid="ipd-ai-step-CONCEPT-S2"]').text()).toContain('G1 门禁');
    expect(wrapper.get('[data-testid="ipd-ai-step-CONCEPT-S2"]').text()).toContain('评审');

    await wrapper.get('[data-testid="ipd-ai-step-CONCEPT-S2"]').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['CONCEPT-S2']]);
  });

  it('stageCode 只筛选浏览阶段，空目录明示空态', () => {
    const stages = [stage('CONCEPT-S1', 'CONCEPT', 1), stage('PLAN-S1', 'PLAN', 1)];
    const filtered = mount(StageStepNav, { props: { activeCode: null, stageCode: 'PLAN', stages } });
    expect(filtered.findAll('.stage-group')).toHaveLength(1);
    expect(filtered.find('[data-testid="ipd-ai-step-PLAN-S1"]').exists()).toBe(true);
    expect(filtered.find('[data-testid="ipd-ai-step-CONCEPT-S1"]').exists()).toBe(false);

    const empty = mount(StageStepNav, { props: { activeCode: null, stageCode: 'VERIFY', stages } });
    expect(empty.text()).toContain('该浏览阶段暂无可显示的小阶段');
    expect(empty.findAll('.stage-item')).toHaveLength(0);
  });
});
