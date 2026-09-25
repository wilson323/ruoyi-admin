// KPI 考核页组件级验证：mock 真实 /api/v1/kpi/* 契约（performance/functional/trend），
// 断言绩效聚合六卡渲染、功能 KPI 来源表 + 权重映射、KPI 趋势 + MISSING 灰显、
// 查询参数形态（period + periods）与真缺口登记文案。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import KpiPage from './index.vue';

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

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 幂等 mock：按 URL 前缀分发，返回结构化数据。 */
function stubApi() {
  setActivePinia(createPinia());
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

describe('IPD KPI page (prototype PerformancePage adaptation)', () => {
  it('renders performance summary six cards with real contract data', async () => {
    stubApi();
    const wrapper = mount(KpiPage);
    // 等真实金额（L1 津贴 12,000.00，load 完成才渲染）—— 不锁 label（label 立即可见会假绿）
    await vi.waitFor(() => expect(wrapper.text()).toContain('12,000.00'));
    // 标题与说明
    expect(wrapper.text()).toContain('KPI 考核');
    expect(wrapper.text()).toContain('按月聚合津贴分档合计');
    // 六键全显
    expect(wrapper.text()).toContain('COMPREHENSIVE');
    expect(wrapper.text()).toContain('L1');
    expect(wrapper.text()).toContain('L5');
    // 金额格式化（formatMoney：8,400.00 / 92.40 等）
    expect(wrapper.text()).toContain('8,400.00');
    expect(wrapper.text()).toContain('92.40');
    wrapper.unmount();
  });

  it('renders functional KPI source table with three sources and weight percent', async () => {
    stubApi();
    const wrapper = mount(KpiPage);
    // 等真实加权贡献（contribution=value×weight，load 完成才渲染）
    await vi.waitFor(() => expect(wrapper.text()).toContain('36.96'));
    // 中文映射
    expect(wrapper.text()).toContain('项目绩效分');
    expect(wrapper.text()).toContain('KPI 计算器');
    expect(wrapper.text()).toContain('津贴台账');
    // 权重百分比（0.40 → 40%；0.20 → 20%）
    expect(wrapper.text()).toContain('40%');
    expect(wrapper.text()).toContain('20%');
    // 原始值
    expect(wrapper.text()).toContain('100.00');
    wrapper.unmount();
  });

  it('renders KPI trend with MISSING rows dimmed and period default 12', async () => {
    const calls = stubApi();
    const wrapper = mount(KpiPage);
    // 等真实数据月份（trend 月份字符串，load 完成才渲染）
    await vi.waitFor(() => expect(wrapper.text()).toContain('2026-04'));
    // 三个月份
    expect(wrapper.text()).toContain('2026-04');
    expect(wrapper.text()).toContain('2026-05');
    expect(wrapper.text()).toContain('2026-06');
    // DATA / MISSING 状态
    expect(wrapper.text()).toContain('缺数月');
    expect(wrapper.text()).toContain('有数');
    // MISSING 行的 class
    const missingRow = wrapper.findAll('tr').find((tr) => tr.text().includes('2026-05'));
    expect(missingRow?.classes()).toContain('trend-missing');
    // 默认 periods=12
    const trendCall = calls.find((call) => call.url.includes('/kpi/trend'));
    expect(trendCall?.url).toContain('periods=12');
    wrapper.unmount();
  });

  it('queries with month parameter and changes periods on selection', async () => {
    const calls = stubApi();
    const wrapper = mount(KpiPage);
    // 等真实数据（4 月趋势行 value=78.50，load 完成才渲染）—— 不锁 label
    await vi.waitFor(() => expect(wrapper.text()).toContain('78.50'));
    // period 形态
    const perfCall = calls.find((call) => call.url.includes('/kpi/performance'));
    expect(perfCall?.url).toMatch(/period=\d{4}-\d{2}/);
    const funcCall = calls.find((call) => call.url.includes('/kpi/functional'));
    expect(funcCall?.url).toMatch(/period=\d{4}-\d{2}/);
    // 切换 periods=24 触发查询
    const select = wrapper.find('select');
    await select.setValue('24');
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click');
    await vi.waitFor(() => {
      const trend24 = calls.filter((call) => call.url.includes('/kpi/trend'));
      expect(trend24.some((call) => call.url.includes('periods=24'))).toBe(true);
    });
    wrapper.unmount();
  });

  /* ============ R217-GAP-F11：生效规则说明面板（懒拉 + 只读两列表 + 三态） ============ */

  it('GAP-F11 面板：首屏不请求 /kpi/rules（懒拉防冷启动多请求），展开后才拉并渲染 ruleKey/ruleValue 两列', async () => {
    const calls = stubApi();
    const wrapper = mount(KpiPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('12,000.00'));
    expect(calls.some((c) => c.url.includes('/kpi/rules'))).toBe(false); // 未展开零请求
    // 注：既有 stubApi 对 /kpi/rules 走 fallback response(null, 40400)→data null→守卫归 []→空态；
    // 本用例先证「展开触发了请求」，行渲染见下一条独立 stub 用例。
    const toggle = wrapper.findAll('button').find((b) => b.text().includes('展开'));
    expect(toggle, '「展开」按钮应存在').toBeDefined();
    await toggle!.trigger('click');
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/kpi/rules'))).toBe(true));
    wrapper.unmount();
  });

  it('GAP-F11 面板：规则行渲染且 ruleValue 原样展示（0.15 不被数值化、19 位不截断）', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/kpi/performance')) return response(performanceSummary);
      if (url.includes('/kpi/functional')) return response(functionalSources);
      if (url.includes('/kpi/trend')) return response(trendPoints);
      if (url.includes('/kpi/rules')) return response([
        { ruleKey: 'kpi.weight.project-score', ruleValue: '0.15' },
        { ruleKey: 'kpi.id.snowflake', ruleValue: '1234567890123456789' },
      ]);
      return response(null, 40400);
    }));
    const wrapper = mount(KpiPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('12,000.00'));
    await wrapper.findAll('button').find((b) => b.text().includes('展开'))!.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('kpi.weight.project-score');
      expect(wrapper.text()).toContain('0.15');
      expect(wrapper.text()).toContain('1234567890123456789'); // 非 1234567890123456800（number 化截断即红）
    });
    wrapper.unmount();
  });

  it('GAP-F11 面板：空源渲染「当前无生效规则快照」空态，不报错（javadoc 空列表语义）', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/kpi/performance')) return response(performanceSummary);
      if (url.includes('/kpi/functional')) return response(functionalSources);
      if (url.includes('/kpi/trend')) return response(trendPoints);
      if (url.includes('/kpi/rules')) return response([]);
      return response(null, 40400);
    }));
    const wrapper = mount(KpiPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('12,000.00'));
    await wrapper.findAll('button').find((b) => b.text().includes('展开'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('当前无生效规则快照'));
    expect(wrapper.text()).not.toContain('加载失败');
    wrapper.unmount();
  });

  it('GAP-F11 面板：加载失败不吞错，错误态显示后端原文（403+30001 透传链）', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/kpi/performance')) return response(performanceSummary);
      if (url.includes('/kpi/functional')) return response(functionalSources);
      if (url.includes('/kpi/trend')) return response(trendPoints);
      if (url.includes('/kpi/rules')) return new Response(
        JSON.stringify({ code: 30001, message: '无权访问该项目', data: null, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
      return response(null, 40400);
    }));
    const wrapper = mount(KpiPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('12,000.00'));
    await wrapper.findAll('button').find((b) => b.text().includes('展开'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('无权访问该项目'));
    wrapper.unmount();
  });

  it('renders the registration section for prototype features without backend', async () => {
    stubApi();
    const wrapper = mount(KpiPage);
    // 等真实数据（L1 卡有具体金额才说明 load 已完）
    await vi.waitFor(() => expect(wrapper.text()).toContain('12,000.00'));
    // 真缺口登记
    expect(wrapper.text()).toContain('待后端补齐的能力');
    expect(wrapper.text()).toContain('原型 12 项项目 KPI 表格');
    expect(wrapper.text()).toContain('KpiDrawer');
    expect(wrapper.text()).toContain('共担 KPI 双组长确认读端点');
    wrapper.unmount();
  });
});
