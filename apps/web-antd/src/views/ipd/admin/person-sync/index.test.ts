// 人员同步任务页视图测试（R215 GAP-F7）。mock api/ipd/person-sync 模块
// （string 透传/枚举守卫由 api/ipd/person-sync.test.ts 锁定，本文件验证视图接线：
// 角色收敛、入参透传、加载分支、错误呈现）。
import { flushPromises, mount } from '@vue/test-utils';
import { message } from 'ant-design-vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdIdentity } from '../../../../api/ipd/auth';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import PersonSyncPage from './index.vue';

const api = vi.hoisted(() => ({
  listAbnormalSyncJobs: vi.fn(),
  listSyncJobs: vi.fn(),
  retryAllSyncJobs: vi.fn(),
  retrySyncJob: vi.fn(),
  submitSyncJob: vi.fn(),
}));
vi.mock('../../../../api/ipd/person-sync', () => api);

const jobRow = (over: Record<string, unknown> = {}) => ({
  attempts: 2, createdAt: '2026-09-25T01:00:00Z', employeeNo: 'E001',
  failureKind: 'TRANSIENT', failureReason: 'HR 网关超时', jobId: 'sync-ab12cd34-7',
  maxAttempts: 3, nextRetryAt: '2026-09-25T02:30:00Z', status: 'FAILED',
  updatedAt: '2026-09-25T02:00:00Z', ...over,
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
  api.listSyncJobs.mockResolvedValue([]);
  api.listAbnormalSyncJobs.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPage(personType: 'GROUP_LEADER' | 'SUPER_ADMIN') {
  setIdentity(personType);
  return mount(PersonSyncPage);
}

describe('人员同步任务页视图（R215 GAP-F7）', () => {
  it('超管 mount 即拉列表（onMounted 一次，禁轮询）；19 位雪花形态工号逐字符渲染', async () => {
    api.listSyncJobs.mockResolvedValueOnce([jobRow({ employeeNo: '2096266884247736321' })]);
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    expect(api.listSyncJobs).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('2096266884247736321');
    expect(wrapper.text()).toContain('sync-ab12cd34-7');
    wrapper.unmount();
  });

  it('行重试按钮仅 FAILED 行显示；点击透传原样 jobId 并回拉列表', async () => {
    api.listSyncJobs.mockResolvedValueOnce([
      jobRow(),
      jobRow({ jobId: 'sync-ok-1', status: 'SUCCESS', failureKind: null, failureReason: null }),
    ]);
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    expect(wrapper.findAll('button').filter((b) => b.text().replace(/\s/g, '') === '重试')).toHaveLength(1);
    const vm = wrapper.vm as unknown as { doRetry: (id: string) => Promise<void> };
    api.retrySyncJob.mockResolvedValueOnce(jobRow({ status: 'RETRYING' }));
    await vm.doRetry('sync-ab12cd34-7');
    await flushPromises();
    expect(api.retrySyncJob).toHaveBeenCalledWith('sync-ab12cd34-7');
    expect(api.listSyncJobs).toHaveBeenCalledTimes(2); // 重试成功后回拉
    wrapper.unmount();
  });

  it('组长 mount 不打列表端点（GET /jobs 仅超管）；批量回补按钮不渲染；直连重试入口可用', async () => {
    const wrapper = mountPage('GROUP_LEADER');
    await flushPromises();
    expect(api.listSyncJobs).not.toHaveBeenCalled();
    expect(wrapper.findAll('button').some((b) => b.text().includes('批量回补'))).toBe(false);
    const vm = wrapper.vm as unknown as { doLeaderRetry: () => Promise<void>; leaderRetryId: string };
    api.retrySyncJob.mockResolvedValueOnce(jobRow({ status: 'RETRYING' }));
    vm.leaderRetryId = ' sync-ab12cd34-7 ';
    await vm.doLeaderRetry();
    await flushPromises();
    expect(api.retrySyncJob).toHaveBeenCalledWith('sync-ab12cd34-7'); // trim 后原样透传
    wrapper.unmount();
  });

  it('提交表单：空工号前端拦截；合法时自动生成 ui-<ts> 幂等键防连点', async () => {
    const wrapper = mountPage('GROUP_LEADER');
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      doSubmit: () => Promise<void>;
      submitError: string;
      submitForm: { employeeNo: string; idempotencyKey: string };
    };
    await vm.doSubmit();
    expect(api.submitSyncJob).not.toHaveBeenCalled();
    expect(vm.submitError).toContain('必填');
    api.submitSyncJob.mockResolvedValueOnce({ jobId: 'sync-new-1', status: 'PENDING' });
    vm.submitForm.employeeNo = ' E002 ';
    await vm.doSubmit();
    await flushPromises();
    const [employeeNo, key] = api.submitSyncJob.mock.calls[0]!;
    expect(employeeNo).toBe('E002');
    expect(String(key)).toMatch(/^ui-\d+$/);
    wrapper.unmount();
  });

  it('批量回补成功：toast 呈现 retried/succeeded/failed/skipped 四计数', async () => {
    const success = vi.spyOn(message, 'success').mockImplementation(vi.fn() as never);
    api.retryAllSyncJobs.mockResolvedValueOnce({ retried: 5, succeeded: 3, failed: 1, skipped: 1 });
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    const vm = wrapper.vm as unknown as { doRetryAll: () => Promise<void> };
    await vm.doRetryAll();
    expect(api.retryAllSyncJobs).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(expect.stringContaining('重试 5 · 成功 3 · 失败 1 · 跳过 1'));
    wrapper.unmount();
  });

  it('列表加载被 403/30001 拒：错误 Alert 呈现后端 envelopeMessage，不吞错', async () => {
    api.listSyncJobs.mockRejectedValueOnce(new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足，请联系管理员'));
    const wrapper = mountPage('SUPER_ADMIN');
    await flushPromises();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });
});
