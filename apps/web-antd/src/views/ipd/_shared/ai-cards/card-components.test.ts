/**
 * AI 建议卡片 4 组件行为测试（R232 P1-06）。
 *
 * 覆盖：4 卡挂载渲染 + 头部 BR-AI-04 Alert 常驻、CardDynString 字面量/绑定对象双形态
 * 渲染（string 直显、{path} 取 path）、确认按钮只 emit 给宿主 handler（C08 零直写）、
 * 注册表 component 槽位静态接入（P1-06 对 P1-05 骨架的唯一增量）。
 */
import type { Component } from 'vue';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { getCardType, listCardTypes } from './card-registry';
import DemandDraftCard from './demand-draft-card.vue';
import GateConclusionCard from './gate-conclusion-card.vue';
import GatePrecheckCard from './gate-precheck-card.vue';
import ProjectCharterCard from './project-charter-card.vue';
import type {
  DemandDraftCardData,
  GateConclusionCardData,
  GatePrecheckCardData,
  ProjectCharterCardData,
} from './types';

/** 4 卡通用用例表：组件 + 混合 DynString 形态样本 data + 根节点 testid。 */
interface CardCase {
  data:
    | DemandDraftCardData
    | GateConclusionCardData
    | GatePrecheckCardData
    | ProjectCharterCardData;
  component: Component;
  name: string;
  root: string;
}

/** gate.precheck 样本：gateCode/items[0].result 字面量，conditionNote/leftoverStatus 绑定对象。 */
const precheckData: GatePrecheckCardData = {
  gateCode: 'G1-TR',
  round: 2,
  reviewCount: 3,
  totalElements: 2,
  items: [
    {
      elementId: 101,
      result: 'PASS',
      conditionNote: { path: '/items/0/conditionNote' },
      evidenceRef: 'EV-1',
      leftoverStatus: { path: '/items/0/leftoverStatus' },
    },
    {
      elementId: 102,
      result: { path: '/items/1/result' },
      conditionNote: '需补测试报告',
      evidenceRef: { path: '/items/1/evidenceRef' },
      leftoverStatus: 'NONE',
    },
  ],
};

/** gate.conclusion 样本：gateCode 绑定对象，reviews 两行各含一种形态。 */
const conclusionData: GateConclusionCardData = {
  gateCode: { path: '/gateCode' },
  reviews: [
    {
      reviewerType: 'MARKET_PM',
      decision: { path: '/reviews/0/decision' },
      opinion: '材料齐备',
      round: 1,
    },
    {
      reviewerType: { path: '/reviews/1/reviewerType' },
      decision: 'CONDITIONAL',
      opinion: { path: '/reviews/1/opinion' },
      round: 2,
    },
  ],
  passCount: 1,
  conditionalCount: 1,
  failCount: 0,
};

/** project.charter 样本：编号/阶段字面量，名称绑定对象。 */
const charterData: ProjectCharterCardData = {
  contextProjectId: 1001,
  contextProjectCode: 'P-2026-01',
  contextProjectName: { path: '/contextProjectName' },
  contextCurrentStage: 'G1',
  contextProductId: 2002,
};

/** demand.draft 样本：标题字面量，status/source 各取一种形态。 */
const draftData: DemandDraftCardData = {
  contextProjectId: 1001,
  contextProjectCode: { path: '/contextProjectCode' },
  contextProjectName: '扫地机器人',
  requirements: [
    {
      requirementId: 201,
      title: '拖布自清洁',
      status: 'OPEN',
      source: { path: '/requirements/0/source' },
    },
    {
      requirementId: 202,
      title: { path: '/requirements/1/title' },
      status: { path: '/requirements/1/status' },
      source: 'REQ',
    },
  ],
};

const CARD_CASES: CardCase[] = [
  {
    name: 'gate.precheck 清单卡',
    component: GatePrecheckCard,
    data: precheckData,
    root: 'ai-card-gate-precheck',
  },
  {
    name: 'gate.conclusion 判定卡',
    component: GateConclusionCard,
    data: conclusionData,
    root: 'ai-card-gate-conclusion',
  },
  {
    name: 'project.charter 对比卡',
    component: ProjectCharterCard,
    data: charterData,
    root: 'ai-card-project-charter',
  },
  {
    name: 'demand.draft 草稿卡',
    component: DemandDraftCard,
    data: draftData,
    root: 'ai-card-demand-draft',
  },
];

describe('ai-cards 4 卡组件（P1-06）', () => {
  it('4 卡挂载渲染 + 头部 BR-AI-04 Alert 常驻（复用 ai-assistant.vue 形态）', () => {
    for (const cardCase of CARD_CASES) {
      const wrapper = mount(cardCase.component, { props: { data: cardCase.data } });
      expect(wrapper.find(`[data-testid="${cardCase.root}"]`).exists(), cardCase.name).toBe(true);
      const alert = wrapper.find('[data-testid="ai-card-alert"]');
      expect(alert.exists(), `${cardCase.name} 应有 BR-AI-04 Alert`).toBe(true);
      expect(alert.text()).toContain('BR-AI-04');
      expect(alert.text()).toContain('不做内容过滤');
    }
  });

  it('CardDynString 双形态：字面量直显、绑定对象取 path 展示（gate.precheck）', () => {
    const wrapper = mount(GatePrecheckCard, { props: { data: precheckData } });
    const text = wrapper.text();
    // 字面量直显
    expect(text).toContain('G1-TR');
    expect(text).toContain('EV-1');
    expect(text).toContain('需补测试报告');
    expect(text).toContain('NONE');
    // 绑定对象取 path
    expect(text).toContain('/items/0/conditionNote');
    expect(text).toContain('/items/0/leftoverStatus');
    expect(text).toContain('/items/1/result');
    expect(text).toContain('/items/1/evidenceRef');
  });

  it('CardDynString 双形态（gate.conclusion：gateCode 绑定对象 + reviews 混合）', () => {
    const wrapper = mount(GateConclusionCard, { props: { data: conclusionData } });
    const text = wrapper.text();
    expect(text).toContain('/gateCode');
    expect(text).toContain('MARKET_PM');
    expect(text).toContain('/reviews/0/decision');
    expect(text).toContain('材料齐备');
    expect(text).toContain('/reviews/1/reviewerType');
    expect(text).toContain('CONDITIONAL');
    expect(text).toContain('/reviews/1/opinion');
    expect(wrapper.get('[data-testid="ai-card-conclusion-pass"]').text()).toContain('通过 1');
    expect(wrapper.get('[data-testid="ai-card-conclusion-conditional"]').text()).toContain('有条件通过 1');
    expect(wrapper.get('[data-testid="ai-card-conclusion-fail"]').text()).toContain('不通过 0');
  });

  it('CardDynString 双形态（project.charter + demand.draft）', () => {
    const charter = mount(ProjectCharterCard, { props: { data: charterData } });
    expect(charter.text()).toContain('P-2026-01');
    expect(charter.text()).toContain('/contextProjectName');
    expect(charter.text()).toContain('G1');
    expect(charter.text()).toContain('1001');
    expect(charter.text()).toContain('2002');

    const draft = mount(DemandDraftCard, { props: { data: draftData } });
    expect(draft.text()).toContain('/contextProjectCode');
    expect(draft.text()).toContain('扫地机器人');
    expect(draft.text()).toContain('拖布自清洁');
    expect(draft.text()).toContain('/requirements/0/source');
    expect(draft.text()).toContain('/requirements/1/title');
    expect(draft.text()).toContain('/requirements/1/status');
    expect(draft.text()).toContain('REQ');
  });

  it('project.charter 对比卡：AI 建议值槽位与「不可直接生效」口径', () => {
    const slotted = mount(ProjectCharterCard, {
      props: { data: charterData },
      slots: {
        suggested: '<span data-testid="ai-suggested-slot">建议注册资本 500 万（仅建议）</span>',
      },
    });
    expect(slotted.find('[data-testid="ai-suggested-slot"]').exists()).toBe(true);
    expect(slotted.text()).toContain('建议注册资本 500 万');
    expect(slotted.text()).toContain('不可直接生效');

    const fallback = mount(ProjectCharterCard, { props: { data: charterData } });
    expect(fallback.find('[data-testid="ai-suggested-slot"]').exists()).toBe(false);
    expect(fallback.text()).toContain('建议值以随卡建议文案为准');
  });

  it('确认按钮只 emit 给宿主 handler（C08 零直写），payload = card data', async () => {
    for (const cardCase of CARD_CASES) {
      const wrapper = mount(cardCase.component, { props: { data: cardCase.data } });
      await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
      const emitted = wrapper.emitted('confirm');
      expect(emitted, `${cardCase.name} 应 emit confirm`).toHaveLength(1);
      expect(emitted?.[0]?.[0], cardCase.name).toEqual(cardCase.data);
    }
  });

  it('注册表 component 槽位已静态接入 4 组件（P1-06 对骨架的唯一增量）', () => {
    expect(getCardType('gate.precheck', 1)?.component).toBe(GatePrecheckCard);
    expect(getCardType('gate.conclusion', 1)?.component).toBe(GateConclusionCard);
    expect(getCardType('project.charter', 1)?.component).toBe(ProjectCharterCard);
    expect(getCardType('demand.draft', 1)?.component).toBe(DemandDraftCard);
    expect(listCardTypes().every((entry) => entry.component !== undefined)).toBe(true);
  });
});
