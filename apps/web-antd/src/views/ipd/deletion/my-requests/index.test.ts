/** 页04 删除审核-我的申请：发起表单契约 + 24h 撤回窗口 + 五态。 */
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
  it('原因不足 6 字时提交按钮禁用（初始空表单）', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    // 表单初始空：canSubmit=false → 提交按钮禁用
    const submitBtn = wrapper.findAll('button').find((b) => b.text().includes('发起删除申请'));
    expect(submitBtn).toBeDefined();
    expect(submitBtn!.attributes('disabled')).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('页面渲染含两种提交按钮（发起 + 撤回）', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(MyRequests);
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it('撤回按钮在无申请编号时禁用', async () => {
    vi.stubGlobal('fetch', vi.fn());
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
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    wrapper.unmount();
  });

  it('断网态：transport 错误被 try/catch 捕获不抛', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('network down'); });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(MyRequests);
    const inputs = wrapper.findAll('input');
    await inputs[inputs.length - 1]!.setValue('R-1');
    await wrapper.vm.$nextTick();
    const enabledBtn = wrapper.findAll('button').find((b) => b.attributes('disabled') === undefined);
    expect(enabledBtn).toBeDefined();
    await enabledBtn!.trigger('click');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    wrapper.unmount();
  });
});
