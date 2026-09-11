/**
 * 项目详情 - Gate 评审 子页（IpdProjectGates / P0-10.23；R30 项目维度列表接线）：
 *   - 顶部 Alert 口径（项目编号 + 列表端点 GET /projects/{id}/gates + GateReviewController 端点）
 *   - 项目 Gate 列表（R30 主路径）：列表选中即评审；空列表 = 真实空态
 *   - 手动定位兜底输入 + 嵌入式 GatePanel（initialGateId 接线）
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import GatesProjectTab from './gates.vue';

const envelope = (data: unknown) => new Response(
  JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-11T00:00:00Z', traceId: 'fixture' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/projects/:projectId/gates', name: 'IpdProjectGates', component: { template: '<div />' } },
    ],
  });
}

function stubGateList(rows: Array<Record<string, unknown>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/gates')) return envelope(rows);
    throw new Error(`unexpected fetch: ${path}`);
  });
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('IpdProjectGates 项目 Gate 评审子页 (P0-10.23)', () => {
  it('首屏渲染：项目编号注入 + 列表端点口径 + 拉取 GET /projects/{id}/gates', async () => {
    const fetcher = stubGateList([]);
    vi.stubGlobal('fetch', fetcher);
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/gates');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());

    const text = wrapper.text();
    expect(text).toContain('项目 Gate 评审：项目 P-200');
    expect(text).toContain('GET /projects/{id}/gates');
    expect(text).toContain('GateReviewController');
    expect(text).toContain('该项目尚无 Gate 评审');
    // 空列表 = 真实空态（不造假数据）
    expect(wrapper.text()).not.toContain('后端未交付');
    wrapper.unmount();
  });

  it('列表数据渲染：Gate 编号/状态/轮次 + 「打开评审」选中后挂载 GatePanel', async () => {
    const fetcher = stubGateList([
      { id: '9101', gateCode: 'G1-概念评审', status: 'PENDING', currentRound: 1, signDueAt: '2026-09-12 18:00:00', concludedAt: null, projectId: 'P-200' },
      { id: '9102', gateCode: 'G2-规划评审', status: 'APPROVED', currentRound: 2, signDueAt: null, concludedAt: '2026-09-01 10:00:00', projectId: 'P-200' },
    ]);
    vi.stubGlobal('fetch', fetcher);
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/gates');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('G1-概念评审'));

    expect(wrapper.text()).toContain('G2-规划评审');
    expect(wrapper.text()).toContain('PENDING');
    expect(wrapper.text()).toContain('APPROVED');
    // 初始未选中：评审面板空态
    expect(wrapper.text()).toContain('请在上方列表点击「打开评审」，或手动输入 Gate 编号定位');

    const openBtn = wrapper.findAll('button').find((b) => b.text().includes('打开评审'));
    expect(openBtn).toBeDefined();
    await openBtn!.trigger('click');
    await wrapper.vm.$nextTick();
    // 选中后挂载嵌入式 GatePanel（标题可见）
    expect(wrapper.text()).toContain('Gate 评审面板（嵌入式 GatePanel）');
    wrapper.unmount();
  });

  it('手动定位兜底：输入 Gate 编号后 activeGateId 生效挂载面板', async () => {
    const fetcher = stubGateList([]);
    vi.stubGlobal('fetch', fetcher);
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/gates');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());

    const input = wrapper.find('input[placeholder*="Gate 编号"]');
    expect(input.exists()).toBe(true);
    await input.setValue('9101234567890');
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Gate 评审面板（嵌入式 GatePanel）');
    wrapper.unmount();
  });

  it('未传 projectId：Alert 提示"尚未选择"', async () => {
    const fetcher = stubGateList([]);
    vi.stubGlobal('fetch', fetcher);
    const router = buildRouter();
    await router.push('/');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('项目 尚未选择');
    wrapper.unmount();
  });
});
