// 变更管理页组件级验证：mock 真实 P2-6.1 契约（requirement-changes 读/建/提交/签署），
// 断言原型 ChangesPage 一比一结构、双PM双签状态机按钮、创建校验与端点调用形态。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type RequirementChange } from '../../../api/ipd/change';
import Change from './index.vue';

const response = (data: unknown, status = 200, code = 0, message = '') => new Response(
  // R215-E2E-B：message 置空 = 模拟后端无 message，用例走「查表链」验证；传非空 message 的用例验证「后端原文优先透传」（见 Flow 6 降级组）。
  JSON.stringify({ code, message, data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

/** 响应闸门：把指定端点的响应挂起，模拟慢网/在途窗口，供防抖与加载态用例控制时序。 */
interface DeferredGate { promise: Promise<void>; resolve: () => void }

function gate(): DeferredGate {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const project = {
  id: '7', code: 'P-007', name: '演示项目', productId: '10', templateType: 'SOFTWARE',
  level: 'B', status: 'ACTIVE', currentStage: 'DEV',
};
const changes: RequirementChange[] = [
  { afterSnapshot: null, beforeSnapshot: '{"scope":"含离线模块"}', changeType: '功能范围调整', createTime: null, id: '31', projectId: '7', reason: '客户要求砍掉离线模块', requirementId: '8', signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' },
  { afterSnapshot: '{"latency":"200ms"}', beforeSnapshot: null, changeType: '性能目标修订', createTime: null, id: '32', projectId: '7', reason: 'Benchmark 复测后定值', requirementId: '9', signatures: 'MARKET_PM:12=APPROVE;RD_PM:34=APPROVE', status: 'APPROVED' },
  { afterSnapshot: null, beforeSnapshot: null, changeType: null, createTime: null, id: '33', projectId: '7', reason: '占位草稿', requirementId: null, signatures: null, status: 'DRAFT' },
];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

interface ApiCall { body: unknown; method: string; url: string }

interface ActionResponseOption {
  code?: number;
  data: RequirementChange | null;
  message?: string;
  ok?: boolean;
  status?: number;
}

interface StubOptions {
  projectsResponse?: { data: unknown[]; status?: number; code?: number };
  changesResponse?: { data: { records: RequirementChange[]; total: number } | null; status?: number; code?: number; ok?: boolean };
  demandsResponse?: { data: { demands: unknown[]; total: number } | null; status?: number; code?: number; ok?: boolean };
  createResponse?: ActionResponseOption;
  submitResponse?: ActionResponseOption;
  signResponse?: ActionResponseOption;
  /** 命中 match 的请求先挂起，待 gate.resolve() 后才回响应（在途窗口可重复点击/观察加载态）。 */
  deferred?: Array<{ gate: DeferredGate; match: (method: string, url: string) => boolean }>;
}

function stubApi(options: StubOptions = {}) {
  setActivePinia(createPinia());
  const calls: ApiCall[] = [];
  // 服务端状态机语义：动作成功后列表 GET 反映新状态（与真实后端一致）
  const rows = changes.map((row) => ({ ...row }));
  const apply = (id: string, patch: Record<string, unknown>) => {
    const row = rows.find((item) => item.id === id);
    if (row) Object.assign(row, patch);
    return response({ ...row });
  };
  // 动作端点（create/submit/sign）可注入响应选项；无注入时走下方状态机默认语义
  const actionResponse = (option: ActionResponseOption | undefined, fallback: () => Response): Response => {
    if (!option) return fallback();
    if (option.ok === false) throw new TypeError('network unavailable');
    if (!option.data) return response(null, option.status ?? 500, option.code ?? 90001, option.message ?? '');
    return response(option.data, option.status ?? 200, option.code ?? 0, option.message ?? '');
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method, url });
    const held = options.deferred?.find((item) => item.match(method, url));
    if (held) await held.gate.promise;
    if (method === 'GET' && url === '/api/v1/projects') {
      if (options.projectsResponse) {
        return response(options.projectsResponse.data, options.projectsResponse.status ?? 200, options.projectsResponse.code ?? 0);
      }
      return response([project]);
    }
    if (method === 'GET' && url.startsWith('/api/v1/demands?')) {
      if (options.demandsResponse) {
        if (options.demandsResponse.ok === false) throw new TypeError('network unavailable');
        return response(options.demandsResponse.data, options.demandsResponse.status ?? 200, options.demandsResponse.code ?? 0);
      }
      return response({ demands: [{ id: '5', title: '测试需求条目', productId: '10', status: 'SUBMITTED', source: 'INTERNAL', customerName: null, marketPmId: null, marketPmName: null, projectId: null, rdPmId: null, rdPmName: null, submitterName: null, createdAt: null }], total: 1 });
    }
    if (method === 'GET' && url.startsWith('/api/v1/requirement-changes?')) {
      if (options.changesResponse) {
        if (options.changesResponse.ok === false) throw new TypeError('network unavailable');
        if (!options.changesResponse.data) {
          return response(null, options.changesResponse.status ?? 500, options.changesResponse.code ?? 90001);
        }
        return response(options.changesResponse.data, options.changesResponse.status ?? 200, options.changesResponse.code ?? 0);
      }
      return response({ records: rows.map((row) => ({ ...row })), total: rows.length });
    }
    if (method === 'POST' && url === '/api/v1/requirement-changes') {
      return actionResponse(options.createResponse, () => {
        // noUncheckedIndexedAccess：不 spread 数组元素（类型含 undefined），显式完整构造
        const created: RequirementChange = {
          afterSnapshot: null, beforeSnapshot: null, changeType: '测试变更', createTime: null,
          id: '40', projectId: '7', reason: '因为渠道反馈', requirementId: '5', signatures: null, status: 'DRAFT',
        };
        rows.push(created);
        return response(created);
      });
    }
    if (method === 'PUT' && url === '/api/v1/requirement-changes/33/submit') {
      return actionResponse(options.submitResponse, () => apply('33', { status: 'PENDING_SIGN' }));
    }
    if (method === 'PUT' && url.startsWith('/api/v1/requirement-changes/') && url.includes('/sign?decision=')) {
      return actionResponse(options.signResponse, () => {
        if (url === '/api/v1/requirement-changes/33/sign?decision=APPROVE') return apply('33', { signatures: 'MARKET_PM:12=APPROVE', status: 'APPROVED' });
        if (url === '/api/v1/requirement-changes/31/sign?decision=REJECT') return apply('31', { signatures: 'MARKET_PM:12=REJECT', status: 'REJECTED' });
        // #31 单方 APPROVE：服务端仅登记一签，整体仍为 PENDING_SIGN（BR-GATE-07 双签语义）
        if (url === '/api/v1/requirement-changes/31/sign?decision=APPROVE') return apply('31', { signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' });
        return response(null, 404, 40400);
      });
    }
    return response(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

async function mountChange() {
  const wrapper = mount(Change);
  await vi.waitFor(() => expect(wrapper.text()).toContain('变更单 #31'));
  return wrapper;
}

describe('IPD change page (prototype ChangesPage)', () => {
  it('renders the prototype board with dual-signature cards', async () => {
    stubApi();
    const wrapper = await mountChange();
    // 原型页头/选择器/metric 四格
    expect(wrapper.text()).toContain('变更管理');
    expect(wrapper.text()).toContain('发起变更');
    expect(wrapper.text()).toContain('已加载 3 条变更单');
    expect(wrapper.findAll('.metric-strip .metric strong').map((node) => node.text())).toEqual(['3', '1', '1', '0']);
    expect(wrapper.text()).toContain('变更申请单 · 演示项目');
    // #31 待双签：市场PM 已同意、研发PM 待签，双按钮
    expect(wrapper.text()).toContain('变更单 #31');
    expect(wrapper.text()).toContain('功能范围调整');
    expect(wrapper.text()).toContain('关联需求 #8');
    expect(wrapper.text()).toContain('待双签');
    expect(wrapper.text()).toContain('已同意');
    expect(wrapper.text()).toContain('待签');
    expect(wrapper.text()).toContain('客户要求砍掉离线模块');
    // #32 已批准：双签齐，只留快照明细；#33 草稿：空类型与占位符
    expect(wrapper.text()).toContain('已批准');
    expect(wrapper.findAll('details.snapshot-details').length).toBe(2);
    expect(wrapper.text()).toContain('变更影响快照（范围/成本/时限/质量四维度）');
    expect(wrapper.text()).toContain('未命名变更');
    expect(wrapper.text()).toContain('关联需求 #—');
    // 五节点链面板外壳如实登记，无假数据
    expect(wrapper.text()).toContain('需求变更五节点链');
    expect(wrapper.text()).toContain('本仓变更模型为双PM双签两节点');
    wrapper.unmount();
  });

  it('validates the create modal before hitting the API', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    // 空提交：关联需求是 select 必填，未选择时报必填错误
    await form.trigger('submit');
    expect(wrapper.text()).toContain('变更类型、变更原因与关联需求 ID 均为必填。');
    // 选择需求 + 填写变更类型与原因后可提交（select 只能选数字ID，不再触发数字校验断言）
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes')).toBe(true));
    await wrapper.findAll('button').find((button) => button.text() === '取消')?.trigger('click');
    expect(wrapper.text()).not.toContain('发起需求变更');
    wrapper.unmount();
  });

  it('creates a draft through the real endpoint', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('发起需求变更'));
    const post = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes');
    expect(post?.body).toMatchObject({ changeType: '测试变更', projectId: '7', reason: '因为渠道反馈', requirementId: '5' });
    wrapper.unmount();
  });

  it('submits and signs through the real dual-signature endpoints', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '提交双签')?.trigger('click');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/v1/requirement-changes/33/submit')).toBe(true));
    // 每次动作后 loadChanges 重渲染列表，点击前必须重新查询 DOM
    await vi.waitFor(() => {
      const sign = wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '同意签署');
      expect(sign).toBeDefined();
    });
    await wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '同意签署')?.trigger('click');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/v1/requirement-changes/33/sign?decision=APPROVE')).toBe(true));
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝')?.trigger('click');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/v1/requirement-changes/31/sign?decision=REJECT')).toBe(true));
    wrapper.unmount();
  });

  // ========== Flow 1: 列表/空态/错误/项目切换 ==========

  it('shows empty state when the project has no changes', async () => {
    stubApi({ changesResponse: { data: { records: [], total: 0 }, ok: true } });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 0 条变更单'));
    expect(wrapper.text()).toContain('暂无变更申请单');
    expect(wrapper.text()).toContain('该项目尚未发起需求变更');
    // 空态时 metric 计数全 0
    expect(wrapper.findAll('.metric-strip .metric strong').map((node) => node.text())).toEqual(['0', '0', '0', '0']);
    wrapper.unmount();
  });

  it('renders error alert when listRequirementChanges fails (transport)', async () => {
    stubApi({ changesResponse: { data: null, ok: false } });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
    // Alert 组件渲染：description prop 文本可断言（happy-dom slot 不可见）
    const alert = wrapper.find('.chg-alert');
    expect(alert.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders error alert when listProjects fails', async () => {
    stubApi({ projectsResponse: { data: [], status: 500, code: 90001 } });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('数据不存在或服务暂时不可用'));
    // 没有项目可选 → 触发 loadChanges 的 activeId 空分支 → 列表/总量为 0
    expect(wrapper.text()).toContain('已加载 0 条变更单');
    wrapper.unmount();
  });

  it('switches project and reloads changes for the newly selected project', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    // 切到第二个项目需要 mock 两条记录；这里通过 stubApi 把列表回放检查
    const select = wrapper.get('.change-project-selector select');
    // 直接改 activeId 触发 watch → loadChanges + loadDemands 重跑
    await select.setValue('7');
    // 默认 fixtures 已覆盖同一 projectId；至少应再次触发 GET /requirement-changes 与 /demands
    const changesCalls = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?'));
    expect(changesCalls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it('counts DRAFT/PENDING_SIGN/APPROVED/REJECTED in the metric strip', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'b', createTime: null, id: '2', projectId: '7', reason: 'r', requirementId: '2', signatures: null, status: 'DRAFT' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'c', createTime: null, id: '3', projectId: '7', reason: 'r', requirementId: '3', signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'd', createTime: null, id: '4', projectId: '7', reason: 'r', requirementId: '4', signatures: 'MARKET_PM:12=APPROVE;RD_PM:34=APPROVE', status: 'APPROVED' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'e', createTime: null, id: '5', projectId: '7', reason: 'r', requirementId: '5', signatures: 'MARKET_PM:12=REJECT', status: 'REJECTED' },
          ],
          total: 5,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 5 条变更单'));
    // metric-strip 顺序：全部 / 待双签 / 已批准 / 已驳回
    expect(wrapper.findAll('.metric-strip .metric strong').map((node) => node.text())).toEqual(['5', '1', '1', '1']);
    wrapper.unmount();
  });

  // ========== Flow 3: 状态机 + 动作链 ==========

  it('renders status pill labels via ipd-state-machines CHANGE_STATUS_MACHINE', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'b', createTime: null, id: '2', projectId: '7', reason: 'r', requirementId: '2', signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'c', createTime: null, id: '3', projectId: '7', reason: 'r', requirementId: '3', signatures: 'MARKET_PM:12=APPROVE;RD_PM:34=APPROVE', status: 'APPROVED' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'd', createTime: null, id: '4', projectId: '7', reason: 'r', requirementId: '4', signatures: 'MARKET_PM:12=REJECT', status: 'REJECTED' },
          ],
          total: 4,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 4 条变更单'));
    const pills = wrapper.findAll('i.status-pill');
    expect(pills.length).toBe(4);
    // 状态机 SSOT：草稿 / 待双签 / 已批准 / 已驳回
    expect(pills.map((pill) => pill.text())).toEqual(['草稿', '待双签', '已批准', '已驳回']);
    wrapper.unmount();
  });

  it('renders the correct status-pill tone class per state (approved/pending/rejected/draft)', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'b', createTime: null, id: '2', projectId: '7', reason: 'r', requirementId: '2', signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'c', createTime: null, id: '3', projectId: '7', reason: 'r', requirementId: '3', signatures: 'MARKET_PM:12=APPROVE;RD_PM:34=APPROVE', status: 'APPROVED' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'd', createTime: null, id: '4', projectId: '7', reason: 'r', requirementId: '4', signatures: 'MARKET_PM:12=REJECT', status: 'REJECTED' },
          ],
          total: 4,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 4 条变更单'));
    const pills = wrapper.findAll('i.status-pill');
    // DRAFT 不在 STATUS_TONE 表里，className 不含任何 tone
    expect(pills[0]?.classes()).not.toContain('approved');
    expect(pills[0]?.classes()).not.toContain('pending');
    expect(pills[0]?.classes()).not.toContain('rejected');
    expect(pills[1]?.classes()).toContain('pending');
    expect(pills[2]?.classes()).toContain('approved');
    expect(pills[3]?.classes()).toContain('rejected');
    wrapper.unmount();
  });

  it('shows only submit button for DRAFT, no buttons for APPROVED/REJECTED', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'c', createTime: null, id: '3', projectId: '7', reason: 'r', requirementId: '3', signatures: 'MARKET_PM:12=APPROVE;RD_PM:34=APPROVE', status: 'APPROVED' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'd', createTime: null, id: '4', projectId: '7', reason: 'r', requirementId: '4', signatures: 'MARKET_PM:12=REJECT', status: 'REJECTED' },
          ],
          total: 3,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 3 条变更单'));
    const articles = wrapper.findAll('.change-cards article');
    const draftBtns = articles[0]?.findAll('.decision-buttons button').map((btn) => btn.text());
    expect(draftBtns).toEqual(['提交双签']);
    const approvedBtns = articles[1]?.findAll('.decision-buttons button') ?? [];
    expect(approvedBtns.length).toBe(0);
    const rejectedBtns = articles[2]?.findAll('.decision-buttons button') ?? [];
    expect(rejectedBtns.length).toBe(0);
    wrapper.unmount();
  });

  it('shows reject + approve buttons for PENDING_SIGN', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' },
          ],
          total: 1,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    const btns = wrapper.findAll('.change-cards article')[0]?.findAll('.decision-buttons button').map((btn) => btn.text());
    expect(btns).toEqual(['拒绝', '同意签署']);
    wrapper.unmount();
  });

  it('submit failure surfaces a projectErrorText message', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    // 把 submit 端点替换为 500 抛错
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method, url });
      if (method === 'PUT' && url === '/api/v1/requirement-changes/33/submit') {
        return response(null, 500, 90001);
      }
      // 其他端点走原默认
      if (method === 'GET' && url === '/api/v1/projects') return response([project]);
      if (method === 'GET' && url.startsWith('/api/v1/demands?')) return response({ demands: [], total: 0 });
      if (method === 'GET' && url.startsWith('/api/v1/requirement-changes?')) {
        return response({ records: changes.map((row) => ({ ...row })), total: changes.length });
      }
      return response(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    await wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '提交双签')?.trigger('click');
    // 错误走 message.error → antdv message，会注入到 document.body
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('数据不存在或服务暂时不可用');
    });
    wrapper.unmount();
  });

  it('sign REJECT success path triggers reload', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    const before = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length;
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝')?.trigger('click');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/v1/requirement-changes/31/sign?decision=REJECT')).toBe(true));
    // loadChanges 在 sign 成功后被调用
    await vi.waitFor(() => {
      const after = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length;
      expect(after).toBeGreaterThan(before);
    });
    wrapper.unmount();
  });

  it('sign failure surfaces a projectErrorText message via message.error', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method, url });
      if (method === 'PUT' && url.startsWith('/api/v1/requirement-changes/') && url.includes('/sign')) {
        return response(null, 500, 90001);
      }
      if (method === 'GET' && url === '/api/v1/projects') return response([project]);
      if (method === 'GET' && url.startsWith('/api/v1/demands?')) return response({ demands: [], total: 0 });
      if (method === 'GET' && url.startsWith('/api/v1/requirement-changes?')) {
        return response({ records: changes.map((row) => ({ ...row })), total: changes.length });
      }
      return response(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝')?.trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('数据不存在或服务暂时不可用');
    });
    wrapper.unmount();
  });

  // ========== Flow 4: 创建/编辑 ==========

  it('closes the create modal via the cancel button', async () => {
    stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    await wrapper.findAll('button').find((button) => button.text() === '取消')?.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('发起需求变更'));
    wrapper.unmount();
  });

  it('closes the create modal via the X close button in modal-head', async () => {
    stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    // X 按钮是 .modal-head > button（非 secondary-button）
    await wrapper.get('.modal-head button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('发起需求变更'));
    wrapper.unmount();
  });

  it('closes the create modal via backdrop self-click', async () => {
    stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    // backdrop 自身点击（@click.self）：trigger('click') 会冒泡到 backdrop，需模拟 self
    const backdrop = wrapper.get('.modal-backdrop');
    backdrop.element.dispatchEvent(new Event('click', { bubbles: false }));
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('发起需求变更'));
    wrapper.unmount();
  });

  it('does not close the create modal when clicking inside the form', async () => {
    stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    await wrapper.get('form.create-modal').trigger('click');
    expect(wrapper.text()).toContain('发起需求变更');
    wrapper.unmount();
  });

  it('resets form fields when reopening the create modal', async () => {
    stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('临时变更');
    await form.findAll('textarea')[0]?.setValue('临时原因');
    // 关闭并重新打开
    await wrapper.findAll('button').find((button) => button.text() === '取消')?.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('发起需求变更'));
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    // openModal 把 createForm 重置为全空串
    const reopened = wrapper.get('form.create-modal');
    expect((reopened.findAll('input')[0]?.element as HTMLInputElement).value).toBe('');
    expect((reopened.findAll('textarea')[0]?.element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('allows leaving snapshot fields blank on draft creation', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('功能范围调整');
    await form.findAll('textarea')[0]?.setValue('客户要求砍掉离线模块');
    // 前后快照两 textarea 留空（textarea[1] beforeSnapshot、textarea[2] afterSnapshot）
    expect(form.findAll('textarea').length).toBeGreaterThanOrEqual(3);
    await form.trigger('submit');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes')).toBe(true));
    const post = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes');
    // component 端把空快照 trim 后传 null
    expect(post?.body).toMatchObject({ afterSnapshot: null, beforeSnapshot: null });
    wrapper.unmount();
  });

  it('submits with full snapshot data when both before/after are filled', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('性能目标修订');
    await form.findAll('textarea')[0]?.setValue('Benchmark 复测');
    // textarea[1] = beforeSnapshot、textarea[2] = afterSnapshot
    await form.findAll('textarea')[1]?.setValue('{"scope":"含离线"}');
    await form.findAll('textarea')[2]?.setValue('{"scope":"不含离线"}');
    await form.trigger('submit');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes')).toBe(true));
    const post = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes');
    expect(post?.body).toMatchObject({
      afterSnapshot: '{"scope":"不含离线"}',
      beforeSnapshot: '{"scope":"含离线"}',
      changeType: '性能目标修订',
      projectId: '7',
      reason: 'Benchmark 复测',
      requirementId: '5',
    });
    wrapper.unmount();
  });

  it('shows API error inside the create modal form on POST failure', async () => {
    stubApi({ createResponse: { data: null, status: 500, code: 90001 } });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    await vi.waitFor(() => {
      const errorBlock = wrapper.find('.form-error');
      expect(errorBlock.exists()).toBe(true);
      expect(errorBlock.text()).toContain('数据不存在或服务暂时不可用');
    });
    // 模态保持打开（错误回填到 createError）
    expect(wrapper.text()).toContain('发起需求变更');
    wrapper.unmount();
  });

  // ========== signatures 解析（SSOT 解析逻辑） ==========

  it('parses MARKET_PM=APPROVE / RD_PM=APPROVE dual signatures', async () => {
    stubApi();
    const wrapper = await mountChange();
    // #32 已有双签齐的 signatures
    const articles = wrapper.findAll('.change-cards article');
    const card32 = articles[1]?.text() ?? '';
    expect(card32).toContain('已同意');
    // #32 市场PM 和 研发PM 都应显示「已同意」
    expect((card32.match(/已同意/g) ?? []).length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it('parses MARKET_PM=APPROVE while RD_PM is still 待签', async () => {
    stubApi();
    const wrapper = await mountChange();
    // #31 signatures='MARKET_PM:12=APPROVE'（无 RD_PM 段）
    const articles = wrapper.findAll('.change-cards article');
    const card31 = articles[0]?.text() ?? '';
    expect(card31).toContain('已同意');
    expect(card31).toContain('待签');
    wrapper.unmount();
  });

  it('treats null signatures as 待签 for both PMs', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
          ],
          total: 1,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    const card = wrapper.findAll('.change-cards article')[0]?.text() ?? '';
    // MARKET_PM 与 RD_PM 都应渲染为「待签」
    expect((card.match(/待签/g) ?? []).length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  // ========== 快照详情展开/收起 ==========

  it('hides snapshot details when both beforeSnapshot and afterSnapshot are null', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
          ],
          total: 1,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    expect(wrapper.findAll('details.snapshot-details').length).toBe(0);
    wrapper.unmount();
  });

  it('shows snapshot details when beforeSnapshot is present', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: '{"scope":"old"}', changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
          ],
          total: 1,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    const details = wrapper.find('details.snapshot-details');
    expect(details.exists()).toBe(true);
    expect(wrapper.text()).toContain('变更前：{"scope":"old"}');
    wrapper.unmount();
  });

  it('shows snapshot details when afterSnapshot is present', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: '{"latency":"200ms"}', beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' },
          ],
          total: 1,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    expect(wrapper.text()).toContain('变更后：{"latency":"200ms"}');
    wrapper.unmount();
  });

  // ========== 关联需求下拉（demands 加载与失败容错） ==========

  it('issues GET /demands with the active productId', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    const demandCall = calls.find((call) => call.url.startsWith('/api/v1/demands?'));
    expect(demandCall).toBeDefined();
    expect(demandCall?.url).toContain('productId=10');
    wrapper.unmount();
  });

  it('does not crash when fetchDemands fails (page still renders list)', async () => {
    stubApi({ demandsResponse: { data: null, ok: false } });
    const wrapper = mount(Change);
    // 列表仍能渲染（demands 失败容错）
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单 #31'));
    expect(wrapper.text()).toContain('变更管理');
    wrapper.unmount();
  });

  it('renders the empty-demand placeholder when product has no demands', async () => {
    stubApi({ demandsResponse: { data: { demands: [], total: 0 }, ok: true } });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    // 关联需求下拉的 placeholder：「请选择需求（0 条）」
    expect(wrapper.text()).toContain('请选择需求（0 条）');
    wrapper.unmount();
  });

  // ========== Flow 5: 创建校验边界（空输入/超长输入/在途禁用） ==========

  it('rejects whitespace-only changeType as required and never hits POST', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('   ');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    // 空白输入 trim 后判必填：文案精确、零 POST、弹窗保持打开
    expect(wrapper.get('.form-error').text()).toBe('变更类型、变更原因与关联需求 ID 均为必填。');
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes').length).toBe(0);
    expect(wrapper.text()).toContain('发起需求变更');
    wrapper.unmount();
  });

  it('rejects whitespace-only reason as required and never hits POST', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('\u00A0 ');
    await form.trigger('submit');
    // 不间断空格 + 普通空格同样被 trim 判空，走必填错误
    expect(wrapper.get('.form-error').text()).toBe('变更类型、变更原因与关联需求 ID 均为必填。');
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes').length).toBe(0);
    wrapper.unmount();
  });

  it('rejects non-numeric requirementId even when it came from the demand select', async () => {
    const calls = stubApi({
      demandsResponse: {
        data: {
          demands: [{ id: '5x', title: '异形 ID 需求', productId: '10', status: 'SUBMITTED', source: 'INTERNAL', customerName: null, marketPmId: null, marketPmName: null, projectId: null, rdPmId: null, rdPmName: null, submitterName: null, createdAt: null }],
          total: 1,
        },
        ok: true,
      },
    });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    // 需求契约 id 非数字（服务端漂移）：下拉能选中，但提交前被数字校验拦截
    await form.findAll('select')[1]?.setValue('5x');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    expect(wrapper.get('.form-error').text()).toBe('关联需求 ID 必须为数字。');
    expect(calls.filter((call) => call.method === 'POST').length).toBe(0);
    wrapper.unmount();
  });

  it('submits ultra-long changeType and reason verbatim without truncation', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    const longType = '超长变更类型'.repeat(100);
    const longReason = '因为'.repeat(1000);
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue(longType);
    await form.findAll('textarea')[0]?.setValue(longReason);
    await form.trigger('submit');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes')).toBe(true));
    const post = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes');
    // 超长输入（600/2000 字）原样入请求体，前端不截断
    expect(post?.body).toMatchObject({ changeType: longType, reason: longReason });
    expect((post?.body as { changeType: string }).changeType).toHaveLength(600);
    expect((post?.body as { reason: string }).reason).toHaveLength(2000);
    wrapper.unmount();
  });

  it('disables the create submit button while the create POST is in flight', async () => {
    const hold = gate();
    const calls = stubApi({ deferred: [{ gate: hold, match: (method, url) => method === 'POST' && url === '/api/v1/requirement-changes' }] });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    // 在途防重复提交：按钮 disabled + 文案切换「提交中…」，且此刻只发了 1 个 POST
    const pendingBtn = form.findAll('button').find((button) => button.text() === '提交中…');
    expect(pendingBtn).toBeDefined();
    expect(pendingBtn?.attributes('disabled')).toBeDefined();
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/requirement-changes').length).toBe(1);
    const listCallsBefore = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length;
    hold.resolve();
    // 成功路径：弹窗关闭 + loadChanges 重载（成功 message 文案与既有用例重复，避免跨用例污染不在此断言）
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('发起需求变更'));
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length).toBeGreaterThan(listCallsBefore);
    });
    wrapper.unmount();
  });

  // ========== Flow 6: 业务错误码 50001/50002/10001/40011 展示与降级 ==========

  it('maps create failure code 50001 to its common-table text inside the modal', async () => {
    stubApi({ createResponse: { data: null, status: 500, code: 50001 } });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    await vi.waitFor(() => expect(wrapper.get('.form-error').text()).toContain('数据不存在或已被删除，请刷新后重试'));
    expect(wrapper.text()).toContain('发起需求变更');
    wrapper.unmount();
  });

  it('maps create failure code 50002 to its state-changed text inside the modal', async () => {
    stubApi({ createResponse: { data: null, status: 409, code: 50002 } });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    await form.findAll('select')[1]?.setValue('5');
    await form.findAll('input')[0]?.setValue('测试变更');
    await form.findAll('textarea')[0]?.setValue('因为渠道反馈');
    await form.trigger('submit');
    await vi.waitFor(() => expect(wrapper.get('.form-error').text()).toContain('状态已变更（可能其他人已编辑），请刷新后查看'));
    wrapper.unmount();
  });

  it('maps submit failure code 10001 to its validation text via message.error', async () => {
    stubApi({ submitResponse: { data: null, status: 400, code: 10001 } });
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '提交双签')?.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('输入信息不符合要求，请检查后重试'));
    // 失败后卡片仍为草稿态，按钮原样保留（服务端状态未变）
    const buttons = wrapper.findAll('.change-cards article')[2]?.findAll('.decision-buttons button').map((btn) => btn.text()) ?? [];
    expect(buttons).toEqual(['提交双签']);
    wrapper.unmount();
  });

  it('maps sign failure code 40011 to its rate-limit text via message.error', async () => {
    stubApi({ signResponse: { data: null, status: 429, code: 40011 } });
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝')?.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('请求过于频繁，请稍后再试'));
    const buttons = wrapper.findAll('.change-cards article')[0]?.findAll('.decision-buttons button').map((btn) => btn.text()) ?? [];
    expect(buttons).toEqual(['拒绝', '同意签署']);
    wrapper.unmount();
  });

  it('prefers the backend envelope message over the code table on sign failure', async () => {
    stubApi({ signResponse: { data: null, status: 409, code: 50002, message: '同一人不能重复确认' } });
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝')?.trigger('click');
    // R215-E2E-B 降级链：后端有 message 原文时必须透传，不得被码表文案（50002「状态已变更…」）抹平
    await vi.waitFor(() => expect(document.body.textContent).toContain('同一人不能重复确认'));
    expect(document.body.textContent).not.toContain('状态已变更（可能其他人已编辑）');
    wrapper.unmount();
  });

  it('degrades unknown business code to the generic fallback text', async () => {
    stubApi({ submitResponse: { data: null, status: 500, code: 99999 } });
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '提交双签')?.trigger('click');
    // 未登记 code：页面域表/通用表/HTTP 状态表全部落空 → 通用兜底文案
    await vi.waitFor(() => expect(document.body.textContent).toContain('操作失败，请稍后重试'));
    wrapper.unmount();
  });

  // ========== Flow 7: 重复点击/防抖（BUG-1 高发区·现状钉扎） ==========
  // BUG-1（已登记报告）：决策按钮无 in-flight 守卫与防抖，响应返回前连点会双发写请求。
  // 下面两例在「响应挂起窗口」内连点并钉扎现状（2 个请求）；修复后断言应翻转为 1。

  it('pins BUG-1 double-fire: two clicks on 提交双签 emit two PUT submit requests in flight', async () => {
    const hold = gate();
    const calls = stubApi({ deferred: [{ gate: hold, match: (method, url) => method === 'PUT' && url === '/api/v1/requirement-changes/33/submit' }] });
    const wrapper = await mountChange();
    const submitButton = () => wrapper.findAll('.change-cards article')[2]?.findAll('button').find((button) => button.text() === '提交双签');
    await submitButton()?.trigger('click');
    await submitButton()?.trigger('click');
    // 现状（BUG-1）：2 次点击 → 2 个 PUT /submit；期望行为应只发 1 个
    expect(calls.filter((call) => call.url === '/api/v1/requirement-changes/33/submit').length).toBe(2);
    // 伴生证据：在途按钮未置灰/未禁用（无 in-flight 守卫）
    expect(submitButton()?.attributes('disabled')).toBeUndefined();
    const listCallsBefore = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length;
    hold.resolve();
    // 每个请求成功后各自触发 loadChanges 重载（进一步放大重复请求）
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length).toBeGreaterThan(listCallsBefore);
    });
    wrapper.unmount();
  });

  it('pins BUG-1 double-fire: two clicks on 拒绝 emit two PUT sign requests in flight', async () => {
    const hold = gate();
    const calls = stubApi({ deferred: [{ gate: hold, match: (method, url) => method === 'PUT' && url === '/api/v1/requirement-changes/31/sign?decision=REJECT' }] });
    const wrapper = await mountChange();
    const rejectButton = () => wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝');
    await rejectButton()?.trigger('click');
    await rejectButton()?.trigger('click');
    // 现状（BUG-1）：2 次点击 → 2 个 PUT /sign?decision=REJECT；期望行为应只发 1 个
    expect(calls.filter((call) => call.url === '/api/v1/requirement-changes/31/sign?decision=REJECT').length).toBe(2);
    expect(rejectButton()?.attributes('disabled')).toBeUndefined();
    hold.resolve();
    const listCallsBefore = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length;
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?')).length).toBeGreaterThan(listCallsBefore);
    });
    wrapper.unmount();
  });

  // ========== Flow 8: 权限 30001 降级与权限码显隐缺口 ==========

  it('maps 30001 denial to the project-domain override text and keeps retry buttons', async () => {
    stubApi({ signResponse: { data: null, status: 403, code: 30001 } });
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '拒绝')?.trigger('click');
    // ipdErrorText domain:'project' 域覆写生效（30001 → 您没有此项目的操作权限）
    await vi.waitFor(() => expect(document.body.textContent).toContain('您没有此项目的操作权限'));
    // 不得落到通用表文案「您没有执行此操作的权限」（三级查表链顺序验证）
    expect(document.body.textContent).not.toContain('您没有执行此操作的权限');
    // 拒绝失败后卡片仍为待双签、按钮原样保留（现状：无本地禁用/隐藏）
    const buttons = wrapper.findAll('.change-cards article')[0]?.findAll('.decision-buttons button').map((btn) => btn.text()) ?? [];
    expect(buttons).toEqual(['拒绝', '同意签署']);
    wrapper.unmount();
  });

  it('gap: decision buttons stay rendered under a removing access directive (no v-access bound)', async () => {
    stubApi();
    // vitest.ipd.setup.ts 约定：用「mounted 即移除」的 access 指令模拟无权限用户
    const wrapper = mount(Change, {
      global: { directives: { access: { mounted(el: HTMLElement) { el.remove(); } } } },
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单 #31'));
    // 缺口现状：本页决策按钮未绑定 v-access:code（IPD_PERMISSION_CODES.REQUIREMENT_CHANGE_SUBMIT/SIGN
    // 均未被引用），无权限指令下按钮不隐藏也不置灰；修复（补权限码显隐）后本用例需翻转为「按钮不渲染」
    const draftButtons = wrapper.findAll('.change-cards article')[2]?.findAll('.decision-buttons button').map((btn) => btn.text()) ?? [];
    expect(draftButtons).toEqual(['提交双签']);
    const signButtons = wrapper.findAll('.change-cards article')[0]?.findAll('.decision-buttons button').map((btn) => btn.text()) ?? [];
    expect(signButtons).toEqual(['拒绝', '同意签署']);
    wrapper.unmount();
  });

  // ========== Flow 9: 状态枚举与 signatures 解析映射（边界） ==========

  it('falls back to the raw status code with no tone class for unknown enums', async () => {
    stubApi({
      changesResponse: {
        data: { records: [{ afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'CANCELLED' }], total: 1 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    // 未知 status：label 兜底原始 code，tone 兜底空串（类名只剩 status-pill 本体）
    const pill = wrapper.get('i.status-pill');
    expect(pill.text()).toBe('CANCELLED');
    expect(pill.classes()).toEqual(['status-pill']);
    // 未知状态不出决策按钮（仅 DRAFT/PENDING_SIGN 出）
    expect(wrapper.findAll('.decision-buttons button').length).toBe(0);
    wrapper.unmount();
  });

  it('renders a blank pill and no buttons for empty-string status', async () => {
    stubApi({
      changesResponse: {
        data: { records: [{ afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: '' }], total: 1 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    // 后端 status 缺失收敛为空串（parseRequirementChange 契约）：渲染空 pill 不崩溃
    const pill = wrapper.get('i.status-pill');
    expect(pill.text()).toBe('');
    expect(pill.classes()).toEqual(['status-pill']);
    expect(wrapper.findAll('.decision-buttons button').length).toBe(0);
    wrapper.unmount();
  });

  it('carries the draft tone class on the DRAFT pill', async () => {
    stubApi({
      changesResponse: {
        data: { records: [{ afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: null, status: 'DRAFT' }], total: 1 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    // STATUS_TONE 含 DRAFT:'draft'（补齐既有 tone 用例未覆盖的草稿档）
    expect(wrapper.get('i.status-pill').classes()).toContain('draft');
    expect(wrapper.get('i.status-pill').classes()).not.toContain('pending');
    wrapper.unmount();
  });

  it('takes the last decision when the same role signs twice', async () => {
    stubApi({
      changesResponse: {
        data: { records: [{ afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: 'MARKET_PM:12=REJECT;MARKET_PM:34=APPROVE', status: 'PENDING_SIGN' }], total: 1 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    const cells = wrapper.findAll('.change-impact span strong').map((node) => node.text());
    // 同角色多签取最后一条：REJECT 之后又 APPROVE → 已同意；RD_PM 未签 → 待签
    expect(cells.slice(2)).toEqual(['已同意', '待签']);
    wrapper.unmount();
  });

  it('ignores malformed signature segments and trims padded ones', async () => {
    stubApi({
      changesResponse: {
        data: {
          records: [
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: 'MARKET_PM:abc=APPROVE;RD_PM:12=MAYBE', status: 'DRAFT' },
            { afterSnapshot: null, beforeSnapshot: null, changeType: 'b', createTime: null, id: '2', projectId: '7', reason: 'r', requirementId: '2', signatures: 'MARKET_PM=APPROVE; RD_PM:34=REJECT ', status: 'PENDING_SIGN' },
          ],
          total: 2,
        },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 2 条变更单'));
    const cards = wrapper.findAll('.change-cards article');
    const cells1 = cards[0]?.findAll('.change-impact span strong').map((node) => node.text()) ?? [];
    // 残缺段（:abc 非数字 ID、MAYBE 非法决策）整体忽略 → 双方待签
    expect(cells1.slice(2)).toEqual(['待签', '待签']);
    const cells2 = cards[1]?.findAll('.change-impact span strong').map((node) => node.text()) ?? [];
    // 无 :id 段可解析 + 首尾空白 trim 后仍命中
    expect(cells2.slice(2)).toEqual(['已同意', '已拒绝']);
    wrapper.unmount();
  });

  // ========== Flow 10: 契约字段映射与分页边界 ==========

  it('pins the list query contract pageNo=1&pageSize=50&projectId and mount double fetch', async () => {
    const calls = stubApi();
    const wrapper = await mountChange();
    const changesCalls = calls.filter((call) => call.url.startsWith('/api/v1/requirement-changes?'));
    expect(changesCalls[0]?.url).toBe('/api/v1/requirement-changes?pageNo=1&pageSize=50&projectId=7');
    // 现状（登记观察）：watch(''→'7') 与 onMounted Promise.all 各触发一次，挂载即重复请求列表
    expect(changesCalls.length).toBe(2);
    wrapper.unmount();
  });

  it('shows server total in the header while cards render only the returned records', async () => {
    stubApi({
      changesResponse: {
        data: { records: changes.map((row) => ({ ...row })), total: 60 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 60 条变更单'));
    // 分页边界（多页首页）：total=60 走头部/总量格，卡片只渲染当页 records=3
    expect(wrapper.findAll('.change-cards article').length).toBe(3);
    expect(wrapper.findAll('.metric-strip .metric strong').map((node) => node.text())).toEqual(['60', '1', '1', '0']);
    wrapper.unmount();
  });

  it('rejects numeric-id records as contract drift with the protocol error alert', async () => {
    stubApi({
      changesResponse: {
        // 后端 id 漂移成 number：isIdString 契约拒绝（不做静默修补）
        data: { records: [{ afterSnapshot: null, beforeSnapshot: null, changeType: 'a', createTime: null, id: 31 as unknown as string, projectId: '7', reason: 'r', requirementId: '8', signatures: null, status: 'DRAFT' }], total: 1 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单数据格式异常，请稍后重试'));
    expect(wrapper.find('.chg-alert').exists()).toBe(true);
    // 解析抛错后列表不落数据、总量归零
    expect(wrapper.text()).toContain('已加载 0 条变更单');
    expect(wrapper.findAll('.change-cards article').length).toBe(0);
    wrapper.unmount();
  });

  it('maps change-impact cells to snapshot presence and signature text', async () => {
    stubApi({
      changesResponse: {
        data: { records: [{ afterSnapshot: null, beforeSnapshot: '{"scope":"old"}', changeType: 'a', createTime: null, id: '1', projectId: '7', reason: 'r', requirementId: '1', signatures: 'MARKET_PM:12=APPROVE', status: 'PENDING_SIGN' }], total: 1 },
        ok: true,
      },
    });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已加载 1 条变更单'));
    // 四格映射：变更前快照=已冻结 / 变更后快照=未填写 / 市场PM 已同意 / 研发PM 待签
    expect(wrapper.findAll('.change-impact span strong').map((node) => node.text())).toEqual(['已冻结', '未填写', '已同意', '待签']);
    // 快照详情只渲染存在的一侧（pre 数量=1）
    expect(wrapper.findAll('details.snapshot-details pre').length).toBe(1);
    expect(wrapper.text()).toContain('变更前：{"scope":"old"}');
    wrapper.unmount();
  });

  it('re-fires list and demands with the newly selected project params', async () => {
    const calls = stubApi({
      projectsResponse: {
        data: [project, { ...project, id: '8', code: 'P-008', name: '第二项目', productId: '20' }],
      },
    });
    const wrapper = await mountChange();
    await wrapper.get('.change-project-selector select').setValue('8');
    // 筛选器映射：切项目后 changes 按新 projectId、demands 按新产品 productId 重新请求
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.startsWith('/api/v1/requirement-changes?') && call.url.includes('projectId=8'))).toBe(true);
    });
    expect(calls.some((call) => call.url.startsWith('/api/v1/demands?') && call.url.includes('productId=20'))).toBe(true);
    wrapper.unmount();
  });

  // ========== Flow 11: 加载态与空列表 ==========

  it('gap: shows the empty state while the list request is still in flight', async () => {
    const hold = gate();
    const calls = stubApi({ deferred: [{ gate: hold, match: (method, url) => method === 'GET' && url.startsWith('/api/v1/requirement-changes?') }] });
    const wrapper = mount(Change);
    await vi.waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/v1/requirement-changes?'))).toBe(true));
    // 缺口现状：loading ref 未接线进模板，请求在途即渲染空态（误报「暂无变更申请单」）
    expect(wrapper.find('.business-list .empty-state').exists()).toBe(true);
    expect(wrapper.text()).toContain('暂无变更申请单');
    expect(wrapper.text()).not.toContain('加载中');
    hold.resolve();
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单 #31'));
    // 数据到达后空态退场、卡片进场
    expect(wrapper.find('.business-list .empty-state').exists()).toBe(false);
    expect(wrapper.findAll('.change-cards article').length).toBe(3);
    wrapper.unmount();
  });

  it('disables the demand select while demands are loading and enables it after', async () => {
    const hold = gate();
    stubApi({ deferred: [{ gate: hold, match: (method, url) => method === 'GET' && url.startsWith('/api/v1/demands?') }] });
    const wrapper = await mountChange();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起需求变更'));
    const form = wrapper.get('form.create-modal');
    // 真实加载态：demands 在途期间下拉 disabled（与列表缺口形成对照）
    expect(form.findAll('select')[1]?.attributes('disabled')).toBeDefined();
    hold.resolve();
    await vi.waitFor(() => expect(form.findAll('select')[1]?.attributes('disabled')).toBeUndefined());
    expect(wrapper.text()).toContain('请选择需求（1 条）');
    wrapper.unmount();
  });

  // ========== Flow 12: 决策动作成功消息语义 ==========

  it('shows the waiting-for-other-PM message when only one PM approves', async () => {
    stubApi();
    const wrapper = await mountChange();
    await wrapper.findAll('.change-cards article')[0]?.findAll('button').find((button) => button.text() === '同意签署')?.trigger('click');
    // 单方 APPROVE：返回 status 仍为 PENDING_SIGN → 走「等待另一方」分支（该文案为本分支独有，
    // 若误走「双签通过…」分支则此断言必失败）
    await vi.waitFor(() => expect(document.body.textContent).toContain('已同意，等待另一方PM签署'));
    // 签署登记进 signatures：市场PM 格翻转为已同意，研发PM 仍待签
    await vi.waitFor(() => {
      const cells = wrapper.findAll('.change-cards article')[0]?.findAll('.change-impact span strong').map((node) => node.text()) ?? [];
      expect(cells.slice(2)).toEqual(['已同意', '待签']);
    });
    wrapper.unmount();
  });
});
