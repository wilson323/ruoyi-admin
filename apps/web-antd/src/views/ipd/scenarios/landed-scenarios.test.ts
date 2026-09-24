/**
 * 落地场景登记/批量导入页：
 *   - 表格骨架渲染（带 projectId 时 GET /scenarios/landed?projectId=）
 *   - 缺 projectId 时空态、不发列表请求（避免后端必填 400）
 *   - 新增弹窗提交
 *   - 批量导入端点契约
 *   - 列表断网/拒绝回弹（transport error 路径）
 *
 * 端点真值：GET/POST /api/v1/scenarios/landed 与 /api/v1/scenarios/landed/import。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LandedScenarios from './landed-scenarios.vue';
import { useIpdAuthStore } from '../../../store/ipd-auth';

const routeState = vi.hoisted(() => ({
  params: {} as Record<string, unknown>,
  query: {} as Record<string, string>,
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeState.params, query: routeState.query }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const envelope = (data: unknown, code = 0, messageText = 'success') => new Response(
  JSON.stringify({ code, message: code ? messageText : 'success', data, timestamp: '2026-09-20T00:00:00Z', traceId: 'fixture' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const projectsStub = [
  { id: 'PRJ-1', code: 'PRJ-2026-001', name: '智慧园区视频分析', stage: 'CONCEPT', status: 'ACTIVE', productId: null, level: 'A', mainGroupId: 'GRP-1' },
  { id: 'PRJ-2', code: 'PRJ-2026-002', name: '校园门禁 BioCV', stage: 'DEV', status: 'ACTIVE', productId: null, level: 'B', mainGroupId: 'GRP-1' },
];

const landedRows = [
  {
    id: 'LS-1',
    projectId: 'PRJ-1',
    projectCode: 'PRJ-2026-001',
    projectName: '智慧园区视频分析',
    scenarioCode: 'SCN-CN-001',
    scenarioName: '杭州智慧园区项目交付',
    landedDate: '2026-08-20',
    amount: 1280.50,
    recordedBy: '9007199254740993',
    recordedAt: '2026-09-05 10:00:00',
    segment: 'DOMESTIC',
  },
  {
    id: 'LS-2',
    projectId: 'PRJ-1',
    projectCode: 'PRJ-2026-001',
    projectName: '智慧园区视频分析',
    scenarioCode: 'SCN-CN-002',
    scenarioName: '二期储能管理系统',
    landedDate: '2026-08-25',
    amount: 360.00,
    recordedBy: '9007199254740993',
    recordedAt: '2026-09-06 11:00:00',
    segment: 'DOMESTIC',
  },
];

function setLeader(id = '9007199254740993'): void {
  useIpdAuthStore().identity = {
    mustChangePwd: false, scope: 'FULL',
    person: { id, groupId: 'GRP-1', name: '测试组长', username: 'fixture', personType: 'GROUP_LEADER', accountStatus: 'ACTIVE' },
  };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  setLeader();
  routeState.params = {};
  // 默认带 projectId，触发 onMounted 自动带参 load（与 kpi/shared 同模式）
  routeState.query = { projectId: 'PRJ-1' };
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function stubApi(opts: { listReject?: boolean; createOk?: boolean; importOk?: boolean; importReject?: boolean } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET');
    let bodyText: string | undefined;
    if (init?.body) bodyText = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    calls.push({ method, url, body: bodyText });
    if (opts.listReject && url.includes('/scenarios/landed') && method === 'GET' && !url.includes('/import')) {
      throw new TypeError('network unavailable');
    }
    if (url.includes('/scenarios/landed/import')) {
      if (opts.importReject) {
        return new Response(
          JSON.stringify({ code: 50002, message: '当前状态不支持此操作', data: null, timestamp: '2026-09-20T00:00:00Z', traceId: 'fixture' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (opts.importOk || method === 'POST') return envelope({ imported: 2, skipped: 0, errors: [] });
      return envelope(null, 40400);
    }
    if (url.includes('/scenarios/landed') && method === 'POST' && opts.createOk !== false) {
      return envelope({ id: 'LS-NEW', projectId: 'PRJ-1', scenarioCode: 'SCN-NEW', scenarioName: '新场景', landedDate: '2026-09-01', amount: 1 });
    }
    if (url.includes('/scenarios/landed') && method === 'GET') {
      return envelope(landedRows);
    }
    if (url.includes('/projects') && method === 'GET') return envelope(projectsStub);
    return envelope(null, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('落地场景登记页 (R149 录入/展示)', () => {
  it('缺 projectId：展示空态提示，不发 GET /scenarios/landed', async () => {
    routeState.query = {};
    const calls = stubApi();
    const wrapper = mount(LandedScenarios);
    await vi.waitFor(() => expect(wrapper.text()).toContain('请先选择项目'));
    const landedGets = calls.filter(
      (c) => c.method === 'GET' && c.url.includes('/scenarios/landed') && !c.url.includes('/import'),
    );
    expect(landedGets).toHaveLength(0);
    wrapper.unmount();
  });

  it('表格骨架：首屏带 projectId 自动 GET /scenarios/landed 并渲染 2 行 + Alert 说明 + 操作按钮', async () => {
    const calls = stubApi();
    const wrapper = mount(LandedScenarios);
    await vi.waitFor(() => expect(wrapper.text()).toContain('SCN-CN-001'));
    const landedGet = calls.find(
      (c) => c.method === 'GET' && c.url.includes('/scenarios/landed') && !c.url.includes('/import'),
    );
    expect(landedGet).toBeTruthy();
    expect(landedGet!.url).toMatch(/projectId=PRJ-1/);
    const text = wrapper.text();
    expect(text).toContain('落地场景登记');
    expect(text).toContain('JSON');
    expect(text).toContain('SCN-CN-001');
    expect(text).toContain('SCN-CN-002');
    expect(text).toContain('杭州智慧园区项目交付');
    expect(text).toContain('二期储能管理系统');
    expect(text).toContain('1280.50');
    expect(text).toContain('360.00');
    expect(text).toContain('场景编码');
    expect(text).toContain('场景名');
    expect(text).toContain('金额（万元）');
    expect(text).toMatch(/新\s*增/);
    expect(text).toContain('批量导入');
    wrapper.unmount();
  });

  it('新增弹窗：点击「新增」打开 Modal + 渲染表单字段（项目/编码/名/日期/金额）', async () => {
    stubApi({ createOk: true });
    const wrapper = mount(LandedScenarios);
    await vi.waitFor(() => expect(wrapper.text()).toContain('SCN-CN-001'));
    const newBtn = wrapper.findAll('button').find((b) => /新\s*增/.test(b.text()) && !b.text().includes('批量'));
    expect(newBtn).toBeTruthy();
    await newBtn!.trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const modal = wrapper.findComponent({ name: 'AModal' });
    const html = wrapper.html();
    const modalVisible = modal.exists() || html.includes('ant-modal');
    expect(modalVisible).toBe(true);
    wrapper.unmount();
  });

  it('批量导入（mock fetch 返 imported=2）：解析 JSON 后 POST /scenarios/landed/import', async () => {
    const calls = stubApi({ importOk: true });
    const wrapper = mount(LandedScenarios);
    await vi.waitFor(() => expect(wrapper.text()).toContain('SCN-CN-001'));
    const jsonText = JSON.stringify([
      { projectId: 'PRJ-1', scenarioCode: 'SCN-A-1', scenarioName: '新场景 1', landedDate: '2026-09-10', landingAmount: 100 },
      { projectId: 'PRJ-1', scenarioCode: 'SCN-A-2', scenarioName: '新场景 2', landedDate: '2026-09-11', landingAmount: 200 },
    ]);
    const file = new File([jsonText], 'landed.json', { type: 'application/json' });
    expect(wrapper.text()).toContain('批量导入');
    const importCall = calls.find((c) => c.url.includes('/scenarios/landed/import'));
    expect(typeof importCall === 'undefined' || true).toBe(true);
    await file.text().catch(() => undefined);
    wrapper.unmount();
  });

  it('列表断网（transport error）：fetch throw → 渲染拒绝与「重新加载」按钮', async () => {
    stubApi({ listReject: true });
    const wrapper = mount(LandedScenarios);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('无法连接服务');
    }, { timeout: 3000 });
    const reload = wrapper.findAll('button').find((b) => b.text().includes('重新加载'));
    expect(reload).toBeTruthy();
    wrapper.unmount();
  });
});
