/**
 * AI 工作区分区测试：页签切换，同一时间只显示当前 pane；未显示的分区仍挂载。
 */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import IpdAiWorkspace from './ai-workspace.vue';
import { useIpdAiWorkspace } from './use-ai-workspace';

beforeEach(() => {
  window.localStorage.clear();
  const ws = useIpdAiWorkspace();
  ws.setPane('cards');
});

describe('IpdAiWorkspace', () => {
  it('默认只显示建议卡，其它分区挂着但不展示', () => {
    const wrapper = mount(IpdAiWorkspace, {
      slots: {
        cards: '<div data-testid="card-slot-echo">卡片槽</div>',
        steps: '<div data-testid="step-slot-echo">步骤槽</div>',
        canvas: '<div data-testid="canvas-slot-echo">画布槽</div>',
        doc: '<div data-testid="doc-slot-echo">文档槽</div>',
      },
    });
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-cards"]').isVisible()).toBe(true);
    for (const key of ['steps', 'canvas', 'doc']) {
      expect(wrapper.find(`[data-testid="ipd-ai-ws-pane-${key}"]`).exists()).toBe(true);
      expect(wrapper.find(`[data-testid="ipd-ai-ws-pane-${key}"]`).isVisible()).toBe(false);
    }
    expect(wrapper.find('[data-testid="card-slot-echo"]').exists()).toBe(true);
    expect(wrapper.findAll('.ws-tab')).toHaveLength(4);
  });

  it('点击页签只显示该分区，未显示的插槽仍挂载', async () => {
    const wrapper = mount(IpdAiWorkspace, {
      slots: { cards: '<div data-testid="card-slot-echo">卡片槽</div>' },
    });
    await wrapper.get('[data-testid="ipd-ai-ws-tab-canvas"]').trigger('click');
    expect(useIpdAiWorkspace().pane.value).toBe('canvas');
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-canvas"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-cards"]').isVisible()).toBe(false);
    expect(wrapper.find('[data-testid="card-slot-echo"]').exists()).toBe(true);
  });

  it('focusPane 自动渲染定位：递增 focusTick 并记录 pane（出卡即定位）', () => {
    const ws = useIpdAiWorkspace();
    const before = ws.focusTick.value;
    ws.focusPane('cards');
    expect(ws.focusTick.value).toBe(before + 1);
    expect(ws.pane.value).toBe('cards');
    ws.focusPane('doc');
    expect(ws.focusTick.value).toBe(before + 2);
    expect(ws.pane.value).toBe('doc');
  });

  it('传入 panes 时只挂载指定分区', () => {
    const wrapper = mount(IpdAiWorkspace, {
      props: { panes: ['cards', 'steps'], titles: { cards: '本次运行' } },
    });
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-cards"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-steps"]').isVisible()).toBe(false);
    expect(wrapper.find('[data-testid="ipd-ai-ws-pane-canvas"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ipd-ai-ws-tab-cards"]').text()).toBe('本次运行');
  });

  it('无插槽时各区回退兜底空态文案（降级铁律）', () => {
    const wrapper = mount(IpdAiWorkspace);
    expect(wrapper.findAll('.ws-empty')).toHaveLength(4);
    expect(wrapper.text()).toContain('建议卡');
    expect(wrapper.text()).toContain('文档');
  });
});
