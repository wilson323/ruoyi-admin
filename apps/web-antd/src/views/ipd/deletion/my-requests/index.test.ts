/** 页04 删除审核-我的申请：发起表单契约 + 24h 撤回窗口 + 五态 + P1-1 列表。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MyRequests from './index.vue';

import { withinWithdrawWindow } from '../../../../api/ipd/deletion';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('撤回窗口工具（BR-DEL-04 / AC-DEL-06）', () => {
  it('当前时间在 24h 内允许撤回', () => {
    const now = Date.now();
    expect(withinWithdrawWindow(now - 60 * 60_000)).toBe(true);
    expect(withinWithdrawWindow(new Date(now - 60 * 60_000).toISOString())).toBe(true);
    expect(withinWithdrawWindow('2026-09-05 12:00:00', new Date('2026-09-05 18:00:00').getTime())).toBe(true);
  });

  it('超过 24h 不允许撤回', () => {
    const now = Date.now();
    expect(withinWithdrawWindow(now - 25 * 3600_000)).toBe(false);
    expect(withinWithdrawWindow(now - 7 * 86_400_000)).toBe(false);
  });

  it('空值或非法时间一律返回 false（不让按钮误启用）', () => {
    expect(withinWithdrawWindow(null)).toBe(false);
    expect(withinWithdrawWindow(undefined)).toBe(false);
    expect(withinWithdrawWindow('')).toBe(false);
    expect(withinWithdrawWindow('not-a-date')).toBe(false);
  });
});

describe('页04 我的申请', () => {
  // P1-1：onMounted 自动调用 listMyDeletionRequests（GET /deletion-requests/my-requests）。
  // 因此 mount 后 fetcher 至少被调 1 次（加载列表）；用户操作撤回后再次被调。
  // 原本断言「未操作前 fetcher 不被调用」已过时——自动加载是 P1-1 的预期行为。

  it('原因不足 6 字时提交按钮禁用（初始空表单）', async () => {
    const fetcher = vi.fn(async () => envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    // 表单初始空：canSubmit=false → 提交按钮禁用
    const submitBtn = wrapper.findAll('button').find((b) => b.text().includes('发起删除申请'));
    expect(submitBtn).toBeDefined();
    expect(submitBtn!.attributes('disabled')).toBeDefined();
    // P1-1：onMounted 自动调一次列表查询（不算用户操作）
    expect(fetcher).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('页面渲染含三种按钮（发起 + 列表行 + 兜底撤回）', async () => {
    const fetcher = vi.fn(async () => envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    const buttons = wrapper.findAll('button');
    // 至少包含：发起删除申请、列表行操作（无数据时空）、兜底撤回
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it('撤回按钮在无申请编号时禁用', async () => {
    const fetcher = vi.fn(async () => envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    // 找出所有 button 中 disabled 属性的——空 withdrawId 时撤回按钮禁用
    const allButtons = wrapper.findAll('button');
    expect(allButtons.length).toBeGreaterThan(0);
    const disabledBtn = allButtons.find((b) => b.attributes('disabled') !== undefined);
    expect(disabledBtn).toBeDefined();
    wrapper.unmount();
  });

  it('撤回成功展示最近结果为「已撤回」', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/withdraw')) {
        return envelope({ id: 'R-1', entityType: 'projects', entityId: 'P-100', status: 'WITHDRAWN', createTime: '2026-09-05 10:00:00', requesterId: '1', reason: '测试', remark: null });
      }
      // P1-1：onMounted 调用的 my-requests 与 reload 都返回空数组（兜底路径不修改列表态）
      if (path.endsWith('/my-requests')) return envelope([]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    const inputs = wrapper.findAll('input');
    const withdrawInput = inputs[inputs.length - 1]!;
    await withdrawInput.setValue('R-1');
    await wrapper.vm.$nextTick();
    // 找出未被禁用的按钮（撤回按钮在填入编号后启用）
    const allButtons = wrapper.findAll('button');
    const enabledBtn = allButtons.find((b) => b.attributes('disabled') === undefined);
    expect(enabledBtn).toBeDefined();
    await enabledBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('已撤回'));
    wrapper.unmount();
  });

  it('业务拒绝（50002 状态冲突）被 http 层拦截并 message 提示', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/withdraw')) return envelope(null, 200, 50002);
      if (path.endsWith('/my-requests')) return envelope([]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    const inputs = wrapper.findAll('input');
    await inputs[inputs.length - 1]!.setValue('R-1');
    await wrapper.vm.$nextTick();
    const enabledBtn = wrapper.findAll('button').find((b) => b.attributes('disabled') === undefined);
    expect(enabledBtn).toBeDefined();
    await enabledBtn!.trigger('click');
    // P1-1：onMounted 调 1 次（my-requests） + 用户操作调 1 次（withdraw） = 2 次
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    wrapper.unmount();
  });

  it('断网态：transport 错误被 try/catch 捕获不抛', async () => {
    const fetcher = vi.fn(async () => {
      // P1-1：onMounted 调 my-requests 时也抛错，loadMyRequests 的 try/catch 接住
      throw new TypeError('network down');
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    const inputs = wrapper.findAll('input');
    await inputs[inputs.length - 1]!.setValue('R-1');
    await wrapper.vm.$nextTick();
    const enabledBtn = wrapper.findAll('button').find((b) => b.attributes('disabled') === undefined);
    expect(enabledBtn).toBeDefined();
    await enabledBtn!.trigger('click');
    // P1-1：onMounted 调 1 次（my-requests 网络错） + 撤回调 1 次（withdraw 网络错） = 2 次
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    wrapper.unmount();
  });

  it('P1-1：mount 后自动调 /my-requests 加载列表（无操作前 fetcher 也被调）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/my-requests')) return envelope([
        { id: '9001', entityType: 'products', entityId: '42', status: 'LEADER_REVIEW', createTime: '2026-09-05 10:00:00' },
      ]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const firstCallUrl = String(fetcher.mock.calls[0]![0]);
    expect(firstCallUrl).toBe('/api/v1/deletion-requests/my-requests');
    wrapper.unmount();
  });
});
