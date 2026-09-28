/**
 * 页41 产品目录 · L2 每页 AI 入口（2026-09-28）：product.name-classify。
 *
 * - 三件套：按钮存在 → 素材触发 scene=product.name-classify → adopt 回传宿主；
 * - C08 零直写：AI 链路 fetch 零调用（产品档案读端点走模块 mock，无写端点触达）；
 * - AI 入口挂在 isSuperAdmin 分区内：以超管身份挂载。
 */
import { mount } from '@vue/test-utils';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiSuggest } from '../../../../api/ipd/ai-suggest';
import { listProductGroups, listProducts } from '../../../../api/ipd/product';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import CatalogPage from './index.vue';

vi.mock('../../../../api/ipd/ai-suggest', () => ({ aiSuggest: vi.fn() }));

vi.mock('../../../../api/ipd/product', () => ({
  listProductGroups: vi.fn(),
  listProducts: vi.fn(),
}));

/** L2 AI 测试视图：非结构化场景（无卡）+ 非降级 → 纯文本 + 「采纳到表单」按钮。 */
const suggestView = (scene: string, markdown: string) => ({
  aiModel: 'mock-mini', card: null, completionTokens: 1, degraded: false,
  latencyMs: 5, markdown, promptTokens: 1, scene,
});

/** 超管身份注入（与挂载同一 pinia 实例，避免 store 分叉）。 */
function loginAsSuperAdmin(pinia: Pinia): void {
  setActivePinia(pinia);
  useIpdAuthStore().identity = {
    mustChangePwd: false,
    scope: 'FULL',
    person: {
      accountStatus: 'ACTIVE',
      groupId: null,
      id: '1',
      name: '超级管理员',
      personType: 'SUPER_ADMIN',
      username: 'fixture-super',
    },
  };
}

beforeEach(() => {
  vi.mocked(aiSuggest).mockReset();
  vi.mocked(listProducts).mockReset();
  vi.mocked(listProductGroups).mockReset();
  vi.mocked(listProducts).mockResolvedValue([]);
  vi.mocked(listProductGroups).mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('L2 AI 入口（product.name-classify）', () => {
  it('product.name-classify：按钮存在、素材触发 scene、adopt 回传宿主（C08 零直写）', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(suggestView('product.name-classify', '## 名称分类\n- 平板产品线'));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const pinia = createPinia();
    loginAsSuperAdmin(pinia);
    const wrapper = mount(CatalogPage, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(vi.mocked(listProducts)).toHaveBeenCalled());

    // ① 按钮存在
    const runBtn = wrapper.find('[data-testid="catalog-ai-classify"] [data-testid="ai-suggest-run"]');
    expect(runBtn.exists()).toBe(true);
    expect(runBtn.text()).toContain('AI 产品名称分类');

    // ② 触发 scene 正确（needsPrompt：先填素材再发起）
    await wrapper.get('[data-testid="catalog-ai-classify"] [data-testid="ai-suggest-prompt"]')
      .setValue('ZK 平板 X100 教育版');
    await runBtn.trigger('click');
    await vi.waitFor(() => expect(vi.mocked(aiSuggest)).toHaveBeenCalledWith(
      'product.name-classify',
      expect.objectContaining({ userPrompt: 'ZK 平板 X100 教育版' }),
    ));

    // ③ adopt 回传宿主（仅本地提示，不写库）
    await wrapper.get('[data-testid="catalog-ai-classify"] [data-testid="ai-suggest-adopt"]').trigger('click');
    const ack = wrapper.find('[data-testid="catalog-ai-adopted"]');
    expect(ack.exists()).toBe(true);
    expect(ack.text()).toContain('已回传宿主');
    expect(ack.text()).toContain('product.name-classify');
    expect(ack.text()).toContain('不写库');
    // C08 零直写：产品读端点走模块 mock，AI 链路 fetch 零调用（无写端点触达）
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
