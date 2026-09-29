import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import IpdAiWorkspace from './ai-workspace.vue';
import { useIpdAiWorkspace } from './use-ai-workspace';

describe('IpdAiWorkspace', () => {
  it('四 tab 齐备，点击切换 pane，cards 插槽承载既有卡片区', async () => {
    const wrapper = mount(IpdAiWorkspace, {
      slots: { cards: '<div data-testid="card-slot-echo">卡片槽</div>' },
    });
    expect(wrapper.findAll('.ws-tab')).toHaveLength(4);
    expect(wrapper.find('[data-testid="card-slot-echo"]').exists()).toBe(true);
    await wrapper.get('[data-testid="ipd-ai-ws-tab-canvas"]').trigger('click');
    expect(useIpdAiWorkspace().pane.value).toBe('canvas');
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-canvas"]').exists()).toBe(true);
    // 切回 cards，插槽内容仍在（状态不因切 tab 丢失）
    await wrapper.get('[data-testid="ipd-ai-ws-tab-cards"]').trigger('click');
    expect(wrapper.find('[data-testid="card-slot-echo"]').exists()).toBe(true);
  });
});
