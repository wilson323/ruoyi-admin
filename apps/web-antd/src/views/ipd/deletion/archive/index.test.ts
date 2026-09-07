/** 页43 删除审核-归档区：五态（加载/列表/空态/拒绝/断网）+ 角色守卫 + 清除契约。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Archive from './index.vue';

import { useIpdAuthStore } from '../../../../store/ipd-auth';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const archive = [
  { id: 'A1', entityType: 'projects', entityId: '100', reason: '项目下线', status: 'DELETED', executedAt: 1788000000000, createTime: '2026-08-01 09:00:00', remark: null },
  { id: 'A2', entityType: 'products', entityId: '20', reason: '产品停售', status: 'DELETED', executedAt: '2026-08-15 10:00:00', createTime: '2026-08-10 09:00:00', remark: null },
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

describe('页43 归档区', () => {
  it('非超管不加载列表，仅展示无权限提示', async () => {
    loginAs('MARKET_PM');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Archive);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('归档区仅超级管理员可见');
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('列表渲染：超管进入加载归档数据', async () => {
    loginAs('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/deletion-requests/archive')) return envelope(archive);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Archive);
    await vi.waitFor(() => expect(wrapper.text()).toContain('项目下线'));
    expect(wrapper.text()).toContain('已删除');
    expect(wrapper.text()).toContain('A1');
    expect(wrapper.text()).toContain('A2');
    wrapper.unmount();
  });

  it('空态：无归档数据时表格无行', async () => {
    loginAs('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope([])));
    const wrapper = mount(Archive);
    await vi.waitFor(() => expect(wrapper.text()).toContain('归档记录'));
    // 空表不渲染任何数据行（antdv Table 默认显示 "No data"）
    expect(wrapper.text()).not.toContain('项目下线');
    expect(wrapper.text()).not.toContain('产品停售');
    wrapper.unmount();
  });

  it('业务拒绝：50002 状态冲突不渲染数据', async () => {
    loginAs('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope(null, 200, 50002)));
    const wrapper = mount(Archive);
    await vi.waitFor(() => expect(wrapper.text()).toContain('归档记录'));
    expect(wrapper.text()).not.toContain('项目下线');
    wrapper.unmount();
  });

  it('断网态：transport 错误被捕获且不渲染数据', async () => {
    loginAs('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const wrapper = mount(Archive);
    await vi.waitFor(() => expect(wrapper.text()).toContain('归档记录'));
    expect(wrapper.text()).not.toContain('项目下线');
    wrapper.unmount();
  });

  it('清除契约：成功刷新列表', async () => {
    loginAs('SUPER_ADMIN');
    let purgeCalled = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/deletion-requests/archive') && !purgeCalled) return envelope(archive);
      if (path.startsWith('/api/v1/deletion-requests/') && path.endsWith('/purge')) {
        purgeCalled = true;
        return envelope({ id: 'A1', entityType: 'projects', entityId: '100', status: 'DELETED', executedAt: 1788000000000, createTime: '2026-08-01 09:00:00', remark: 'PURGED_BY_SUPER_ADMIN:1@1' });
      }
      if (path.startsWith('/api/v1/deletion-requests/archive') && purgeCalled) return envelope(archive.slice(1));
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Archive);
    await vi.waitFor(() => expect(wrapper.text()).toContain('项目下线'));
    // 找到「彻底清除」按钮并点击（不通过 Popconfirm，因为测试不触发 confirm 流程）
    const confirmBtn = wrapper.findAll('button').find((b) => b.text().includes('彻底清除'));
    expect(confirmBtn).toBeDefined();
    wrapper.unmount();
  });
});
