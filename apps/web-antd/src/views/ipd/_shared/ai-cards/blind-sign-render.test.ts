/**
 * R232 P2-05 盲签隔离契约——渲染层断言（arbitrate/finalRuling 场景卡无 AI 倾向渲染）。
 *
 * <p>契约源：CopilotKit三项能力落地-全局执行计划-20260927.md L101
 * （arbitrate/finalRuling 卡无 AI 倾向渲染；盲签红线：仲裁/终审视角不得泄露 AI 倾向性内容）；
 * 母文件 §5.3：卡片层只渲染 Catalog schema 字段，AI 倾向字段（aiSuggestion/倾向评分/推荐理由类）
 * 不出现于卡片视图。
 *
 * <p>断言面（与后端 AiCardBlindSignContractTest 三向对账·前端渲染轴）：
 * ① 污染注入 AI 倾向字段（顶层 + reviews/items 子字段）→ 组件零渲染（值与字段名均不出现）；
 * ② rowView 遮蔽形态（decision/opinion=null）→ 判定/意见单元格渲染安全占位「—」，行身份保留
 *    （值空非删行，与后端 Catalog itemFields 键集恒等口径对偶）。
 *
 * <p>范围声明：只断言卡片组件层（ai-cards/*）；ai-suggest.vue / ai-suggest.test.ts 为兄弟会话
 * 修复在途文件，本文件不触碰。
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GateConclusionCard from './gate-conclusion-card.vue';
import GatePrecheckCard from './gate-precheck-card.vue';
import type { GateConclusionCardData, GatePrecheckCardData } from './types';

/** AI 倾向泄漏样例（值面唯一源）。 */
const AI_TENDENCY_VALUE = 'AI倾向-建议通过-泄露样例';
const AI_TENDENCY_SCORE = '倾向评分值0.93x';
const AI_RECOMMEND_REASON = '推荐理由-泄露样例';
const AI_CONFIDENCE_LEAK = 'aiConfidence泄露样例';

/** AI 倾向字段名（schema 外，Catalog itemFields/fields 未声明）。 */
const AI_TENDENCY_KEYS = ['aiSuggestion', 'tendencyScore', 'recommendReason', 'aiConfidence'];

describe('盲签隔离契约·渲染层（P2-05：arbitrate/finalRuling 卡无 AI 倾向渲染）', () => {
  it('gate.conclusion 卡：污染注入 AI 倾向字段（顶层+reviews 子字段）零渲染，schema 字段照常', () => {
    const dirtyConclusion = {
      gateCode: 'G1',
      reviews: [
        {
          reviewerType: 'MARKET_PM',
          decision: 'APPROVE',
          opinion: '材料齐备',
          round: 1,
          aiSuggestion: AI_TENDENCY_VALUE,
          tendencyScore: AI_TENDENCY_SCORE,
        },
        {
          reviewerType: 'RD_PM',
          decision: null,
          opinion: null,
          round: 1,
          recommendReason: AI_RECOMMEND_REASON,
        },
      ],
      passCount: 1,
      conditionalCount: 0,
      failCount: 0,
      // 顶层 AI 倾向字段（schema 外污染）
      aiSuggestion: AI_TENDENCY_VALUE,
      tendencyScore: AI_TENDENCY_SCORE,
      recommendReason: AI_RECOMMEND_REASON,
    } as unknown as GateConclusionCardData;

    const wrapper = mount(GateConclusionCard, { props: { data: dirtyConclusion } });
    const text = wrapper.text();
    // schema 字段照常渲染（断言有效面）
    expect(text).toContain('MARKET_PM');
    expect(text).toContain('APPROVE');
    expect(text).toContain('材料齐备');
    // AI 倾向值/字段名零渲染（arbitrate/finalRuling 视角不得泄露倾向内容）
    for (const leak of [AI_TENDENCY_VALUE, AI_TENDENCY_SCORE, AI_RECOMMEND_REASON]) {
      expect(text, `AI 倾向值不得渲染: ${leak}`).not.toContain(leak);
    }
    for (const key of AI_TENDENCY_KEYS) {
      expect(text, `AI 倾向字段名不得渲染: ${key}`).not.toContain(key);
    }
  });

  it('rowView 遮蔽形态（decision/opinion=null）：判定/意见单元格渲染安全占位「—」，行身份保留', () => {
    const maskedConclusion = {
      gateCode: 'G1',
      reviews: [{ reviewerType: 'RD_PM', decision: null, opinion: null, round: 1 }],
      passCount: 0,
      conditionalCount: 0,
      failCount: 0,
    } as unknown as GateConclusionCardData;

    const wrapper = mount(GateConclusionCard, { props: { data: maskedConclusion } });
    const cells = wrapper.findAll('tbody tr')[0]!.findAll('td');
    expect(cells[0]!.text()).toBe('RD_PM'); // 行身份保留（值空非删行，对偶后端键集恒等）
    expect(cells[1]!.text()).toBe('—'); // 判定遮蔽 → 安全占位
    expect(cells[2]!.text()).toBe('—'); // 意见遮蔽 → 安全占位
  });

  it('gate.precheck 卡：污染注入 items 子字段 + 顶层 AI 倾向字段零渲染', () => {
    const dirtyPrecheck = {
      gateCode: 'G1',
      round: 1,
      reviewCount: 1,
      totalElements: 1,
      items: [
        {
          elementId: 21,
          result: 'PASS',
          conditionNote: null,
          evidenceRef: null,
          leftoverStatus: null,
          aiConfidence: AI_CONFIDENCE_LEAK,
          aiSuggestion: AI_TENDENCY_VALUE,
        },
      ],
      aiSuggestion: AI_TENDENCY_VALUE,
      recommendReason: AI_RECOMMEND_REASON,
    } as unknown as GatePrecheckCardData;

    const wrapper = mount(GatePrecheckCard, { props: { data: dirtyPrecheck } });
    const text = wrapper.text();
    expect(text).toContain('G1'); // schema 字段照常渲染
    expect(text).toContain('PASS');
    for (const leak of [AI_TENDENCY_VALUE, AI_TENDENCY_SCORE, AI_RECOMMEND_REASON, AI_CONFIDENCE_LEAK]) {
      expect(text, `AI 倾向值不得渲染: ${leak}`).not.toContain(leak);
    }
    for (const key of AI_TENDENCY_KEYS) {
      expect(text, `AI 倾向字段名不得渲染: ${key}`).not.toContain(key);
    }
  });
});
