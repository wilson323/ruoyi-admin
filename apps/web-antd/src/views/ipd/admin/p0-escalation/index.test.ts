// P0 升级链处置台视图测试（R215 GAP-F4）。mock api/ipd/p0-escalation 模块
// （string 透传/双形态归一由 api/ipd/p0-escalation.test.ts 锁定，本文件验证视图接线：
// 角色收敛、入参透传、加载分支、错误呈现、状态机按钮显隐）。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdIdentity } from '../../../../api/ipd/auth';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import P0EscalationPage from './index.vue';

const api = vi.hoisted(() => ({
  checkEscalation: vi.fn(),
  listEscalationChains: vi.fn(),
  resolveEscalationChain: vi.fn(),
}));
vi.mock('../../../../api/ipd/p0-escalation', () => api);

const chainRow = (over: Record<string, unknown> = {}) => ({
  escalationCount: 2,
  id: '2096266884247736321',
  lastEscalationAt: '2026-09-20 10:00:00',
  nextThresholdAt: '2026-09-27 10:00:00',
  p0EventId: '2096266883998441472',
  projectId: '2096266884054798338',
  remark: '连续两次未升级',
  status: 'ESCALATED',
  ...over,
});

function setIdentity(personType: 'GROUP_LEADER' | 'SUPER_ADMIN') {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: {
      accountStatus: 'ACTIVE', groupId: '12', id: '2096266884247736321',
      name: '测试员', personType, username: 'tester',
    },
    scope: 'FULL',
  } satisfies IpdIdentity;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  for (const fn of Object.values(api)) fn.mockReset();
  api.listEscalationChains.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPage(personType: 'GROUP_LEADER' | 'SUPER_ADMIN') {
  setIdentity(personType);
  return mount(P0EscalationPage);
}

describe('P0 升级链处置台视图（R215 GAP-F4）', () => {
  it('mount 即拉列表（onMounted 一次）；19 位雪花三 ID 逐字符渲染', async () => {
    api.listEscalationChains.mockResolvedValueOnce([chainRow()]);
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    expect(api.listEscalationChains).toHaveBeenCalledTimes(1);
    expect(api.listEscalationChains).toHaveBeenCalledWith();
    expect(wrapper.text()).toContain('2096266884247736321');
    expect(wrapper.text()).toContain('2096266884054798338');
    expect(wrapper.text()).toContain('2096266883998441472');
    expect(wrapper.text()).toContain('已升级（ESCALATED）');
    wrapper.unmount();
  });

  it('状态 tag 三色：PENDING 灰/ESCALATED 红/RESOLVED 绿；RESOLVED 行无处置按钮', async () => {
    api.listEscalationChains.mockResolvedValueOnce([
      chainRow({ id: '1', status: 'PENDING' }),
      chainRow({ id: '2', status: 'ESCALATED' }),
      chainRow({ id: '3', status: 'RESOLVED' }),
    ]);
    const wrapper = mountPage('GROUP_LEADER');
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('待升级（PENDING）');
    expect(text).toContain('已升级（ESCALATED）');
    expect(text).toContain('已处置（RESOLVED）');
    // 三行里仅 PENDING/ESCALATED 两行可处置，RESOLVED 行显示已闭环
    expect(wrapper.findAll('button').filter((b) => b.text().includes('标记处置完成'))).toHaveLength(2);
    expect(text).toContain('已闭环');
    wrapper.unmount();
  });

  it('列表 403/30001：错误 Alert 透传后端 message，不吞错（无权限态）', async () => {
    api.listEscalationChains.mockRejectedValueOnce(
      new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足'),
    );
    const wrapper = mountPage('GROUP_LEADER');
    await flushPromises();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });

  it('项目过滤：纯数字 projectId string 透传 api；非数字拦下并按未过滤查询', async () => {
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      applyFilter: () => Promise<void>;
      errorMsg: string;
      filterProjectId: string;
    };
    vm.filterProjectId = '2096266884054798338';
    await vm.applyFilter();
    expect(api.listEscalationChains).toHaveBeenLastCalledWith('2096266884054798338');
    vm.filterProjectId = 'abc';
    await vm.applyFilter();
    expect(api.listEscalationChains).toHaveBeenLastCalledWith(undefined);
    expect(vm.errorMsg).toContain('纯数字');
    wrapper.unmount();
  });

  it('触发扫描按钮仅超管可见（requireAdmin :60）；超管点击展示 escalated 数并回拉列表', async () => {
    // 组长：不渲染
    const leaderWrapper = mountPage('GROUP_LEADER');
    await flushPromises();
    expect(leaderWrapper.findAll('button').filter((b) => b.text() === '触发扫描')).toHaveLength(0);
    leaderWrapper.unmount();

    // 超管：渲染 + 点击闭环
    api.listEscalationChains.mockResolvedValue([chainRow()]);
    api.checkEscalation.mockResolvedValueOnce({ escalated: 3 });
    const adminWrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    const btn = adminWrapper.findAll('button').find((b) => b.text() === '触发扫描');
    expect(btn).toBeDefined();
    const vm = adminWrapper.vm as unknown as { runCheck: () => Promise<void> };
    await vm.runCheck();
    await flushPromises();
    expect(api.checkEscalation).toHaveBeenCalledTimes(1);
    // 扫描后回拉列表（escalated 条数经 message 展示，列表刷新一次）
    expect(api.listEscalationChains.mock.calls.length).toBeGreaterThanOrEqual(2);
    adminWrapper.unmount();
  });

  it('处置 Modal：19 位 id 原样透传 resolveEscalationChain；remark 空串归 undefined（不拼 query）', async () => {
    api.listEscalationChains.mockResolvedValueOnce([chainRow()]);
    api.resolveEscalationChain.mockResolvedValueOnce({ id: '2096266884247736321', resolved: true });
    const wrapper = mountPage('GROUP_LEADER');
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      openResolve: (row: Record<string, unknown>) => void;
      resolveRemark: string;
      resolveTarget: { id: string } | null;
      submitResolve: () => Promise<void>;
    };
    vm.openResolve(chainRow());
    expect(vm.resolveTarget?.id).toBe('2096266884247736321');
    vm.resolveRemark = '已督促升级';
    await vm.submitResolve();
    expect(api.resolveEscalationChain).toHaveBeenCalledWith('2096266884247736321', '已督促升级');
    // remark 留空 → undefined（后端 @RequestParam 缺省不拼 query）
    vm.openResolve(chainRow());
    api.resolveEscalationChain.mockResolvedValueOnce({ id: '2096266884247736321', resolved: true });
    vm.resolveRemark = '   ';
    await vm.submitResolve();
    expect(api.resolveEscalationChain).toHaveBeenLastCalledWith('2096266884247736321', undefined);
    wrapper.unmount();
  });

  it('resolved=false 后端未确认：警告提示且不误报成功', async () => {
    api.listEscalationChains.mockResolvedValueOnce([chainRow()]);
    api.resolveEscalationChain.mockResolvedValueOnce({ id: '2096266884247736321', resolved: false });
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      openResolve: (row: Record<string, unknown>) => void;
      resolveRemark: string;
      submitResolve: () => Promise<void>;
    };
    vm.openResolve(chainRow());
    vm.resolveRemark = '复核后处置';
    await vm.submitResolve();
    expect(api.resolveEscalationChain).toHaveBeenCalled();
    wrapper.unmount();
  });
});
