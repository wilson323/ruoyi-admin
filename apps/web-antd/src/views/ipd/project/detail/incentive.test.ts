/**
 * 项目详情 - 激励台账 子页签（IpdProjectIncent / P0-10.37）：
 *   - 顶部 Alert 口径说明（项目编号 + 跳转「奖金池核算」页引导）
 *   - 表格：listBonusPools(projectId) → BonusPool[]，状态机 DRAFT/已确认/已分配
 *   - 端点真值：GET /api/v1/bonus-pool/list?projectId=（HTTP 401 已验证端点存在）
 *   - 占位 backend-pending 已消除（之前误标"项目维聚合读端点未交付"）
 *
 * Mock 形态：依 .vue 同模块的 ipdGet → ipd-auth.authenticatedRequest → fetch 链。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import IncentiveProjectTab from './incentive.vue';

const response = (data: unknown, code = 0) => new Response(
  JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const pools = [
  {
    achievementRate: '100.00',
    basePool: '90000.00',
    coefficient: '1.20',
    createTime: '2026-09-06T10:00:00',
    finalPool: '108000.00',
    id: '9001',
    levelCoefficient: '1.20',
    period: '2026-09',
    poolRate: '5.00',
    projectId: '9140004',
    projectLevel: 'A',
    receiptAmounts: '1800000.00',
    status: 'DRAFT',
    tierCoefficient: '1.00',
  },
  {
    achievementRate: '95.00',
    basePool: '60000.00',
    coefficient: '1.00',
    createTime: '2026-08-06T10:00:00',
    finalPool: '60000.00',
    id: '8800',
    levelCoefficient: '1.00',
    period: '2026-08',
    poolRate: '5.00',
    projectId: '9140004',
    projectLevel: 'B',
    receiptAmounts: '1200000.00',
    status: 'DISTRIBUTED',
    tierCoefficient: '1.00',
  },
];

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/projects/:projectId/incentive', name: 'IpdProjectIncentive', component: { template: '<div />' } },
    ],
  });
}

function stubApi(opts: { reject?: boolean; empty?: boolean } = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ method: 'GET', url });
    if (opts.reject) throw new TypeError('network unavailable');
    if (url.includes('/bonus-pool/list')) return response(opts.empty ? [] : pools);
    return response(null, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('IpdProjectIncent 激励台账子页签 (P0-10.37)', () => {
  it('首屏自动触发 GET /bonus-pool/list?projectId=9140004', async () => {
    const calls = stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/incentive');
    await router.isReady();
    const wrapper = mount(IncentiveProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('¥ 108,000.00'));
    const listCall = calls.find((c) => c.url.includes('/bonus-pool/list'));
    expect(listCall).toBeDefined();
    expect(listCall!.url).toContain('projectId=9140004');
    wrapper.unmount();
  });

  it('顶部 Alert 展示项目编号 + 跳转「奖金池核算」引导', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/incentive');
    await router.isReady();
    const wrapper = mount(IncentiveProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('¥ 108,000.00'));
    const text = wrapper.text();
    expect(text).toContain('9140004');
    expect(text).toContain('奖金池核算');
    expect(text).toContain('完整操作');
    // 不再展示 backend-pending 占位文案
    expect(text).not.toContain('后端依赖说明');
    expect(text).not.toContain('P0-10.37');
    expect(text).not.toContain('未交付');
    wrapper.unmount();
  });

  it('表格列：项目编号 + 周期 + 项目等级 + 实际回款 + 基数 + 系数 + 终算奖池 + 达成率 + 状态 + 生成时间', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/incentive');
    await router.isReady();
    const wrapper = mount(IncentiveProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('¥ 108,000.00'));
    const text = wrapper.text();
    expect(text).toContain('9001');
    expect(text).toContain('8800');
    expect(text).toContain('2026-09');
    expect(text).toContain('2026-08');
    // levelText 输出为 `${level} 级`（中间空格）
    expect(text).toContain('A 级');
    expect(text).toContain('B 级');
    // formatMoney 加千分位逗号，formatPercent 加 % 后缀
    expect(text).toContain('¥ 1,800,000.00');
    expect(text).toContain('¥ 108,000.00');
    expect(text).toContain('¥ 60,000.00');
    expect(text).toContain('100%');
    expect(text).toContain('95%');
    // 状态机标签（DRAFT/已分配）
    expect(text).toContain('草稿');
    expect(text).toContain('已分配');
    // 时间显示（formatDateTime 截到分钟：YYYY-MM-DD HH:MM）
    expect(text).toContain('2026-09-06 10:00');
    wrapper.unmount();
  });

  it('空列表：Empty 描述「暂无奖金池记录，请到「奖金池核算」页触发核算」', async () => {
    stubApi({ empty: true });
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/incentive');
    await router.isReady();
    const wrapper = mount(IncentiveProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无奖金池记录'));
    expect(wrapper.text()).toContain('触发核算');
    wrapper.unmount();
  });

  it('端点拒绝（断网/超时）：Empty 描述显示错误文案', async () => {
    stubApi({ reject: true });
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/incentive');
    await router.isReady();
    const wrapper = mount(IncentiveProjectTab, { global: { plugins: [router] } });
    // 网络层错误走 ipdErrorText → kind=transport 文案（刚加的 transport 分支未变）
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务，请检查网络后重试'));
    wrapper.unmount();
  });

  it('未传 projectId：Alert 显示「尚未选择项目」+ Empty「请先选择项目」', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects//incentive').catch(() => undefined);
    await router.isReady();
    const wrapper = mount(IncentiveProjectTab, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain('尚未选择项目');
    expect(text).toContain('请先选择项目');
    wrapper.unmount();
  });
});