/**
 * AiSuggest 通用组件行为测试（R227-C1 AI-FUSION L2）。
 *
 * 覆盖：调用参数组装（scene + 全局当前项目回落）、needsPrompt 前置校验、
 * 成功渲染（默认无采纳按钮 = 未声明 schema 场景）、adoptable 门控与 emit、
 * degraded 引导态、错误态走 ipdErrorText 不静默。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../api/ipd/auth';
import { aiSuggest } from '../../../api/ipd/ai-suggest';
import AiSuggest from './ai-suggest.vue';

vi.mock('../../../api/ipd/ai-suggest', () => ({
  aiSuggest: vi.fn(),
}));

const okView = {
  aiModel: 'mock-mini',
  completionTokens: 30,
  degraded: false,
  latencyMs: 500,
  markdown: '## 建议\n1. 先补齐材料',
  promptTokens: 100,
  scene: 'workbench.next-step',
};

beforeEach(() => {
  vi.mocked(aiSuggest).mockReset();
  window.localStorage.clear();
});

describe('AiSuggest 组件（R227-C1）', () => {
  it('点击发起：aiSuggest 收到 scene，无全局项目时 projectId=undefined', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('workbench.next-step', {
      entityId: undefined,
      projectId: undefined,
      userPrompt: undefined,
    });
    expect(wrapper.get('[data-testid="ai-suggest-result"]').text()).toContain('先补齐材料');
  });

  it('跟随全局当前项目（localStorage ipd:current-project）', async () => {
    window.localStorage.setItem('ipd:current-project', '9140001');
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, { props: { scene: 'project.summary.refresh' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('project.summary.refresh', {
      entityId: undefined,
      projectId: '9140001',
      userPrompt: undefined,
    });
  });

  it('needsPrompt 空素材：本地校验拦截不发请求', async () => {
    const wrapper = mount(AiSuggest, {
      props: { scene: 'project.create.suggest', needsPrompt: true },
    });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');

    expect(aiSuggest).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="ai-suggest-error"]').text()).toContain('原始素材');
  });

  it('needsPrompt 有素材：userPrompt 去空白后随请求发出', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, {
      props: { scene: 'demand.create.from-requirement', needsPrompt: true },
    });

    await wrapper.get('[data-testid="ai-suggest-prompt"]').setValue('  做一款扫地机器人  ');
    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('demand.create.from-requirement',
      expect.objectContaining({ userPrompt: '做一款扫地机器人' }));
  });

  it('成功输出默认不展示「采纳到表单」（未声明 schema 场景禁自动采纳）；adoptable 才展示并 emit', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const plain = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });
    await plain.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    expect(plain.find('[data-testid="ai-suggest-adopt"]').exists()).toBe(false);

    const adoptable = mount(AiSuggest, {
      props: { scene: 'project.summary.refresh', adoptable: true },
    });
    await adoptable.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    await adoptable.get('[data-testid="ai-suggest-adopt"]').trigger('click');

    expect(adoptable.emitted('adopt')?.[0]).toEqual([
      { markdown: okView.markdown, scene: 'workbench.next-step' },
    ]);
  });

  it('degraded 引导态：warning 展示且无采纳/复制按钮', async () => {
    vi.mocked(aiSuggest).mockResolvedValue({ ...okView, degraded: true, markdown: 'AI 建议暂未启用' });
    const wrapper = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="ai-suggest-degraded"]').text()).toContain('暂未启用');
    expect(wrapper.find('[data-testid="ai-suggest-adopt"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ai-suggest-copy"]').exists()).toBe(false);
  });

  it('请求失败：错误文案走 ipdErrorText 展示，不静默', async () => {
    // 真实通道形态：requestIpd 非 2xx 拒 IpdRequestError，envelopeMessage 透传后端原文（R215-E2E-B）
    vi.mocked(aiSuggest).mockRejectedValue(new IpdRequestError('request failed', 500, 90001, 'http', 'AI 服务暂时不可用'));
    const wrapper = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="ai-suggest-error"]').text()).toContain('AI 服务暂时不可用');
    expect(wrapper.find('[data-testid="ai-suggest-result"]').exists()).toBe(false);
  });
});
