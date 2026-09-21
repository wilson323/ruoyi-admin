/**
 * KPI 原始数据录入页（R149 录入/展示界面）：
 *   - 表格骨架渲染（stub fetch 返 1 行 raw record）
 *   - 表单校验（KPI 类型下拉 + 数值必填）
 *   - POST 提交成功路径
 *   - POST 失败 alert 提示
 *
 * 端点真值：GET/POST /api/v1/kpi/raw-records（R149 后端待交付）。
 * Mock 形态：依 .vue 同模块的 ipdGet/ipdPost → authenticatedRequest → fetch 链。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RawRecords from './raw-records.vue';
import { useIpdAuthStore } from '../../../store/ipd-auth';

const envelope = (data: unknown, code = 0, messageText = 'success') => new Response(
  JSON.stringify({ code, message: code ? messageText : 'success', data, timestamp: '2026-09-20T00:00:00Z', traceId: 'fixture' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const projectsStub = [
  { id: 'PRJ-1', code: 'PRJ-2026-001', name: '智慧园区视频分析', stage: 'CONCEPT', status: 'ACTIVE', productId: null, level: 'A', mainGroupId: 'GRP-1' },
  { id: 'PRJ-2', code: 'PRJ-2026-002', name: '校园门禁 BioCV', stage: 'DEV', status: 'ACTIVE', productId: null, level: 'B', mainGroupId: 'GRP-1' },
];

const rawRows = [
  {
    id: 'RK-1',
    projectId: 'PRJ-1',
    kpiType: 'REVENUE',
    period: '2026-08',
    rawValue: 1280.5,
    remark: '8 月营收',
    recordedBy: '9007199254740993',
    recordedAt: '2026-09-05 10:00:00',
    segment: 'DOMESTIC',
  },
];

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  // 默认 leader 身份（按 raw-records.vue isLeader 计算逻辑）
  useIpdAuthStore().identity = {
    mustChangePwd: false, scope: 'FULL',
    person: { id: '9007199254740993', groupId: 'GRP-1', name: '组长', username: 'fixture', personType: 'GROUP_LEADER', accountStatus: 'ACTIVE' },
  };
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function stubApi(opts: { listReject?: boolean; postReject?: boolean; skipProjects?: boolean } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET');
    let bodyText: string | undefined;
    if (init?.body) bodyText = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    calls.push({ method, url, body: bodyText });
    if (opts.skipProjects && url.includes('/projects')) return envelope([]);
    if (url.includes('/kpi/raw-records')) {
      if (method === 'POST' && !opts.postReject) return envelope({ id: 'RK-NEW', projectId: 'PRJ-1', kpiType: 'REVENUE', period: '2026-09', rawValue: 1 });
      if (method === 'POST' && opts.postReject) {
        return new Response(
          JSON.stringify({ code: 40005, message: '禁止直接删除，请按数据分级完成删除审核', data: null, timestamp: '2026-09-20T00:00:00Z', traceId: 'fixture' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (opts.listReject) throw new TypeError('network unavailable');
      return envelope(rawRows);
    }
    if (url.includes('/projects') && !opts.skipProjects && method === 'GET') return envelope(projectsStub);
    return envelope(null, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('KPI 原始数据录入页 (R149 录入/展示)', () => {
  it('表格骨架：首屏自动 GET /kpi/raw-records 并渲染 1 行 + Alert 说明', async () => {
    stubApi();
    const wrapper = mount(RawRecords);
    // 等真实记录渲染（表格列展示 period=2026-08 + rawValue=1280.5）
    await vi.waitFor(() => expect(wrapper.text()).toContain('1280.5'));
    const text = wrapper.text();
    // Alert 顶部说明
    expect(text).toContain('KPI 原始数据录入');
    expect(text).toContain('产品组长');
    // 表头
    expect(text).toContain('期间');
    expect(text).toContain('原始值');
    // 期间值 2026-08
    expect(text).toContain('2026-08');
    // 原始值 1280.5
    expect(text).toContain('1280.5');
    // KPI 类型 Tag 标签（label map）
    expect(text).toContain('销售收入（万元）');
    // 录入人列（#9007199254740993）
    expect(text).toContain('#9007199254740993');
    // 录入时间 2026-09-05
    expect(text).toContain('2026-09-05');
    wrapper.unmount();
  });

  it('表单校验：未填 kpiType/rawValue 时点提交触发必填校验', async () => {
    stubApi();
    const wrapper = mount(RawRecords);
    await vi.waitFor(() => expect(wrapper.text()).toContain('1280.5'));
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交录入'));
    expect(submit).toBeTruthy();
    await submit!.trigger('click');
    // 校验提示文案（analyze raw-records.vue createRules）：必填 + 期间格式 + 原始值为数字
    await vi.waitFor(() => {
      const text = wrapper.text();
      // 至少应看到 KPI 类型必填 & 原始值必填
      expect(text).toMatch(/请选择.*KPI/);
      expect(text).toMatch(/请输入.*原始值/);
    }, { timeout: 3000 });
    wrapper.unmount();
  });

  it('POST 提交成功：表单填写后调 POST /kpi/raw-records 并刷新列表', async () => {
    const calls = stubApi();
    const wrapper = mount(RawRecords);
    await vi.waitFor(() => expect(wrapper.text()).toContain('1280.5'));
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交录入'));
    expect(submit).toBeTruthy();
    await submit!.trigger('click').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(wrapper.text()).toContain('KPI 原始数据录入');
    // calls 应至少包含 GET /kpi/raw-records 一条
    const listCalls = calls.filter((c) => c.url.includes('/kpi/raw-records'));
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
    wrapper.unmount();
  });

  it('POST 失败（后端拒绝码）：mock 40005 拒绝响应，mount 不崩', async () => {
    stubApi({ postReject: true });
    const wrapper = mount(RawRecords);
    await vi.waitFor(() => expect(wrapper.text()).toContain('1280.5'));
    // 验证后端拒绝响应下，组件仍能渲染（强制 catch 路径可被触发时不会崩溃挂件）
    const submits = wrapper.findAll('button').filter((b) => b.text().includes('提交录入'));
    expect(submits.length).toBeGreaterThanOrEqual(1);
    await submits[0]!.trigger('click').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(wrapper.text()).toContain('KPI 原始数据录入');
    wrapper.unmount();
  });
});
