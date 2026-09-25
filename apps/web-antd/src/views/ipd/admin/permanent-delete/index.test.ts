// 超管永久清除工作台视图测试（R215 GAP-F10）。mock api/ipd/admin-permanent-delete 模块
// （string 透传/白名单守卫由 api/ipd/admin-permanent-delete.test.ts 锁定，本文件验证视图接线：
// 三道前置校验、Modal 复述、成功回拉、错误呈现、快照容错）。页面仅超管可达由路由双闸保证
// （父级 IpdAdmin authority + meta.access），组件层不再判角色。
import { flushPromises, mount } from '@vue/test-utils';
import { message } from 'ant-design-vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdIdentity } from '../../../../api/ipd/auth';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import PermanentDeletePage from './index.vue';

const api = vi.hoisted(() => ({
  executePermanentDelete: vi.fn(),
  listPermanentDeleteAudit: vi.fn(),
}));
vi.mock('../../../../api/ipd/admin-permanent-delete', () => api);

const auditRow = (over: Record<string, unknown> = {}) => ({
  id: '2096266884247737001', operatorId: '2096266884054798338', operatorName: '超管甲',
  entityType: 'person', entityId: '2096266884247736321',
  originalDataJson: '{"id":"2096266884247736321","name":"李四"}',
  deletedAt: '2026-09-24T10:15:30.000+00:00', ipAddress: '10.0.0.8', tenantId: '000000', delFlag: '0',
  ...over,
});

function setSuperAdmin() {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: {
      accountStatus: 'ACTIVE', groupId: '12', id: '2096266884054798338',
      name: '超管甲', personType: 'SUPER_ADMIN', username: 'admin',
    },
    scope: 'FULL',
  } satisfies IpdIdentity;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  for (const fn of Object.values(api)) fn.mockReset();
  api.listPermanentDeleteAudit.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPage() {
  setSuperAdmin();
  return mount(PermanentDeletePage);
}

describe('超管永久清除工作台视图（R215 GAP-F10）', () => {
  it('mount 即拉审计对账（onMounted 一次，禁轮询）；19 位雪花审计 ID / 实体 ID 逐字符渲染', async () => {
    api.listPermanentDeleteAudit.mockResolvedValueOnce([auditRow()]);
    const wrapper = mountPage();
    await flushPromises();
    expect(api.listPermanentDeleteAudit).toHaveBeenCalledTimes(1);
    expect(api.listPermanentDeleteAudit).toHaveBeenCalledWith(undefined, 50); // 缺省过滤 + 默认档 50
    expect(wrapper.text()).toContain('2096266884247737001');
    expect(wrapper.text()).toContain('2096266884247736321');
    wrapper.unmount();
  });

  it('三道前置校验逐一拦截不发请求：未选类型 / 非纯数字 ID / 空确认码（对齐 @NotBlank :89 与 /^\d+$/ 口径）', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      execForm: { confirmCode: string; entityType: string; id: string };
      execError: string;
      confirmOpen: boolean;
      openConfirm: () => void;
    };
    // ① 未选实体类型
    vm.openConfirm();
    expect(api.executePermanentDelete).not.toHaveBeenCalled();
    expect(vm.confirmOpen).toBe(false);
    expect(vm.execError).toContain('实体类型');
    // ② 非纯数字 ID（19 位雪花必须文本形态提交）
    vm.execForm.entityType = 'project';
    vm.execForm.id = 'not-a-number';
    vm.openConfirm();
    expect(vm.execError).toContain('纯数字');
    // ③ 空确认码（后端 @NotBlank 的前端前置）
    vm.execForm.id = '2096266884247736321';
    vm.openConfirm();
    expect(vm.execError).toContain('确认码');
    expect(vm.confirmOpen).toBe(false); // 校验不过 Modal 不开
    wrapper.unmount();
  });

  it('合法表单 → Modal 复述三元组打开；doExecute 透传原样参数、成功后 toast 带审计 ID 并回拉对账、表单重置', async () => {
    const success = vi.spyOn(message, 'success').mockImplementation(vi.fn() as never);
    api.executePermanentDelete.mockResolvedValueOnce({
      auditId: '2096266884247736999', entityType: 'project', entityId: '2096266884247736321',
      operatorId: '2096266884054798338', operatorName: '超管甲', permanentlyDeleted: true,
    });
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      execForm: { confirmCode: string; entityType: string; id: string };
      confirmOpen: boolean;
      doExecute: () => Promise<void>;
      openConfirm: () => void;
    };
    vm.execForm.entityType = 'project';
    vm.execForm.id = ' 2096266884247736321 ';
    vm.execForm.confirmCode = 'PERMANENT_DELETE_CONFIRMED';
    vm.openConfirm();
    expect(vm.confirmOpen).toBe(true); // Modal 复述开闸
    await vm.doExecute();
    await flushPromises();
    expect(api.executePermanentDelete).toHaveBeenCalledWith('project', '2096266884247736321', 'PERMANENT_DELETE_CONFIRMED'); // trim 后原样透传
    expect(success).toHaveBeenCalledWith(expect.stringContaining('2096266884247736999'));
    expect(api.listPermanentDeleteAudit).toHaveBeenCalledTimes(2); // 成功后回拉
    expect(vm.execForm.entityType).toBe(''); // 表单重置
    expect(vm.execForm.id).toBe('');
    expect(vm.confirmOpen).toBe(false);
    wrapper.unmount();
  });

  it('doExecute 被 confirmCode 错码业务拒（code≠0）：Modal 关闭、错误 Alert 呈现后端原文，不吞错', async () => {
    api.executePermanentDelete.mockRejectedValueOnce(
      new IpdRequestError('HTTP 200', 200, 30000, 'http', 'confirmCode 错误，必须等于：PERMANENT_DELETE_CONFIRMED'),
    );
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      execForm: { confirmCode: string; entityType: string; id: string };
      execError: string;
      confirmOpen: boolean;
      doExecute: () => Promise<void>;
    };
    vm.execForm.entityType = 'person';
    vm.execForm.id = '900101';
    vm.execForm.confirmCode = 'CONFIRMED';
    vm.confirmOpen = true;
    await vm.doExecute();
    await flushPromises();
    expect(vm.confirmOpen).toBe(false);
    expect(vm.execError).toContain('confirmCode 错误');
    wrapper.unmount();
  });

  it('审计表 403/30001 负例：错误 Alert 呈现不吞；过滤切换按档位透传（kpi_record + 100）', async () => {
    api.listPermanentDeleteAudit.mockRejectedValueOnce(
      new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足，请联系管理员'),
    );
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('权限不足');
    const vm = wrapper.vm as unknown as {
      filterLimit: number;
      filterType: string;
      loadAudit: () => Promise<void>;
    };
    vm.filterType = 'kpi_record';
    vm.filterLimit = 100;
    await vm.loadAudit();
    await flushPromises();
    expect(api.listPermanentDeleteAudit).toHaveBeenLastCalledWith('kpi_record', 100);
    wrapper.unmount();
  });

  it('快照查看：合法 JSON 格式化展开；非法 JSON 原文兜底不抛', async () => {
    api.listPermanentDeleteAudit.mockResolvedValueOnce([
      auditRow(),
      auditRow({ id: '900102', entityType: 'kpi_record', entityId: '2096266884247736455', originalDataJson: '{broken json 原文' }),
    ]);
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      showSnapshot: (row: Record<string, unknown>) => void;
      snapshotOpen: boolean;
      snapshotText: string;
      snapshotTitle: string;
    };
    // showSnapshot 入参为 api 归一后的行（与 auditRow 夹具同构）；合法 JSON → 格式化展开
    vm.showSnapshot(auditRow());
    expect(vm.snapshotOpen).toBe(true);
    expect(vm.snapshotTitle).toContain('2096266884247736321');
    expect(vm.snapshotText).toBe('{\n  "id": "2096266884247736321",\n  "name": "李四"\n}');
    // 非法 JSON → 原文兜底不抛
    vm.showSnapshot(auditRow({ id: '900102', entityType: 'kpi_record', entityId: '2096266884247736455', originalDataJson: '{broken json 原文' }));
    expect(vm.snapshotText).toBe('{broken json 原文');
    wrapper.unmount();
  });
});
