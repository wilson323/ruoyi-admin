/** 页28 组织架构：超管只读/非超管显示禁止访问卡/列表渲染/断网重试。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Index from './index.vue';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import type { IpdPersonType } from '../../../../api/ipd/auth';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const groups = [
  { id: '1', groupName: '智能终端组', leaderPersonId: '100', parentId: null, description: '智能终端方向', tenantId: '000000', delFlag: '0' },
  { id: '2', groupName: '工业视觉组', leaderPersonId: '101', parentId: null, description: '工业视觉方向', tenantId: '000000', delFlag: '0' },
];

function setupIdentity(role: IpdPersonType) {
  sessionStorage.setItem('ruoyi-ipd.session', JSON.stringify({
    accessToken: 'token-fake', refreshToken: 'r-fake',
    accessExpiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 7_200_000,
    refreshState: 'ready',
  }));
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: { id: '201', name: '测试用户', username: 'fixture', accountStatus: 'ACTIVE', groupId: '5', personType: role },
    scope: 'FULL',
  };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('页28 组织架构', () => {
  it('超管场景：渲染产品组列表 + 第三方同步 tag', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope(groups)));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('智能终端组'));
    expect(wrapper.text()).toContain('第三方同步');
    expect(wrapper.text()).toContain('工业视觉组');
    // 规格要求不显示「新增产品组」「改组长」按钮（第三方托管）
    const buttons = wrapper.findAll('button').map((b) => b.text().replace(/\s+/g, ''));
    expect(buttons.some((text) => text.includes('新增产品组'))).toBe(false);
    expect(buttons.some((text) => text.includes('改组长'))).toBe(false);
    wrapper.unmount();
  });

  it('非超管场景：仅显示「超级管理员专属」卡片，不发起列表请求', async () => {
    setupIdentity('MARKET_PM');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('超级管理员专属'));
    // 没有 GET /product-groups 调用
    const paths = fetcher.mock.calls.map(([target]) => String(target));
    expect(paths.some((p) => p.includes('/product-groups'))).toBe(false);
    wrapper.unmount();
  });

  it('空结果显示空态引导', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope([])));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无产品组记录'));
    wrapper.unmount();
  });

  it('业务拒绝展示统一中文文案', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope(null, 400, 10001)));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('输入信息不符合要求'));
    wrapper.unmount();
  });

  it('断网展示网络文案并可重试', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(envelope(groups));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
    await wrapper.find('[role="alert"] button').trigger('click');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(wrapper.text()).toContain('智能终端组'));
    wrapper.unmount();
  });
});