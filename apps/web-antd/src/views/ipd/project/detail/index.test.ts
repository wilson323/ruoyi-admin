import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import ProjectDetail from './index.vue';

const envelope = (data: unknown) => new Response(
  JSON.stringify({ code: 0, message: 'success', data }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: '/ipd/projects/:projectId/:tab',
      component: { template: '<div />' },
    }],
  });
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('IpdProjectDetail 项目上下文', () => {
  it('切换项目时立即清空已展示的旧项目标题', async () => {
    let resolveNew!: (value: Response) => void;
    const newResponse = new Promise<Response>((resolve) => { resolveNew = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/projects/101')) return envelope({ id: '101', name: '旧项目' });
      if (path.includes('/projects/202')) return newResponse;
      throw new Error(`unexpected fetch: ${path}`);
    }));
    const router = buildRouter();
    await router.push('/ipd/projects/101/overview');
    await router.isReady();
    const wrapper = mount(ProjectDetail, {
      global: { plugins: [router], stubs: { AiSuggest: true, RouterView: true } },
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('旧项目'));

    await router.push('/ipd/projects/202/overview');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain('旧项目');
    resolveNew(envelope({ id: '202', name: '新项目' }));
    await vi.waitFor(() => expect(wrapper.text()).toContain('新项目'));
    wrapper.unmount();
  });

  it('同实例切项目后立即撤下旧标题，且旧请求晚到不覆盖新项目', async () => {
    let resolveOld!: (value: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/projects/101')) return oldResponse;
      if (path.includes('/projects/202')) return envelope({ id: '202', name: '新项目', code: 'NEW-202', currentStage: 'PLAN' });
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const router = buildRouter();
    await router.push('/ipd/projects/101/overview');
    await router.isReady();
    const wrapper = mount(ProjectDetail, {
      global: { plugins: [router], stubs: { AiSuggest: true, RouterView: true } },
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/projects/101'), expect.anything()));

    await router.push('/ipd/projects/202/overview');
    await vi.waitFor(() => expect(wrapper.text()).toContain('新项目'));
    expect(wrapper.text()).not.toContain('旧项目');

    resolveOld(envelope({ id: '101', name: '旧项目', code: 'OLD-101', currentStage: 'CONCEPT' }));
    await flushPromises();
    expect(wrapper.text()).not.toContain('旧项目');
    wrapper.unmount();
  });
});
