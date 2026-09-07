// 页49 超管移交组件级验证：mock 真实 /api/v1 契约（pm-directory、handovers/super-admin），
// 断言身份防御、候选空态、确认短语门控、readiness 前端预检、成功请求体与失败透出，
// 以及原型差异/增量登记文案（currentPassword / replacementLeadId / readiness 端点）。

import { message } from 'ant-design-vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../../../store/ipd-auth';
import AdminHandover from './index.vue';

const push = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

const response = (data: unknown, status = 200, code = 0, message?: string) => new Response(
  JSON.stringify({ code, message: message ?? (code ? '请求不合法' : 'success'), data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const admin = { id: '7', name: '现任超管', personType: 'SUPER_ADMIN' };
const leaderA = { employeeNo: null, groupId: 'G1', groupName: '一组', id: '3', level: null, name: '组长甲', personType: 'GROUP_LEADER' };
const leaderB = { employeeNo: null, groupId: 'G2', groupName: '二组', id: '4', level: null, name: '组长乙', personType: 'GROUP_LEADER' };

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  push.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function loginAs(personType: 'GROUP_LEADER' | 'SUPER_ADMIN') {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: { accountStatus: 'ACTIVE', groupId: 'G0', id: admin.id, name: '现任超管', personType, username: 'admin' },
    scope: 'FULL',
  };
}

function stubApi(options: { directory?: typeof leaderA[]; superAdminFail?: boolean } = {}) {
  const calls: { body: unknown; method: string; url: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (method === 'GET' && url === '/api/v1/pm-directory') {
      if (options.directory === undefined) throw new TypeError('fetch failed');
      return response({ directory: options.directory, total: options.directory.length });
    }
    if (method === 'POST' && url === '/api/v1/handovers/super-admin') {
      if (options.superAdminFail) return response(null, 400, 40000, '检测到 3 名在任超管（违反单超管不变式），须先收敛至一名再移交');
      return response(null);
    }
    return response(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('IPD admin handover page (prototype SuperAdminSuccessionPanel adaptation)', () => {
  it('blocks non-admin identities without any request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    loginAs('GROUP_LEADER');
    const wrapper = mount(AdminHandover);
    expect(wrapper.text()).toContain('仅超级管理员可访问本页');
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders candidates, readiness checks and the confirmation-phrase gate', async () => {
    stubApi({ directory: [leaderA, leaderB] });
    loginAs('SUPER_ADMIN');
    const wrapper = mount(AdminHandover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('组长甲'));

    const selects = wrapper.findAll('select');
    await selects[0]!.setValue(leaderA.id);
    const phrase = wrapper.find('input[placeholder="输入：确认移交管理员"]');
    expect(phrase.exists()).toBe(true);

    const submit = wrapper.findAll('button').find((button) => button.text().includes('确认移交超级管理员'))!;
    // 未输确认短语 → 禁用；预检已就绪
    expect(submit.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('交接对象非本人');
    await phrase.setValue('确认移交管理员');
    expect(submit.attributes('disabled')).toBeUndefined();

    // 短语错误回退禁用
    await phrase.setValue('确认移交');
    expect(submit.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('submits the real contract body {toPersonId, note, confirmation} and signs out on success', async () => {
    const calls = stubApi({ directory: [leaderA] });
    loginAs('SUPER_ADMIN');
    const wrapper = mount(AdminHandover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('组长甲'));

    await wrapper.findAll('select')[0]!.setValue(leaderA.id);
    await wrapper.find('input[placeholder="输入：确认移交管理员"]').setValue('确认移交管理员');
    await wrapper.findAll('button').find((button) => button.text().includes('确认移交超级管理员'))!.trigger('click');

    const transfer = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/handovers/super-admin');
    expect(transfer).toBeDefined();
    expect(transfer!.body).toMatchObject({ confirmation: '确认移交管理员', toPersonId: leaderA.id });
    // 成功后清会话回登录页
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/auth/login'));
    expect(useIpdAuthStore().identity).toBeNull();
    wrapper.unmount();
  });

  it('surfaces a friendly rejection when the backend refuses the transfer', async () => {
    stubApi({ directory: [leaderA], superAdminFail: true });
    loginAs('SUPER_ADMIN');
    // 40000 不在 ipd-error-text 码表内 → 降级 fallback；不透出后端动态文案是集中表策略的预期行为
    const errorSpy = vi.spyOn(message, 'error');
    const wrapper = mount(AdminHandover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('组长甲'));

    await wrapper.findAll('select')[0]!.setValue(leaderA.id);
    await wrapper.find('input[placeholder="输入：确认移交管理员"]').setValue('确认移交管理员');
    await wrapper.findAll('button').find((button) => button.text().includes('确认移交超级管理员'))!.trigger('click');

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('移交失败');
    wrapper.unmount();
  });

  it('renders the empty state when no active group leader exists', async () => {
    stubApi({ directory: [] });
    loginAs('SUPER_ADMIN');
    const wrapper = mount(AdminHandover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无可交接的在职产品组长'));
    wrapper.unmount();
  });

  it('shows the transport error with retry when the directory is unreachable', async () => {
    stubApi({});
    loginAs('SUPER_ADMIN');
    const wrapper = mount(AdminHandover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('重试'));
    // 重试恢复：改写 fetch 后再次加载
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/pm-directory') return response({ directory: [leaderA], total: 1 });
      return response(null, 404, 40400);
    }));
    await wrapper.findAll('button').find((button) => button.text() === '重试')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('组长甲'));
    wrapper.unmount();
  });

  it('registers the prototype deltas (currentPassword / replacementLeadId / readiness) in-page', async () => {
    stubApi({ directory: [leaderA] });
    loginAs('SUPER_ADMIN');
    const wrapper = mount(AdminHandover);
    await vi.waitFor(() => expect(wrapper.text()).toContain('更换超级管理员'));
    expect(wrapper.text()).toContain('currentPassword');
    expect(wrapper.text()).toContain('replacementLeadId');
    expect(wrapper.text()).toContain('本系统无密码登录交互');
    wrapper.unmount();
  });
});
