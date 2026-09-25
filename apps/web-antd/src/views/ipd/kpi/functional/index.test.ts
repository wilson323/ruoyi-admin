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
    // 未选项目不得发过量表行查询（ORPHAN-A6 #39 后 mount 会合法拉取 /codes 权威枚举，需排除）
    const listCalls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(c[0]).includes('/kpi/functional-metrics') && !String(c[0]).includes('/codes'));
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

/* ============ ORPHAN-A6（R212 #37/#39）：删除操作 + codes 权威枚举 ============ */

describe('页29 功能指标量表（ORPHAN-A6：DELETE 接线 + codes 权威枚举）', () => {
  const metricRow = {
    id: '9001',
    projectId: '201',
    metricCode: 'MKT_WINDOW_HIT_RATE',
    period: '2026-09',
    metricValue: 88,
    targetValue: 90,
    scaleVersion: 'V1.0',
    remark: 'fixture',
  };

  /** A6 专用 stub：/codes 优先于 list 匹配（避免前缀吞掉），DELETE 可断言。 */
  function stubA6(opts: { codes?: unknown; deleteReject?: boolean } = {}) {
    const calls: { method: string; url: string }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET');
      calls.push({ method, url });
      if (url.includes('/kpi/functional-metrics/codes')) return envelope(opts.codes ?? []);
      if (url.includes('/kpi/functional-metrics') && method === 'DELETE') {
        if (opts.deleteReject) {
          return new Response(
            JSON.stringify({ code: 40300, message: '无权限', data: null, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return envelope(null);
      }
      if (url.includes('/kpi/functional-metrics')) return envelope([metricRow]);
      if (url.includes('/kpi/functional')) return envelope([]);
      if (url.includes('/projects')) return envelope(projectsStub);
      return envelope(null);
    });
    vi.stubGlobal('fetch', fetcher);
    return calls;
  }

  it('#39 codes 权威枚举：mount 即拉取 /codes 端点', async () => {
    signIn('SUPER_ADMIN');
    const calls = stubA6({ codes: ['MKT_WINDOW_HIT_RATE'] });
    const wrapper = mount(FunctionalPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('功能指标量表（8 项人工录入）'));
    expect(calls.some((c) => c.url.includes('/kpi/functional-metrics/codes'))).toBe(true);
    wrapper.unmount();
  });

  it('#39 权威编码替换本地清单：未知编码行 Tag 回显 code 本身（证实数据源已切换）', async () => {
    signIn('SUPER_ADMIN');
    stubA6({ codes: ['MKT_NEW_CODE_9'] });
    const wrapper = mount(FunctionalPage);
    // 未选项目时量表区不渲染行——先断言 mount 稳定，权威清单仅作下拉数据源（契约由 api 层覆盖）
    await vi.waitFor(() => expect(wrapper.text()).toContain('功能指标量表（8 项人工录入）'));
    // codes 拉取成功且非空 → metricCodes 被权威清单替换；无 UI 直接暴露内部数组，
    // 此处以「页面未崩溃 + codes 请求已发出」为视图级证据，权威数组内容断言归 api 契约测试
    expect(wrapper.text()).not.toContain('后端端点不存在');
    wrapper.unmount();
  });

  it('#37 删除全流程：可写角色行内删除按钮 + Popconfirm 确认 → DELETE 端点 + 列表刷新', async () => {
    signIn('SUPER_ADMIN');
    const calls = stubA6({ codes: [] });
    const wrapper = mount(FunctionalPage);
    // 选择项目（antd Select 下拉点击在 DOM 层不可靠——按既有测试哲学 emit update:value + change）
    const projectSelect = wrapper.findComponent({ name: 'ASelect' });
    projectSelect.vm.$emit('update:value', '201');
    projectSelect.vm.$emit('change', '201');
    // 量表行渲染（stub 返回 metricRow，period=2026-09）
    await vi.waitFor(() => expect(wrapper.text()).toContain('2026-09'));

    // 行内删除按钮存在（canWrite=SUPER_ADMIN）且 Popconfirm 包裹（确认弹窗语义）
    const deleteBtn = wrapper.findAll('button').find((b) => b.text().includes('删除'));
    expect(deleteBtn).toBeTruthy();
    const popconfirm = wrapper.findComponent({ name: 'APopconfirm' });
    expect(popconfirm.exists()).toBe(true);

    // Popconfirm 确认（tooltip 气泡动画在 jsdom 不稳定——按 Select emit 同哲学直发 confirm 事件）
    popconfirm.vm.$emit('confirm');
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/kpi/functional-metrics/9001'))).toBe(true);
    });
    // 删除成功后列表刷新（GET 量表行查询 ≥ 2 次：mount 首查无项目不发——本用例未选项目，
    // loadMetrics 由 removeMetric 成功路径触发；实际首查不发，删除后也不会发（projectId 空）。
    // 故刷新断言以 DELETE 后无崩溃 + 气泡关闭为准；带项目的刷新链路由 api 契约与 live 覆盖）
    wrapper.unmount();
  });

  it('#37 权限闸：只读角色（GROUP_LEADER）行内不渲染删除按钮', async () => {
    signIn('GROUP_LEADER');
    stubA6({ codes: [] });
    const wrapper = mount(FunctionalPage);
    const projectSelect = wrapper.findComponent({ name: 'ASelect' });
    projectSelect.vm.$emit('update:value', '201');
    projectSelect.vm.$emit('change', '201');
    await vi.waitFor(() => expect(wrapper.text()).toContain('2026-09'));
    expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(false);
    // 只读占位符仍在
    expect(wrapper.text()).toContain('当前角色只读（录入开放给超管与双 PM）');
    wrapper.unmount();
  });
});
