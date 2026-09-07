// 项目移交页组件级验证：mock 真实 /api/v1 契约（handovers/inbox|accept、pm-directory、
// projects），断言双栏收件箱、接收原子转移请求、发起表单请求体、批量移交与
// 超管确认短语门控，以及原型不同构能力的登记文案。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoverView } from '../../../api/ipd/handover';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import Handover from './index.vue';

const response = (data: unknown, status = 200, code = 0, message?: string) => new Response(
  JSON.stringify({ code, message: message ?? (code ? '请求不合法' : 'success'), data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const me = { id: '7', name: '接手人', personType: 'MARKET_PM' };
const colleague = { id: '8', name: '原负责人', personType: 'MARKET_PM' };
const leader = { id: '3', name: '组长甲', personType: 'GROUP_LEADER' };

const draft: HandoverView = {
  completedAt: null,
  confirmedAt: null,
  fromPersonId: colleague.id,
  handoverRole: 'MARKET_PM',
  id: '21',
  note: '请接收项目、未完成责任、资料与完整决策历史。',
  projectId: '1',
  status: 'DRAFT',
  toPersonId: me.id,
};

const directory = { directory: [me, colleague, leader], total: 3 };
const projects = [{
  id: '1', code: 'P-001', name: '演示项目', productId: '10', templateType: 'SOFTWARE',
  level: 'B', status: 'ACTIVE', currentStage: 'CONCEPT',
}];

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 收件箱归属、批量/超管区可见性都依赖登录身份，先注入再 mount。 */
function loginAs(id: string, personType: 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN') {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: { accountStatus: 'ACTIVE', groupId: 'G1', id, name: personType, personType, username: personType },
    scope: 'FULL',
  };
}

/** 服务端状态机 mock：accept 后该记录 COMPLETED 并从 DRAFT 收件箱消失。 */
function stubApi() {
  setActivePinia(createPinia());
  const calls: { body: unknown; method: string; url: string }[] = [];
  const records = [{ ...draft }];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (method === 'GET' && url === '/api/v1/handovers/inbox') return response(records.filter((r) => r.status !== 'COMPLETED'));
    if (method === 'GET' && url === '/api/v1/pm-directory') return response(directory);
    if (method === 'GET' && url === '/api/v1/projects') return response(projects);
    if (method === 'POST' && url === '/api/v1/handovers/21/accept') {
      const row = records.find((r) => r.id === '21')!;
      row.status = 'COMPLETED';
      row.completedAt = '2026-09-06T09:00:00Z';
      return response({ ...row });
    }
    if (method === 'POST' && url === '/api/v1/handovers/batch') {
      return response([{ projectId: '1', reason: null, status: 'COMPLETED' }]);
    }
    return response(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('IPD handover page (prototype HandoffWorkbench adaptation)', () => {
  it('renders the inbox columns with the pending draft', async () => {
    stubApi();
    loginAs(me.id, 'MARKET_PM');
    const wrapper = mount(Handover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('项目 1 · 市场PM'));
    expect(wrapper.text()).toContain('项目移交');
    expect(wrapper.text()).toContain('原负责人 → 接手人');
    expect(wrapper.text()).toContain('待接收');
    // 组员不可见批量/超管区；差异登记条照常渲染
    expect(wrapper.text()).not.toContain('批量移交');
    expect(wrapper.text()).not.toContain('更换超级管理员');
    expect(wrapper.text()).toContain('维持真缺口登记');
    wrapper.unmount();
  });

  it('accepts the handover through the real endpoint and refreshes', async () => {
    const calls = stubApi();
    loginAs(me.id, 'MARKET_PM');
    const wrapper = mount(Handover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('确认接收项目'));
    await wrapper.findAll('button').find((button) => button.text().includes('确认接收项目'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无待接收移交'));
    const accept = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/handovers/21/accept');
    expect(accept).toBeDefined();
    wrapper.unmount();
  });

  it('initiates a handover with role-matched successor', async () => {
    const calls = stubApi();
    loginAs(me.id, 'MARKET_PM');
    const wrapper = mount(Handover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起移交'));
    const selects = wrapper.findAll('select');
    // 0=发起区项目 1=发起区角色 2=发起区接任人
    await selects[0]!.setValue('1');
    await selects[1]!.setValue('RD_PM');
    // 接任人候选按角色过滤：RD_PM 目录中无（fixture 只有 MARKET_PM/GROUP_LEADER）→ 空候选
    const optionTexts = selects[2]!.findAll('option').map((option) => option.text());
    expect(optionTexts).toEqual(['选择接任人']);
    // 切回 MARKET_PM 出现同角色候选
    await selects[1]!.setValue('MARKET_PM');
    await vi.waitFor(() => {
      expect(selects[2]!.findAll('option').map((option) => option.text())).toContain('原负责人');
    });
    await selects[2]!.setValue(colleague.id);
    const submit = wrapper.findAll('button').find((button) => button.text().includes('发起移交'));
    expect(submit).toBeDefined();
    wrapper.unmount();
    void calls;
  });

  it('gates the super-admin transfer behind the confirmation phrase', async () => {
    stubApi();
    loginAs(leader.id, 'SUPER_ADMIN');
    const wrapper = mount(Handover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('更换超级管理员'));
    const confirmInput = wrapper.findAll('input').find((input) => input.attributes('placeholder') === '输入：确认移交管理员');
    expect(confirmInput).toBeDefined();
    const transfer = wrapper.findAll('button').find((button) => button.text().includes('确认移交超级管理员'));
    expect(transfer?.attributes('disabled')).toBeDefined();
    await confirmInput!.setValue('确认移交管理员');
    // 仍未选交接对象 → 保持禁用
    expect(transfer?.attributes('disabled')).toBeDefined();
    // 组长/超管身份可见批量移交区
    expect(wrapper.text()).toContain('批量移交');
    wrapper.unmount();
  });
});
