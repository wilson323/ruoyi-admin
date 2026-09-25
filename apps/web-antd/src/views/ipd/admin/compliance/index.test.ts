// 合规中心视图测试（R215 GAP-F6；四 Tab：保留规则/删除请求/审计链/R-W 分离判定）。
// mock api/ipd/compliance 模块（字符串 ID 契约由 api/ipd/compliance.test.ts 锁定，
// 本文件验证视图接线：入参透传、校验拦截、渲染分支）。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import CompliancePage from './index.vue';

const api = vi.hoisted(() => ({
  checkPermissionSeparation: vi.fn(),
  createDataDeletionRequest: vi.fn(),
  fetchAuditTrail: vi.fn(),
  fetchRetentionRules: vi.fn(),
}));
vi.mock('../../../../api/ipd/compliance', () => api);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  api.checkPermissionSeparation.mockReset();
  api.createDataDeletionRequest.mockReset();
  api.fetchAuditTrail.mockReset();
  api.fetchRetentionRules.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPage() {
  const wrapper = mount(CompliancePage);
  return wrapper;
}

describe('合规中心视图（R215 GAP-F6）', () => {
  it('mount 即拉取保留规则并渲染表格（AC-COMP-01）', async () => {
    api.fetchRetentionRules.mockResolvedValueOnce([
      { resourceType: 'audit_logs', retentionDays: 2555, deletionPolicy: 'ARCHIVE', legalBasis: '内部留存' },
    ]);
    const wrapper = mountPage();
    await flushPromises();
    expect(api.fetchRetentionRules).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('audit_logs');
    expect(wrapper.text()).toContain('2555');
    wrapper.unmount();
  });

  it('保留规则加载被 403/30001 拒：错误 Alert 呈现后端 message，不吞错', async () => {
    // 真实形状：ApiV1ErrorCode.FORBIDDEN(30001,"权限不足")；ipdErrorText http 分支
    // 优先透传 envelopeMessage（R215-E2E-B 链），构造夹具时必须带上。
    api.fetchRetentionRules.mockRejectedValueOnce(
      new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足'),
    );
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });

  it('删除请求：resourceId 非数字前端拦截；合法时 string 透传 api（19 位雪花无损，禁 Number）', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      deletionForm: { reason: string; resourceId: string; resourceType: string };
      deletionError: string;
      submitDeletion: () => Promise<void>;
    };
    vm.activeTab = 'deletion';
    // 非法：含字母
    vm.deletionForm.resourceId = 'abc-123';
    vm.deletionForm.reason = '用户撤回授权';
    await vm.submitDeletion();
    expect(api.createDataDeletionRequest).not.toHaveBeenCalled();
    expect(vm.deletionError).toContain('纯数字');
    // 合法：19 位雪花字符串逐字符进 api
    api.createDataDeletionRequest.mockResolvedValueOnce({
      id: '1', resourceType: 'projects', resourceId: '2096266884247736321', requesterId: '900101',
      reason: '用户撤回授权', status: 'PENDING', deadlineAt: '2026-10-25 00:00:00', createdAt: '2026-09-25 00:00:00',
    });
    vm.deletionForm.resourceId = '2096266884247736321';
    await vm.submitDeletion();
    await flushPromises();
    expect(api.createDataDeletionRequest).toHaveBeenCalledWith({
      reason: '用户撤回授权',
      resourceId: '2096266884247736321',
      resourceType: 'projects',
    });
    wrapper.unmount();
  });

  it('审计链查询：type+ID+分页透传 api，渲染 records（AC-COMP-04）', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      auditForm: { pageNo: number; pageSize: number; resourceId: string; resourceType: string };
      queryAuditTrail: () => Promise<void>;
    };
    vm.activeTab = 'audit';
    vm.auditForm.resourceId = '2096266884247736321';
    api.fetchAuditTrail.mockResolvedValueOnce({
      current: 1, pages: 1, size: 20, total: 1,
      records: [{ seq: '9001', actorId: '900101', actorName: '张三', action: 'RESIGN', before: null, after: '{}', createTime: '2026-09-25 10:00:00', entityType: 'persons', entityId: '900101' }],
    });
    await vm.queryAuditTrail();
    await flushPromises();
    expect(api.fetchAuditTrail).toHaveBeenCalledWith('projects', '2096266884247736321', 1, 20);
    expect(wrapper.text()).toContain('张三');
    wrapper.unmount();
  });

  it('R/W 分离：conflict=true 渲染红标文案；userId 非法前端拦截（AC-COMP-05）', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      checkSeparation: () => Promise<void>;
      separationError: string;
      separationResult: null | { conflict: boolean };
      separationUserId: string;
    };
    vm.activeTab = 'separation';
    vm.separationUserId = '1.5';
    await vm.checkSeparation();
    expect(api.checkPermissionSeparation).not.toHaveBeenCalled();
    expect(vm.separationError).toContain('纯数字');

    api.checkPermissionSeparation.mockResolvedValueOnce({
      conflict: true, hasReadRole: true, hasWriteRole: true, roleList: ['compliance-reader', 'compliance-writer'], userId: '2096266884247736321',
    });
    vm.separationUserId = '2096266884247736321';
    await vm.checkSeparation();
    await flushPromises();
    expect(vm.separationResult?.conflict).toBe(true);
    expect(wrapper.text()).toContain('R/W 同源冲突');
    expect(wrapper.text()).toContain('compliance-writer');
    wrapper.unmount();
  });
});
