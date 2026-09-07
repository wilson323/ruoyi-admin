// 变更管理页组件级验证：mock 真实 P2-6.1 契约（requirement-changes 读/建/提交/签署），
// 断言原型 ChangesPage 一比一结构、双PM双签状态机按钮、创建校验与端点调用形态。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type RequirementChange } from '../../../api/ipd/change';
import Change from './index.vue';

const response = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

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

function stubApi() {
  setActivePinia(createPinia());
  const calls: ApiCall[] = [];
  // 服务端状态机语义：动作成功后列表 GET 反映新状态（与真实后端一致）
  const rows = changes.map((row) => ({ ...row }));
  const apply = (id: string, patch: Record<string, unknown>) => {
    const row = rows.find((item) => item.id === id);
    if (row) Object.assign(row, patch);
    return response({ ...row });
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method, url });
    if (method === 'GET' && url === '/api/v1/projects') return response([project]);
    if (method === 'GET' && url.startsWith('/api/v1/demands?')) return response({ demands: [{ id: '5', title: '测试需求条目', productId: '10', status: 'SUBMITTED', source: 'INTERNAL', customerName: null, marketPmId: null, marketPmName: null, projectId: null, rdPmId: null, rdPmName: null, submitterName: null, createdAt: null }], total: 1 });
    if (method === 'GET' && url.startsWith('/api/v1/requirement-changes?')) return response({ records: rows.map((row) => ({ ...row })), total: rows.length });
    if (method === 'POST' && url === '/api/v1/requirement-changes') {
      // noUncheckedIndexedAccess：不 spread 数组元素（类型含 undefined），显式完整构造
      const created: RequirementChange = {
        afterSnapshot: null, beforeSnapshot: null, changeType: '测试变更', createTime: null,
        id: '40', projectId: '7', reason: '因为渠道反馈', requirementId: '5', signatures: null, status: 'DRAFT',
      };
      rows.push(created);
      return response(created);
    }
    if (method === 'PUT' && url === '/api/v1/requirement-changes/33/submit') return apply('33', { status: 'PENDING_SIGN' });
    if (method === 'PUT' && url === '/api/v1/requirement-changes/33/sign?decision=APPROVE') return apply('33', { signatures: 'MARKET_PM:12=APPROVE', status: 'APPROVED' });
    if (method === 'PUT' && url === '/api/v1/requirement-changes/31/sign?decision=REJECT') return apply('31', { signatures: 'MARKET_PM:12=REJECT', status: 'REJECTED' });
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
    await form.findAll('select')[1].setValue('5');
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
    await form.findAll('select')[1].setValue('5');
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
});

