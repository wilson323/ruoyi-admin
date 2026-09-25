// 研发PM「我的应标」视图测试（R215 GAP-F9）。mock api/ipd/bid 的 listBidResponsesByRdPm
// （string 透传/IPage 归一由 api/ipd/bid.test.ts §F9 锁定，本文件验证视图接线：
// person.id 取数路径（非 userStore.userId）、分页透传、渲染与错误分支）。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdIdentity } from '../../../../api/ipd/auth';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { listBidResponsesByRdPm } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import MyResponsesPage from './index.vue';

vi.mock('../../../../api/ipd/bid', () => ({ listBidResponsesByRdPm: vi.fn() }));
const mocked = vi.mocked(listBidResponsesByRdPm);

const pageFixture = {
  current: 1, pages: 1, size: 20, total: 2,
  records: [
    { id: '9001', invitationId: '11', rdPmId: '2096266884247736321', status: 'PENDING', responseNote: '方案A', respondedAt: '2026-09-20 10:00:00', createBy: null, createTime: null },
    { id: '2096266884247736399', invitationId: '2096266884247736311', rdPmId: '2096266884247736321', status: 'ACCEPTED', responseNote: null, respondedAt: null, createBy: null, createTime: null },
  ],
};

function setIdentity(personType: 'RD_PM' | 'SUPER_ADMIN' = 'RD_PM') {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: {
      accountStatus: 'ACTIVE', groupId: '12', id: '2096266884247736321',
      name: '研发PM甲', personType, username: 'rdpm',
    },
    scope: 'FULL',
  } satisfies IpdIdentity;
  return auth;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  mocked.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPage() {
  return mount(MyResponsesPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
}

describe('我的应标视图（R215 GAP-F9）', () => {
  it('mount 以 /auth/me person.id（string 19 位雪花）作 rdPmId 首拉，逐字符无损（禁 userStore.userId 数值路径）', async () => {
    setIdentity();
    mocked.mockResolvedValueOnce(pageFixture);
    const wrapper = mountPage();
    await flushPromises();
    expect(mocked).toHaveBeenCalledWith('2096266884247736321', { pageNo: 1, pageSize: 20 });
    expect(wrapper.text()).toContain('2096266884247736321'); // 身份 ID 区
    expect(wrapper.text()).toContain('2096266884247736399'); // 19 位应标 ID 逐字符渲染
    expect(wrapper.text()).toContain('2096266884247736311'); // 19 位招标单 ID 逐字符渲染
    wrapper.unmount();
  });

  it('状态列走 bidResponseStatusLabel/Tone（PENDING→待定的机器值域映射，未知值原样不炸）', async () => {
    setIdentity();
    mocked.mockResolvedValueOnce(pageFixture);
    const wrapper = mountPage();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('待'); // PENDING 中文含「待」
    expect(text).toContain('方案A');
    wrapper.unmount();
  });

  it('分页切换：onPageChange 以 Number 分页参数 + 原样 person.id 重拉', async () => {
    setIdentity();
    mocked.mockResolvedValue(pageFixture);
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as { onPageChange: (p: { current?: number; pageSize?: number }) => void };
    vm.onPageChange({ current: 3, pageSize: 50 });
    await flushPromises();
    expect(mocked).toHaveBeenLastCalledWith('2096266884247736321', { pageNo: 3, pageSize: 50 });
    wrapper.unmount();
  });

  it('403/30001（IDOR 三分支拒）：错误 Alert 呈现 envelopeMessage 不吞错，列表清空', async () => {
    setIdentity();
    mocked.mockRejectedValueOnce(new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足，请联系管理员'));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('权限不足');
    expect(wrapper.text()).not.toContain('方案A');
    wrapper.unmount();
  });

  it('身份缺失（identity=null 且补拉失败）→ 不发请求，呈现「未取到登录身份」防御态', async () => {
    const auth = setIdentity();
    auth.identity = null;
    auth.refreshIdentity = vi.fn().mockRejectedValue(new IpdRequestError('登录已失效', 401, 20001, 'http')) as never;
    const wrapper = mountPage();
    await flushPromises();
    expect(mocked).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('未取到登录身份');
    wrapper.unmount();
  });
});
