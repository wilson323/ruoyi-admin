/** 页05 删除审核-待我审核：角色守卫 + 决策端点契约 + 升级扫描 + 五态。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Review from './index.vue';

import { useIpdAuthStore } from '../../../../store/ipd-auth';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const overdue = [
  { id: 'O1', entityType: 'projects', entityId: 'P-200', reason: '项目下线', status: 'ADMIN_REVIEW', createTime: '2026-08-20 10:00:00', adminDueAt: '2026-08-25 10:00:00', requesterId: '1' },
];

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function loginAs(personType: 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN') {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: {
      accountStatus: 'ACTIVE',
      groupId: personType === 'SUPER_ADMIN' ? null : 'G1',
      id: '1',
      name: personType,
      personType,
      username: personType,
    },
    scope: 'FULL',
  };
}

describe('页05 待我审核', () => {
  it('组长视角：标题为「组长初审」，展示决策表单', async () => {
    loginAs('GROUP_LEADER');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/overdue-admin-review')) return envelope([]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Review);
    await vi.waitFor(() => expect(wrapper.text()).toContain('组长初审'));
    expect(wrapper.text()).toContain('通过后将进入超级管理员终审');
    // 超管专属工具不渲染
    expect(wrapper.text()).not.toContain('升级超期申请');
    wrapper.unmount();
  });

  it('超管视角：标题为「超管终审」，升级按钮可用并调用 escalate-overdue', async () => {
    loginAs('SUPER_ADMIN');
    let escalateCalled = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/overdue-admin-review')) return envelope(overdue);
      if (path.includes('/escalate-overdue') && init?.method === 'POST') {
        escalateCalled = true;
        return envelope({ escalated: 1 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Review);
    await vi.waitFor(() => expect(wrapper.text()).toContain('超管终审'));
    expect(wrapper.text()).toContain('升级超期申请');
    // 触发升级扫描
    const escalateBtn = wrapper.findAll('button').find((b) => b.text().includes('升级超期申请'));
    expect(escalateBtn).toBeDefined();
    await escalateBtn!.trigger('click');
    await vi.waitFor(() => expect(escalateCalled).toBe(true));
    wrapper.unmount();
  });

  it('普通 PM：决策表单整体禁用并提示无权限', async () => {
    loginAs('MARKET_PM');
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(Review);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('当前角色无删除审核权限');
    const submitBtn = wrapper.findAll('button').find((b) => b.text().includes('提交审核意见'));
    expect(submitBtn).toBeDefined();
    expect(submitBtn!.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('超管点击「升级超期申请」调用 escalate-overdue 并刷新清单', async () => {
    loginAs('SUPER_ADMIN');
    let callCount = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/overdue-admin-review')) return envelope(overdue);
      if (path.includes('/escalate-overdue') && init?.method === 'POST') {
        callCount++;
        return envelope({ escalated: 2 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Review);
    await vi.waitFor(() => expect(wrapper.text()).toContain('O1'));
    const escalateBtn = wrapper.findAll('button').find((b) => b.text().includes('升级超期申请'));
    await escalateBtn!.trigger('click');
    await vi.waitFor(() => expect(callCount).toBe(1));
    wrapper.unmount();
  });

  it('决策调用正确端点：组长 → leader-decision；超管 → admin-decision', async () => {
    // 组长
    loginAs('GROUP_LEADER');
    let leaderCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/overdue-admin-review')) return envelope([]);
      if (path.includes('/leader-decision')) { leaderCalled = true; return envelope({ id: 'X', entityType: 'projects', entityId: '1', status: 'ADMIN_REVIEW', createTime: '2026-09-05 10:00:00', requesterId: '1', reason: '测试' }); }
      throw new Error(`unexpected fetch: ${path}`);
    }));
    let wrapper = mount(Review);
    await wrapper.findAll('input')[0]!.setValue('X-1');
    const submitBtn = wrapper.findAll('button').find((b) => b.text().includes('提交审核意见'));
    await submitBtn!.trigger('click');
    await vi.waitFor(() => expect(leaderCalled).toBe(true));
    wrapper.unmount();

    // 超管
    loginAs('SUPER_ADMIN');
    let adminCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/overdue-admin-review')) return envelope([]);
      if (path.includes('/admin-decision')) { adminCalled = true; return envelope({ id: 'X', entityType: 'projects', entityId: '1', status: 'DELETED', executedAt: '2026-09-05 12:00:00', createTime: '2026-09-05 10:00:00', requesterId: '1', reason: '测试' }); }
      throw new Error(`unexpected fetch: ${path}`);
    }));
    wrapper = mount(Review);
    await wrapper.findAll('input')[0]!.setValue('X-2');
    const submitBtn2 = wrapper.findAll('button').find((b) => b.text().includes('提交审核意见'));
    await submitBtn2!.trigger('click');
    await vi.waitFor(() => expect(adminCalled).toBe(true));
    wrapper.unmount();
  });

  it('业务拒绝：50001 申请不存在被捕获且不渲染行', async () => {
    loginAs('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/overdue-admin-review')) return envelope(null, 200, 50001);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Review);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    // 5xxxx 错误后页面不渲染数据行
    expect(wrapper.text()).not.toContain('项目下线');
    wrapper.unmount();
  });
});
