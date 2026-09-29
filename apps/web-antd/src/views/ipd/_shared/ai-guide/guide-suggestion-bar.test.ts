/**
 * 引导建议 chips 条（C4b）组件测试：渲染 chips / 点击 emit pick / 空态零渲染。
 *
 * chips 本体走 @copilotkit/vue 成熟原语（CopilotChatSuggestionView + Pill，成熟能力
 * 替换详稿手写按钮，差异登记见交付说明），此处钉死既有 testid 契约
 * （ipd-guide-chips / ipd-guide-chip-0..n）与 pick 语义（点击=填入输入框全文）。
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GuideSuggestionBar from './guide-suggestion-bar.vue';

const SUGGESTIONS = [
  '1. 市场机会与痛点调研（技能 interview-script）：先用 JTBD 提纲做痛点访谈。',
  '2. 竞品分析（结构化登记）：拆解竞品功能与定价。',
];

describe('GuideSuggestionBar（C4b chips 条）', () => {
  it('suggestions 非空：渲染 chips 条 + 逐条 testid（ipd-guide-chip-0..n）', () => {
    const wrapper = mount(GuideSuggestionBar, { props: { suggestions: SUGGESTIONS } });
    expect(wrapper.find('[data-testid="ipd-guide-chips"]').exists()).toBe(true);
    for (const [i, text] of SUGGESTIONS.entries()) {
      const chip = wrapper.find(`[data-testid="ipd-guide-chip-${i}"]`);
      expect(chip.exists(), `chip-${i}`).toBe(true);
      expect(chip.text(), `chip-${i}`).toBe(text);
    }
    expect(wrapper.findAll('[data-testid^="ipd-guide-chip-"]')).toHaveLength(2);
  });

  it('点击 chip → emit pick(chips 全文)（点击=填入既有输入框，不发写请求）', async () => {
    const wrapper = mount(GuideSuggestionBar, { props: { suggestions: SUGGESTIONS } });
    await wrapper.find('[data-testid="ipd-guide-chip-1"]').trigger('click');
    expect(wrapper.emitted('pick')).toEqual([[SUGGESTIONS[1]]]);
  });

  it('空 suggestions → chips 条零渲染（无引导不出条）', () => {
    const wrapper = mount(GuideSuggestionBar, { props: { suggestions: [] } });
    expect(wrapper.find('[data-testid="ipd-guide-chips"]').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('ipd-guide-chip-');
  });
});
