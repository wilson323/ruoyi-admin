/**
 * 角色权限配置页（R215 权限可配置化，owner 指令 2026-09-24「确保权限可配置化」）：
 *   - 非超管角色闸（GROUP_LEADER → forbidden，不发请求）
 *   - 超管首屏：并行 GET /role-permissions + /role-permissions/effective，
 *     覆盖行空态 Empty + 四角色快照卡片计数
 *   - 有覆盖行：表格渲染 GRANT「增授」/REVOKE「收回」Tag + 删除按钮
 *   - 新增必填校验（remark 留痕必填，未填不发 POST）
 *   - 后端 403 → forbidden；断网 transport → offline 提示不崩
 *
 * 端点真值：GET/POST/DELETE /api/v1/role-permissions（+ /effective、/reload），
 * 后端 IpdRolePermissionController 全部仅 SUPER_ADMIN（注解 + requireAdmin 双保险）。
 * Mock 形态：依 .vue 同模块的 ipdGet/ipdPost/ipdDelete → authenticatedRequest → fetch 链。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RolePermission from './role-permission.vue';
import { useIpdAuthStore } from '../../../store/ipd-auth';

const envelope = (data: unknown, code = 0, messageText = 'success') => new Response(
  JSON.stringify({ code, message: code ? messageText : 'success', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
  { status: code ? 403 : 200, headers: { 'Content-Type': 'application/json' } },
);

const grantRow = {
  id: 'RP-1', personType: 'GROUP_LEADER', permissionCode: 'ipd:bonus-pool:compute',
  effect: 'GRANT', remark: 'N1 拍板 2026-09-24', createTime: '2026-09-25 01:00:00',
};
const revokeRow = {
  id: 'RP-2', personType: 'GROUP_LEADER', permissionCode: 'ipd:bonus-pool:freeze',
  effect: 'REVOKE', remark: '回收测试', createTime: '2026-09-25 01:10:00',
};

const snapshotStub = {
  SUPER_ADMIN: { javaDefault: ['ipd:bonus-pool:compute', 'ipd:bonus-pool:freeze'], dbGrant: [], dbRevoke: [], effective: ['ipd:bonus-pool:compute', 'ipd:bonus-pool:freeze'] },
  GROUP_LEADER: { javaDefault: ['ipd:bonus-pool:freeze'], dbGrant: ['ipd:bonus-pool:compute'], dbRevoke: [], effective: ['ipd:bonus-pool:compute', 'ipd:bonus-pool:freeze'] },
  MARKET_PM: { javaDefault: ['ipd:product:query'], dbGrant: [], dbRevoke: [], effective: ['ipd:product:query'] },
  RD_PM: { javaDefault: ['ipd:product:query'], dbGrant: [], dbRevoke: [], effective: ['ipd:product:query'] },
};

function setIdentity(personType: 'GROUP_LEADER' | 'SUPER_ADMIN') {
  useIpdAuthStore().identity = {
    mustChangePwd: false, scope: 'FULL',
    person: { id: '9007199254740993', groupId: 'GRP-1', name: '测试账号', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function stubApi(opts: { forbidden?: boolean; offline?: boolean; rows?: unknown[] } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET');
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });
    if (opts.offline) throw new TypeError('fetch failed');
    if (opts.forbidden) return envelope(null, 40301, '您没有执行此操作的权限');
    if (url.includes('/role-permissions/effective')) return envelope(snapshotStub);
    if (url.includes('/role-permissions/reload') && method === 'POST') return envelope({ grantRoles: 1, revokeRoles: 0 });
    if (url.includes('/role-permissions')) {
      if (method === 'POST') return envelope({ ...grantRow, id: 'RP-NEW' });
      if (method === 'DELETE') return envelope(null);
      return envelope(opts.rows ?? []);
    }
    return envelope(null, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('角色权限配置页 (R215)', () => {
  it('GROUP_LEADER 角色闸：直接 forbidden，不发任何 API 请求', async () => {
    const calls = stubApi();
    setIdentity('GROUP_LEADER');
    const wrapper = mount(RolePermission);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('本页仅系统超级管理员可访问');
    }, { timeout: 3000 });
    expect(calls.some((c) => c.url.includes('/role-permissions'))).toBe(false);
    wrapper.unmount();
  });

  it('超管空态：并行拉 list + effective，渲染 Empty 与四角色快照计数', async () => {
    const calls = stubApi();
    setIdentity('SUPER_ADMIN');
    const wrapper = mount(RolePermission);
    // 注意：loading 首帧也会渲染 Empty（Spin 只是遮罩），必须等 ready 态独有文本：
    // 快照卡片计数（GROUP_LEADER dbGrant=1 → 「GRANT 1」）只在两端点都返回后出现
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('GRANT 1');
    }, { timeout: 3000 });
    // 首屏并行两端点
    expect(calls.some((c) => c.url.includes('/role-permissions') && c.method === 'GET' && !c.url.includes('effective'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/role-permissions/effective') && c.method === 'GET')).toBe(true);
    // 覆盖行空态 + 快照卡片：四角色 + 计数
    const text = wrapper.text();
    expect(text).toContain('暂无覆盖行');
    expect(text).toContain('SUPER_ADMIN');
    expect(text).toContain('GROUP_LEADER');
    expect(text).toContain('MARKET_PM');
    expect(text).toContain('RD_PM');
    expect(text).toContain('生效 2');
    // 语义说明 Alert 披露覆盖层公式与边界
    expect(text).toContain('Java 默认 ∪ GRANT − REVOKE');
    wrapper.unmount();
  });

  it('覆盖行表格：GRANT「增授」/REVOKE「收回」Tag + 删除入口渲染', async () => {
    stubApi({ rows: [grantRow, revokeRow] });
    setIdentity('SUPER_ADMIN');
    const wrapper = mount(RolePermission);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('ipd:bonus-pool:compute');
    }, { timeout: 3000 });
    const text = wrapper.text();
    expect(text).toContain('ipd:bonus-pool:freeze');
    expect(text).toContain('增授');
    expect(text).toContain('收回');
    expect(text).toContain('N1 拍板 2026-09-24');
    expect(wrapper.html()).toMatch(/删\s*除/);
    wrapper.unmount();
  });

  it('新增必填校验：角色/权限码/依据未填时点提交不发 POST', async () => {
    const calls = stubApi();
    setIdentity('SUPER_ADMIN');
    const wrapper = mount(RolePermission);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('GRANT 1');
    }, { timeout: 3000 });
    const submit = wrapper.findAll('button').find((b) => b.text().replace(/\s/g, '').includes('新增覆盖行'));
    expect(submit).toBeTruthy();
    await submit!.trigger('click');
    await wrapper.vm.$nextTick();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/role-permissions'))).toBe(false);
    wrapper.unmount();
  });

  it('重建覆盖层：POST /role-permissions/reload 点击可达', async () => {
    const calls = stubApi();
    setIdentity('SUPER_ADMIN');
    const wrapper = mount(RolePermission);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('GRANT 1');
    }, { timeout: 3000 });
    const btn = wrapper.findAll('button').find((b) => b.text().includes('重建覆盖层'));
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/role-permissions/reload'))).toBe(true);
    }, { timeout: 3000 });
    wrapper.unmount();
  });

  it('后端 403（身份伪装绕过前端闸）：回退 forbidden 态', async () => {
    stubApi({ forbidden: true });
    setIdentity('SUPER_ADMIN');
    const wrapper = mount(RolePermission);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('本页仅系统超级管理员可访问');
    }, { timeout: 3000 });
    wrapper.unmount();
  });

  it('断网 transport 错误：offline 提示 + 组件不崩', async () => {
    stubApi({ offline: true });
    setIdentity('SUPER_ADMIN');
    const wrapper = mount(RolePermission);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('服务连接失败');
    }, { timeout: 3000 });
    // transport 分支的 rejectText 走 ant message 全局盒；jsdom 下 message 不落 DOM，
    // 以 offline Alert（仅 transport catch 内置位）+ 组件不崩为准
    expect(wrapper.text()).toContain('请检查网络后点刷新');
    wrapper.unmount();
  });
});
