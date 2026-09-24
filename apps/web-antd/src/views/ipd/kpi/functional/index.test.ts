/**
 * 页29 功能 KPI（A2 P1 增量）：功能指标量表录入入口的页面级契约。
 *   - 写入角色（超管 / 双 PM）可见「录入 / 编辑」入口与可录入标记
 *   - 只读角色（产品组长）无录入入口，仅可读（后端 ipd:kpi:config:query）
 *   - 未选项目时空态文案；只读区（P0-10.29）渲染与失败降级不回归
 *   - 8 项功能指标口径（DOC-01 §4：市场 4 + 研发 4）与后端编码一致
 *
 * 端点真值：GET /api/v1/kpi/functional（既有）+ GET/PUT /api/v1/kpi/functional-metrics（A2 P1）。
 * Mock 形态：与 .vue 同模块的 ipdGet/ipdPut → authenticatedRequest → fetch 链。
 * 注：PUT 提交链（body 白名单 / 拒绝码）由 api/ipd/kpi.test.ts 覆盖（antd Select 交互在 DOM 断言层不可靠）。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FunctionalPage from './index.vue';
import { KPI_FUNCTIONAL_METRIC_CODES } from '../../../../api/ipd/kpi';
import { useIpdAuthStore } from '../../../../store/ipd-auth';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-21T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const projectsStub = [
  { id: '201', code: 'PRJ-2026-001', name: '智慧园区视频分析', status: 'ACTIVE' },
];

const functionalRows = [
  { source: 'ALLOWANCE_LEDGER', value: 92, weight: 0.5, contribution: 46 },
];

function signIn(personType: 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN') {
  useIpdAuthStore().identity = {
    mustChangePwd: false,
    scope: 'FULL',
    person: { id: '9007199254740993', groupId: 'GRP-1', name: 'fixture', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

function stubApi(opts: { functionalReject?: boolean } = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: String(init?.method ?? 'GET'), url });
    if (url.includes('/kpi/functional-metrics')) return envelope([]);
    if (url.includes('/kpi/functional')) {
      if (opts.functionalReject) throw new TypeError('network unavailable');
      return envelope(functionalRows);
    }
    if (url.includes('/projects')) return envelope(projectsStub);
    return envelope(null);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('页29 功能指标量表录入入口（A2 P1）', () => {
  it('写入角色（市场 PM）：可见「录入 / 编辑」入口 + 可录入标记', async () => {
    signIn('MARKET_PM');
    const calls = stubApi();
    const wrapper = mount(FunctionalPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('功能指标量表（8 项人工录入）'));
    const text = wrapper.text();
    expect(text).toContain('可录入');
    expect(wrapper.findAll('button').some((b) => b.text().includes('录入'))).toBe(true);
    expect(text).toContain('ipd:kpi:config');
    // 首屏：只读区 + 项目下拉各拉一次
    expect(calls.some((c) => c.url.includes('/kpi/functional?'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/projects'))).toBe(true);
    wrapper.unmount();
  });
  it('只读角色（产品组长）：无「录入 / 编辑」入口，仅只读标记', async () => {
    signIn('GROUP_LEADER');
    stubApi();
    const wrapper = mount(FunctionalPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('功能指标量表（8 项人工录入）'));
    const text = wrapper.text();
    expect(text).toContain('只读');
    expect(text).toContain('当前角色只读（录入开放给超管与双 PM）');
    expect(wrapper.findAll('button').some((b) => b.text().includes('录入'))).toBe(false);
    // 只读角色不得出现可写标记
    expect(wrapper.findAll('button').some((b) => b.text().includes('保存'))).toBe(false);
    wrapper.unmount();
  });

  it('未选项目：量表空态提示先选项目', async () => {
    signIn('RD_PM');
    stubApi();
    const wrapper = mount(FunctionalPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('功能指标量表（8 项人工录入）'));
    expect(wrapper.text()).toContain('请先在上方选择项目，再加载功能指标量表');
    // 未选项目不得发过量表查询
    const listCalls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(c[0]).includes('/kpi/functional-metrics'));
    expect(listCalls).toHaveLength(0);
    wrapper.unmount();
  });

  it('只读区（P0-10.29）渲染不回归：来源文案 + 加权贡献', async () => {
    signIn('MARKET_PM');
    stubApi();
    const wrapper = mount(FunctionalPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('46'));
    expect(wrapper.text()).toContain('津贴台账');
    wrapper.unmount();
  });

  it('只读区断网降级：仍挂载且给出网络文案（不把 transport 误报为业务错误）', async () => {
    signIn('MARKET_PM');
    stubApi({ functionalReject: true });
    const wrapper = mount(FunctionalPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务，请检查网络后重试'));
    expect(wrapper.text()).toContain('功能指标量表（8 项人工录入）');
    wrapper.unmount();
  });

  it('8 项功能指标口径：市场 4 项 + 研发 4 项（DOC-01 §4）', () => {
    expect(KPI_FUNCTIONAL_METRIC_CODES).toHaveLength(8);
    const codes = KPI_FUNCTIONAL_METRIC_CODES.map((item) => item.value);
    expect(codes.slice(0, 4).every((code) => code.startsWith('MKT_'))).toBe(true);
    expect(codes.slice(4).every((code) => code.startsWith('RD_'))).toBe(true);
    expect(new Set(codes).size).toBe(8);
    expect(codes).toContain('RD_QUALITY_DEFECT_RATE');
  });
});
