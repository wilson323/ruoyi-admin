/**
 * 项目详情 - KPI 子页签（IpdProjectKpi / P0-10.32）：
 *   - 顶部 Alert 口径说明（三端点路径 + L1..L5 + COMPREHENSIVE 公式）
 *   - 表单：项目编号（路由注入，禁用）+ 周期（YYYY-MM）+ 趋势回看月数（1~36）
 *   - 三段卡片：① 绩效 KPI 聚合  ② 功能 KPI 来源  ③ 历史 KPI 趋势
 *   - 调用 kpi.ts 3 函数：getPerformanceKpi / getFunctionalKpi / getKpiTrend
 *
 * Mock 形态：依 .vue 同模块的 ipdGet → ipd-auth.authenticatedRequest → fetch 链。
 * 注入 vi.stubGlobal('fetch') 后只按 URL 路径分发 200 响应。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputNumber } from 'ant-design-vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import KpiProjectTab from './kpi.vue';

const response = (data: unknown, code = 0) => new Response(
  JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const performanceSummary = {
  COMPREHENSIVE: '92.40',
  L1: '12000.00',
  L2: '8400.00',
  L3: '5400.00',
  L4: '2100.00',
  L5: '600.00',
};

const functionalSources = [
  { contribution: '36.96', source: 'PROJECT_SCORE', value: '92.40', weight: '0.40' },
  { contribution: '40.00', source: 'KPI_CALCULATOR', value: '100.00', weight: '0.40' },
  { contribution: '6.00', source: 'ALLOWANCE_LEDGER', value: '30000.00', weight: '0.20' },
];

const trendPoints = [
  { period: '2026-04', recordId: 'r-001', source: 'DATA', value: '78.5' },
  { period: '2026-05', recordId: null, source: 'MISSING', value: null },
  { period: '2026-06', recordId: 'r-003', source: 'DATA', value: '85.0' },
];

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/projects/:projectId/kpi', name: 'IpdProjectKpi', component: { template: '<div />' } },
    ],
  });
}

async function setInputNumber(wrapper: ReturnType<typeof mount>, index: number, value: number) {
  const numbers = wrapper.findAllComponents(InputNumber);
  const target = numbers[index];
  if (!target) throw new Error(`InputNumber #${index} not found`);
  await target.vm.$emit('update:value', value);
  await wrapper.vm.$nextTick();
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

/** 幂等 mock：按 URL 路径分发返回结构化数据；返回 calls 数组便于断言查询参数。 */
function stubApi() {
  const calls: { method: string; url: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ method: 'GET', url });
    if (url.includes('/kpi/performance')) return response(performanceSummary);
    if (url.includes('/kpi/functional')) return response(functionalSources);
    if (url.includes('/kpi/trend')) return response(trendPoints);
    return response(null, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('IpdProjectKpi 项目 KPI 子页签 (P0-10.32)', () => {
  it('首屏自动触发三端点请求（performance/functional/trend）', async () => {
    const calls = stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('12000.00'));
    expect(calls.some((c) => c.url.includes('/kpi/performance'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/kpi/functional'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/kpi/trend'))).toBe(true);
    wrapper.unmount();
  });

  it('顶部 Alert 展示项目编号 + 周期 + 三端点路径', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('12000.00'));
    const text = wrapper.text();
    expect(text).toContain('P-200');
    expect(text).toContain('/kpi/performance');
    expect(text).toContain('/kpi/functional');
    expect(text).toContain('/kpi/trend');
    wrapper.unmount();
  });

  it('① 绩效 KPI 聚合：L1..L5 + COMPREHENSIVE 全部命中', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('12000.00'));
    const text = wrapper.text();
    expect(text).toContain('L1');
    expect(text).toContain('L5');
    expect(text).toContain('综合分');
    expect(text).toContain('92.40');
    expect(text).toContain('8400.00');
    wrapper.unmount();
  });

  it('② 功能 KPI 来源：三来源 + 权重百分比 + 加权贡献', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('36.96'));
    const text = wrapper.text();
    expect(text).toContain('津贴台账');
    expect(text).toContain('KPI 计算器');
    expect(text).toContain('项目绩效分');
    expect(text).toContain('40%');
    expect(text).toContain('20%');
    expect(text).toContain('100.00');
    wrapper.unmount();
  });

  it('③ 历史 KPI 趋势：月份全显 + MISSING 灰显 + DATA/MISSING 标识', async () => {
    const calls = stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('2026-04'));
    const text = wrapper.text();
    expect(text).toContain('2026-04');
    expect(text).toContain('2026-05');
    expect(text).toContain('2026-06');
    expect(text).toContain('缺数月');
    expect(text).toContain('有数');
    const missingRow = wrapper.findAll('tr').find((tr) => tr.text().includes('2026-05'));
    expect(missingRow?.classes()).toContain('trend-missing');
    // 默认 periods=12
    expect(calls.find((c) => c.url.includes('/kpi/trend'))?.url).toContain('periods=12');
    wrapper.unmount();
  });

  it('点击查询：变更 periods=24 后 trend 调用携带 periods=24', async () => {
    const calls = stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('12000.00'));
    await setInputNumber(wrapper, 0, 24);
    await wrapper.vm.$nextTick();
    const queryBtn = wrapper.findAll('button').find((b) => b.text().replace(/\s+/g, '') === '查询');
    expect(queryBtn).toBeDefined();
    await queryBtn!.trigger('click');
    await vi.waitFor(() => {
      const trend24 = calls.filter((c) => c.url.includes('/kpi/trend'));
      expect(trend24.some((c) => c.url.includes('periods=24'))).toBe(true);
    });
    wrapper.unmount();
  });

  it('performance 端点拒绝时：① 段回退空态 + 错误文案，仍展示 ②/③', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/kpi/performance')) return response(null, 30001); // 业务 30001
      if (url.includes('/kpi/functional')) return response(functionalSources);
      if (url.includes('/kpi/trend')) return response(trendPoints);
      return response(null, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/kpi');
    await router.isReady();
    const wrapper = mount(KpiProjectTab, { global: { plugins: [router] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('36.96'));
    // ② ③ 已渲染，① performance 卡片未渲染六键
    expect(wrapper.text()).not.toContain('12000.00');
    // 错误文案透出（30001 来自 IPD_COMMON_CODE_TEXTS）
    expect(wrapper.text()).toContain('权限');
    wrapper.unmount();
  });
});
