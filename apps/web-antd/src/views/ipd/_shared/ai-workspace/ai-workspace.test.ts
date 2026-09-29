/**
 * AI 工作区四区自动渲染测试（2026-09-29 形态裁决：建议卡/步骤/画布/文档常驻
 * 堆叠渲染，不再互斥切换；锚点条只定位不隐藏）。
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
  it('四区常驻自动渲染：建议卡/步骤/画布/文档同时在场，无需切换', () => {
    const wrapper = mount(IpdAiWorkspace, {
      slots: {
        cards: '<div data-testid="card-slot-echo">卡片槽</div>',
        steps: '<div data-testid="step-slot-echo">步骤槽</div>',
        canvas: '<div data-testid="canvas-slot-echo">画布槽</div>',
        doc: '<div data-testid="doc-slot-echo">文档槽</div>',
      },
    });
    for (const key of ['cards', 'steps', 'canvas', 'doc']) {
      expect(wrapper.find(`[data-testid="ipd-ai-ws-pane-${key}"]`).exists()).toBe(true);
    }
    // 四个插槽同时渲染（不因未激活而缺席）
    for (const key of ['card', 'step', 'canvas', 'doc']) {
      expect(wrapper.find(`[data-testid="${key}-slot-echo"]`).exists()).toBe(true);
    }
    expect(wrapper.findAll('.ws-tab')).toHaveLength(4);
  });

  it('锚点点击只定位不切换：四区仍在场，pane 记录锚点偏好', async () => {
    const wrapper = mount(IpdAiWorkspace, {
      slots: { cards: '<div data-testid="card-slot-echo">卡片槽</div>' },
    });
    await wrapper.get('[data-testid="ipd-ai-ws-tab-canvas"]').trigger('click');
    expect(useIpdAiWorkspace().pane.value).toBe('canvas');
    // 切换后四区仍在（互斥 v-if 已移除，状态不因锚点点击丢失）
    for (const key of ['cards', 'steps', 'canvas', 'doc']) {
      expect(wrapper.find(`[data-testid="ipd-ai-ws-pane-${key}"]`).exists()).toBe(true);
    }
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

  it('无插槽时各区回退兜底空态文案（降级铁律）', () => {
    const wrapper = mount(IpdAiWorkspace);
    expect(wrapper.findAll('.ws-empty')).toHaveLength(4);
    expect(wrapper.text()).toContain('建议卡');
    expect(wrapper.text()).toContain('文档');
  });
});
