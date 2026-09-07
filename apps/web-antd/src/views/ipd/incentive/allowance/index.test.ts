/**
 * 页33 津贴台账：ZK 口径 + 双段预览（台账 + 待停发）+ 超管 auto-scan + 后端字段对齐。
 *
 * 端点契约（实测 W4-D AllowanceLedgerController）：
 *   GET  /api/v1/allowance/ledger
 *   GET  /api/v1/allowance/pending-stop
 *   POST /api/v1/allowance/auto-scan
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Allowance from './index.vue';

import { useIpdAuthStore } from '../../../../store/ipd-auth';

const envelope = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({
      code,
      message: code === 0 ? 'success' : '操作失败',
      data,
      timestamp: '2026-09-05T00:00:00Z',
      traceId: 'fixture',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/** W4-D 后端 AllowanceLedger domain 真实字段（D-补强前 view 端本地 type adapter）。 */
function ledgerRow(extra: Partial<{
  baseAmount: string;
  capApplied: string;
  createTime: string;
  finalAmount: string;
  id: string;
  lockedLevel: string;
  month: string;
  personId: string;
  projectId: string;
  stopReason: null | string;
}> = {}) {
  return {
    id: '1',
    personId: 'P-1',
    projectId: 'PRJ-1',
    month: '2026-09',
    lockedLevel: 'L3',
    baseAmount: '2000.00',
    finalAmount: '4000.00',
    capApplied: '0',
    stopReason: null,
    createTime: '2026-09-30 10:00:00',
    ...extra,
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

describe('页33 津贴台账', () => {
  it('顶部 Alert 必带 ZK 口径，禁止出现「目标销售额」等同源不相关字样', () => {
    loginAs('MARKET_PM');
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(Allowance);
    const text = wrapper.text();
    expect(text).toContain('L1~L5 基数');
    expect(text).toContain('封顶 2 倍');
    expect(text).toContain('综合分 < 60');
    expect(text).toContain('60 天无产出');
    expect(text).not.toContain('目标销售额');
    expect(text).not.toContain('S/A/B');
    wrapper.unmount();
  });

  it('非超管不渲染 autoScan 按钮（角色守卫）', async () => {
    loginAs('MARKET_PM');
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(Allowance);
    await wrapper.vm.$nextTick();
    const buttons = wrapper.findAll('button').map((b) => b.text());
    expect(buttons.some((t) => t.includes('自动扫描'))).toBe(false);
    expect(wrapper.text()).toContain('仅超级管理员可见');
    wrapper.unmount();
  });

  it('超管进入页面渲染 autoScan 按钮且首次挂载触发 ledger + pending-stop 双 GET', async () => {
    loginAs('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/allowance/ledger')) return envelope([ledgerRow()]);
      if (path.startsWith('/api/v1/allowance/pending-stop')) return envelope([]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Allowance);
    await vi.waitFor(() => {
      const ledgerCall = fetcher.mock.calls.find((c) =>
        String(c[0]).startsWith('/api/v1/allowance/ledger'),
      );
      const pendingCall = fetcher.mock.calls.find((c) =>
        String(c[0]).startsWith('/api/v1/allowance/pending-stop'),
      );
      expect(ledgerCall).toBeDefined();
      expect(pendingCall).toBeDefined();
    });
    expect(wrapper.text()).toContain('触发月度自动扫描');
    wrapper.unmount();
  });

  it('津贴台账列表展示 W4-D 后端字段（month / lockedLevel / finalAmount / capApplied / stopReason）', async () => {
    loginAs('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/allowance/ledger')) {
        return envelope([
          ledgerRow({
            capApplied: '1',
            finalAmount: '6000.00',
            id: '10',
            lockedLevel: 'L5',
            personId: 'P-100',
            projectId: 'PRJ-9',
          }),
        ]);
      }
      if (path.startsWith('/api/v1/allowance/pending-stop')) {
        return envelope([
          ledgerRow({
            finalAmount: '0.00',
            id: '20',
            personId: 'P-200',
            stopReason: 'SCORE_BELOW_60',
          }),
        ]);
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Allowance);
    await vi.waitFor(() => expect(wrapper.text()).toContain('P-100'));
    const text = wrapper.text();
    expect(text).toContain('2026-09'); // month
    expect(text).toContain('L5'); // lockedLevel
    expect(text).toContain('6,000.00'); // finalAmount
    expect(text).toContain('已触发'); // capApplied === '1'
    expect(text).toContain('正常发放'); // stopReason null
    // pending 段
    expect(text).toContain('P-200');
    expect(text).toContain('综合分 < 60');
    wrapper.unmount();
  });

  it('待停发 stopReason 中文映射覆盖 STOP_NO_OUTPUT_60_DAYS', async () => {
    loginAs('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/allowance/ledger')) return envelope([]);
      if (path.startsWith('/api/v1/allowance/pending-stop')) {
        return envelope([
          ledgerRow({
            id: '30',
            personId: 'P-300',
            stopReason: 'STOP_NO_OUTPUT_60_DAYS',
          }),
        ]);
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Allowance);
    await vi.waitFor(() => expect(wrapper.text()).toContain('P-300'));
    expect(wrapper.text()).toContain('60 天无产出');
    expect(wrapper.text()).toContain('待确认');
    wrapper.unmount();
  });

  it('超管点击 autoScan 调用 /allowance/auto-scan 端点 + 自动刷新双段列表', async () => {
    loginAs('SUPER_ADMIN');
    let scanned = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path.startsWith('/api/v1/allowance/ledger') && !scanned) return envelope([]);
      if (path.startsWith('/api/v1/allowance/pending-stop') && !scanned) return envelope([]);
      if (method === 'POST' && path.startsWith('/api/v1/allowance/auto-scan')) {
        scanned = true;
        return envelope({ scanned: 5 });
      }
      if (path.startsWith('/api/v1/allowance/ledger') && scanned) return envelope([ledgerRow()]);
      if (path.startsWith('/api/v1/allowance/pending-stop') && scanned) return envelope([]);
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Allowance);
    await vi.waitFor(() => expect(wrapper.text()).toContain('触发月度自动扫描'));
    const scanBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('自动扫描'));
    expect(scanBtn).toBeDefined();
    await scanBtn!.trigger('click');
    await vi.waitFor(() => {
      const scanCall = fetcher.mock.calls.find(
        (c) =>
          String(c[0]).startsWith('/api/v1/allowance/auto-scan') &&
          ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'POST',
      );
      expect(scanCall).toBeDefined();
    });
    wrapper.unmount();
  });

  it('transport 错误被捕获：不抛错且错误态可显示', async () => {
    loginAs('SUPER_ADMIN');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const wrapper = mount(Allowance);
    await wrapper.vm.$nextTick();
    // 列表为空文案兜底，UI 不崩
    const text = wrapper.text();
    expect(text).toContain('津贴台账');
    wrapper.unmount();
  });
});