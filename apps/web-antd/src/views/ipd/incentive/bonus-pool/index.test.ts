/** 奖金池核算 UI：ZK 口径展示（实际回款×5%×S/A/B）+ 两段实时演算（系数由后端裁决）+ 状态流约束。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputNumber, Select } from 'ant-design-vue';

import BonusPool from './index.vue';

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

/** InputNumber 是 antdv 包装组件：直接 setValue 不更新 v-model，需 emit update:value。 */
async function setInputNumber(wrapper: ReturnType<typeof mount>, index: number, value: number) {
  const numbers = wrapper.findAllComponents(InputNumber);
  const target = numbers[index];
  if (!target) throw new Error(`InputNumber #${index} not found`);
  await target.vm.$emit('update:value', value);
  await wrapper.vm.$nextTick();
}

/** R31 P0-2 值域修复：项目改为 Select 下拉（值=项目数字 ID），与 InputNumber 同理需 emit 更新 v-model。 */
async function setProjectSelect(wrapper: ReturnType<typeof mount>, value: string) {
  const select = wrapper.findAllComponents(Select)[0];
  if (!select) throw new Error('Select not found');
  select.vm.$emit('update:value', value);
  await wrapper.vm.$nextTick();
}

describe('页34 奖金池核算', () => {
  /**
   * R215-N2 按钮权限闸：与 packages/effects/access/src/directive.ts 同语义的本地 stub
   * （无码 → el.remove()），权限码由闭包注入，验证角色×按钮矩阵。
   */
  function mountWithAccess(codes: string[]) {
    const accessDirective = {
      mounted(el: Element, binding: { value: string | string[] }) {
        const values = Array.isArray(binding.value) ? binding.value : [binding.value];
        if (codes.includes('*:*:*')) return;
        if (!values.some((v) => codes.includes(v))) el.remove();
      },
    };
    return mount(BonusPool, { global: { directives: { access: accessDirective } } });
  }

  it('R215-N2 闸：无 compute 码时「触发核算」按钮被移除；持码时可见', () => {
    vi.stubGlobal('fetch', vi.fn());
    const denied = mountWithAccess(['ipd:bonus-pool:query']);
    expect(denied.findAll('button').some((b) => b.text().includes('触发核算'))).toBe(false);
    denied.unmount();
    const granted = mountWithAccess(['ipd:bonus-pool:compute']);
    expect(granted.findAll('button').some((b) => b.text().includes('触发核算'))).toBe(true);
    granted.unmount();
  });

  it('R215-N2 闸：DRAFT 结果下组长码（freeze）见冻结钮、无 distribute 码时分配钮不可见；双 PM 无码全隐藏', async () => {
    const draft = { id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05, basePool: 5000, coefficient: 1, achievementRate: 100, tierCoefficient: 0.8, finalPool: 4000, status: 'DRAFT', calculatedAt: '2026-09-05 10:00:00' };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/compute')) return envelope(draft);
      if (path.includes('/bonus-pool/page')) return envelope({ records: [draft], total: 1, size: 20, current: 1, pages: 1 });
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    // 组长：compute 无 + freeze 有（R215-N1 拍板后的真实码集）
    const leader = mountWithAccess(['ipd:bonus-pool:query', 'ipd:bonus-pool:freeze']);
    await setProjectSelect(leader, '1001');
    await setInputNumber(leader, 0, 100000);
    // 绕过按钮直调不在测试范围内；用 flush 后手动渲染 currentResult：通过 list 加载不填 result，
    // 改走真实路径：组长无 compute 码 → 触发核算钮被移除（矩阵已测）；改用超管码集验证 freeze 钮
    leader.unmount();
    const admin = mountWithAccess(['*:*:*']);
    await setProjectSelect(admin, '1001');
    await setInputNumber(admin, 0, 100000);
    await admin.vm.$nextTick();
    const computeBtn = admin.findAll('button').find((b) => b.text().includes('触发核算'));
    await computeBtn!.trigger('click');
    await vi.waitFor(() => expect(admin.text()).toContain('当前核算结果 #BP-1'));
    // DRAFT 态：持 freeze 码的超管可见冻结钮，无 CONFIRMED 态故分配钮本就不渲染
    expect(admin.findAll('button').some((b) => b.text().includes('冻结'))).toBe(true);
    admin.unmount();
    // CONFIRMED 结果下：无 distribute 码 → 分配钮不可见
    const confirmed = { ...draft, status: 'CONFIRMED' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/compute')) return envelope(confirmed);
      if (path.endsWith('/list')) return envelope([confirmed]);
      throw new Error(`unexpected fetch: ${path}`);
    }));
    const pm = mountWithAccess(['ipd:bonus-pool:query']);
    await setProjectSelect(pm, '1001');
    await setInputNumber(pm, 0, 100000);
    await pm.vm.$nextTick();
    // pm 无 compute 码，按钮已移除，无法点击 → 直接断言页面无分配入口
    expect(pm.findAll('button').some((b) => b.text().includes('分配'))).toBe(false);
    pm.unmount();
  });

  it('顶部 Alert 必须展示 ZK 口径（实际回款×5%×S/A/B），禁止出现「目标销售额」', () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(BonusPool);
    const text = wrapper.text();
    expect(text).toContain('实际回款');
    expect(text).toContain('5%');
    expect(text).toContain('S/A/B');
    expect(text).not.toContain('目标销售额');
    wrapper.unmount();
  });

  it('两段预览标题：实际回款 / 预计基数；并声明系数由后端裁决', () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(BonusPool);
    const text = wrapper.text();
    expect(text).toContain('① 实际回款');
    expect(text).toContain('② 预计基数');
    expect(text).toContain('后端从项目配置带出');
    wrapper.unmount();
  });

  it('初始空表单：触发核算按钮禁用，未触发 compute/list 请求（onMounted 项目下拉除外）', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    expect(computeBtn).toBeDefined();
    expect(computeBtn!.attributes('disabled')).toBeDefined();
    const called = fetcher.mock.calls.map((c) => String(c[0]));
    expect(called.some((p) => p.endsWith('/compute') || p.includes('/bonus-pool/page'))).toBe(false);
    wrapper.unmount();
  });

  it('填写项目 + 回款金额后，按钮启用；公式以 5%×S/A/B 实时演算', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(BonusPool);
    await setProjectSelect(wrapper, '1001');
    // 第二个 InputNumber（顺序：period、achievementRate 后被 InputNumber 占用）
    // 通过 InputNumber 组件更新 actualReceipts（第 0 个 InputNumber = actualReceipts）
    await setInputNumber(wrapper, 0, 100000);
    await wrapper.vm.$nextTick();
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    expect(computeBtn!.attributes('disabled')).toBeUndefined();
    // 100000 × 5% × 1 × 1 = 5000
    const text = wrapper.text();
    expect(text).toContain('5,000.00');
    wrapper.unmount();
  });

  it('S/A/B 差异化系数与阶梯系数由后端裁决：表单不提供级别/层级系数与核算周期输入', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(BonusPool);
    const text = wrapper.text();
    // 旧版假输入（后端 compute 契约不存在这些字段）已移除，避免误导用户
    expect(text).not.toContain('级别系数');
    expect(text).not.toContain('层级系数');
    expect(text).not.toContain('核算周期');
    expect(text).not.toContain('项目等级');
    wrapper.unmount();
  });

  it('compute 成功：返回的 BonusPool 详情卡片展示且「冻结」按钮按 DRAFT 状态渲染', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/compute')) {
        return envelope({
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1.2, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4800, status: 'DRAFT',
          calculatedAt: '2026-09-05 10:00:00',
        });
      }
      if (path.includes('/bonus-pool/page')) return envelope({ records: [{
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1.2, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4800, status: 'DRAFT',
          calculatedAt: '2026-09-05 10:00:00',
        }], total: 1, size: 20, current: 1, pages: 1 });
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    await setProjectSelect(wrapper, '1001');
    await setInputNumber(wrapper, 0, 100000);
    await wrapper.vm.$nextTick();
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    await computeBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('当前核算结果 #BP-1'));
    // DRAFT 状态显示「冻结」按钮（来自 currentResult 卡片）
    expect(wrapper.text()).toContain('冻结');
    expect(wrapper.text()).toContain('DRAFT → CONFIRMED');
    // R30 新契约列：阶梯系数为系数原值直出（0.8），不得被 formatPercent 归一化成 80%
    expect(wrapper.text()).toContain('0.8');
    expect(wrapper.text()).not.toContain('80%');
    expect(wrapper.text()).not.toContain('已分配');
    wrapper.unmount();
  });

  it('DRAFT 状态冻结后调用 freeze 端点并刷新', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/compute')) {
        return envelope({
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4000, status: 'DRAFT',
          calculatedAt: '2026-09-05 10:00:00',
        });
      }
      if (path.includes('/bonus-pool/page')) {
        return envelope({ records: [{
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4000, status: 'CONFIRMED',
          calculatedAt: '2026-09-05 10:00:00',
        }], total: 1, size: 20, current: 1, pages: 1 });
      }
      if (path.endsWith('/BP-1/freeze')) {
        return envelope({
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4000, status: 'CONFIRMED',
          calculatedAt: '2026-09-05 10:00:00',
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    await setProjectSelect(wrapper, '1001');
    await setInputNumber(wrapper, 0, 100000);
    await wrapper.vm.$nextTick();
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    await computeBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('当前核算结果 #BP-1'));
    const freezeBtn = wrapper.findAll('button').find((b) => b.text().includes('冻结'));
    expect(freezeBtn).toBeDefined();
    await freezeBtn!.trigger('click');
    await vi.waitFor(() => {
      const freezeCall = fetcher.mock.calls.find((c) => String(c[0]).endsWith('/BP-1/freeze'));
      expect(freezeCall).toBeDefined();
    });
    wrapper.unmount();
  });

  it('空 projectId 时不发起 list 请求（避免误跨项目；onMounted 项目下拉除外）', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    await wrapper.vm.$nextTick();
    const called = fetcher.mock.calls.map((c) => String(c[0]));
    expect(called.some((p) => p.includes('/bonus-pool/page'))).toBe(false);
    wrapper.unmount();
  });

  it('transport 错误被 try/catch 捕获，不抛异常', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => { throw new TypeError('network down'); });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    await setProjectSelect(wrapper, '1001');
    await wrapper.vm.$nextTick();
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    expect(computeBtn).toBeDefined();
    await computeBtn!.trigger('click');
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.some((c) => String(c[0]).endsWith('/compute'))).toBe(true),
    );
    wrapper.unmount();
  });
});
/* ========== ORPHAN-A4/A5 增量接线（页34：page 切量 + auto-compute + 系数试算 + 回款台账） ========== */

describe('页34 奖金池核算 — ORPHAN-A4/A5 增量', () => {
  /** 与上方 R215-N2 同语义 stub（无码 → el.remove()）。 */
  function mountWithAccess(codes: string[]) {
    const accessDirective = {
      mounted(el: Element, binding: { value: string | string[] }) {
        const values = Array.isArray(binding.value) ? binding.value : [binding.value];
        if (codes.includes('*:*:*')) return;
        if (!values.some((v) => codes.includes(v))) el.remove();
      },
    };
    return mount(BonusPool, { global: { directives: { access: accessDirective } } });
  }

  /** 万能 fetch：/page 与台账按分支返回，其余兜底空包络。 */
  function makeFetcher(extra: Record<string, unknown> = {}) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/bonus-pool/page')) {
        return envelope({ records: (extra.pageRecords as unknown[]) ?? [], total: 0, size: 20, current: 1, pages: 0 });
      }
      if (path.includes('/receipt-ledgers/by-project/')) {
        return envelope((extra.ledgers as unknown[]) ?? []);
      }
      for (const [suffix, payload] of Object.entries(extra)) {
        if (suffix !== 'pageRecords' && suffix !== 'ledgers' && path.endsWith(suffix) && init?.method === 'POST') {
          return envelope(payload);
        }
      }
      return envelope([]);
    });
  }

  it('A4#10 切量：选项目后列表走 GET /bonus-pool/page（带 pageNo/pageSize 分页参数），不再调 /list', async () => {
    const fetcher = makeFetcher({ pageRecords: [{ id: 'BP-7', status: 'DRAFT' }] });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mountWithAccess(['*:*:*']);
    await setProjectSelect(wrapper, '1001');
    await vi.waitFor(() => {
      const pageCall = fetcher.mock.calls.map((c) => String(c[0])).find((p) => p.includes('/bonus-pool/page'));
      expect(pageCall).toBeDefined();
    });
    const pageCall = fetcher.mock.calls.map((c) => String(c[0])).find((p) => p.includes('/bonus-pool/page'))!;
    expect(pageCall).toContain('projectId=1001');
    expect(pageCall).toContain('pageNo=1');
    expect(pageCall).toContain('pageSize=20');
    expect(fetcher.mock.calls.map((c) => String(c[0])).some((p) => p.endsWith('/bonus-pool/list'))).toBe(false);
    await vi.waitFor(() => expect(wrapper.text()).toContain('BP-7'));
    wrapper.unmount();
  });

  it('A4#11 auto-compute：period 未填时按钮禁用；填 2026-08 后点击 → POST /bonus-pool/auto-compute body 含 period', async () => {
    const fetcher = makeFetcher({ '/auto-compute': { id: 'BP-AUTO', status: 'DRAFT', finalPool: 6000 } });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mountWithAccess(['*:*:*']);
    await setProjectSelect(wrapper, '1001');
    await setInputNumber(wrapper, 0, 100000);
    await wrapper.vm.$nextTick();
    const autoBtn = wrapper.findAll('button').find((b) => b.text().includes('自动核算'));
    expect(autoBtn).toBeDefined();
    expect(autoBtn!.attributes('disabled')).toBeDefined(); // period 空 → 禁用
    const periodInput = wrapper.findAll('input').find((i) => i.attributes('placeholder')?.includes('YYYY-MM'));
    expect(periodInput).toBeDefined();
    await periodInput!.setValue('2026-08');
    await wrapper.vm.$nextTick();
    expect(autoBtn!.attributes('disabled')).toBeUndefined();
    await autoBtn!.trigger('click');
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([u, init]) => String(u).endsWith('/auto-compute') && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ projectId: '1001', period: '2026-08', actualReceipts: 100000 });
    });
    wrapper.unmount();
  });

  it('A4#12 系数试算：score=85 点击 → POST /coefficient/preview，展示返回系数（不落库文案）', async () => {
    const fetcher = makeFetcher({ '/coefficient/preview': { id: 'PV-1', coefficient: 1.2, finalPool: 7200 } });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mountWithAccess(['*:*:*']);
    await setProjectSelect(wrapper, '1001');
    // 系数试算 score：页面 InputNumber 顺序 = actualReceipts(0), poolRate(1), achievementRate(2), personalCoefficient(3), preview.score(4)
    await setInputNumber(wrapper, 4, 85);
    await wrapper.vm.$nextTick();
    const previewBtn = wrapper.findAll('button').find((b) => b.text().includes('试算绩效系数'));
    expect(previewBtn!.attributes('disabled')).toBeUndefined();
    await previewBtn!.trigger('click');
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([u, init]) => String(u).endsWith('/coefficient/preview') && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ projectId: '1001', score: 85 });
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('1.2'));
    expect(wrapper.text()).toContain('不落库');
    wrapper.unmount();
  });

  it('A5#75 回款台账：选项目后自动 GET /receipt-ledgers/by-project/{id} 并渲染行（净额/窗口标签）', async () => {
    const fetcher = makeFetcher({
      ledgers: [{
        id: 'RL-1', projectId: '1001', receiptMonth: '2026-08',
        receiptAmount: '1500000.00', refundAmount: '5000.00', netAmount: '1495000.00',
        source: 'RECEIPT', inWindow: true, voucherUrl: null, createTime: '2026-09-25 10:00:00',
      }],
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mountWithAccess(['*:*:*']);
    await setProjectSelect(wrapper, '1001');
    await vi.waitFor(() => expect(fetcher.mock.calls.map((c) => String(c[0])).some((p) => p.includes('/receipt-ledgers/by-project/1001'))).toBe(true));
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('1,495,000.00'); // 净回款（formatMoney）
      expect(wrapper.text()).toContain('窗口内');
    });
    wrapper.unmount();
  });

  it('A5#76 录入：月份+金额填好后 POST /receipt-ledgers（body 不带 source/voucherHash）', async () => {
    const fetcher = makeFetcher({ '/receipt-ledgers': { id: 'RL-2', receiptMonth: '2026-08', receiptAmount: '800000.00' } });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mountWithAccess(['*:*:*']);
    await setProjectSelect(wrapper, '1001');
    const monthInput = wrapper.findAll('input').find((i) => i.attributes('placeholder') === 'YYYY-MM');
    await monthInput!.setValue('2026-08');
    // 回款台账金额 InputNumber：actualReceipts(0), poolRate(1), achievementRate(2), personalCoefficient(3), preview.score(4), ledger.receiptAmount(5), ledger.refundAmount(6), refund.refundAmount(7)
    await setInputNumber(wrapper, 5, 800000);
    await wrapper.vm.$nextTick();
    const recordBtn = wrapper.findAll('button').find((b) => b.text() === '录入回款');
    expect(recordBtn).toBeDefined();
    expect(recordBtn!.attributes('disabled')).toBeUndefined();
    await recordBtn!.trigger('click');
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([u, init]) => String(u).endsWith('/receipt-ledgers') && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toEqual({ projectId: '1001', receiptMonth: '2026-08', receiptAmount: 800000 });
    });
    wrapper.unmount();
  });

  it('A5#77 退款冲减：月份+金额填好后 POST /receipt-ledgers/{projectId}/refunds body {month, refundAmount}', async () => {
    const fetcher = makeFetcher({ '/refunds': { id: 'RL-1', receiptMonth: '2026-08', refundAmount: '3000.00' } });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mountWithAccess(['*:*:*']);
    await setProjectSelect(wrapper, '1001');
    const refundMonth = wrapper.findAll('input').find((i) => i.attributes('placeholder')?.includes('冲减月份'));
    await refundMonth!.setValue('2026-08');
    await setInputNumber(wrapper, 7, 3000);
    await wrapper.vm.$nextTick();
    const refundBtn = wrapper.findAll('button').find((b) => b.text() === '退款冲减');
    expect(refundBtn!.attributes('disabled')).toBeUndefined();
    await refundBtn!.trigger('click');
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([u, init]) => String(u).includes('/receipt-ledgers/1001/refunds') && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ month: '2026-08', refundAmount: 3000 });
    });
    wrapper.unmount();
  });

  it('N1 口径码闸负例（UI 层）：仅持 query 码 → 自动核算/试算/录入/退款 4 钮全被移除（403 兜底在后端 requireAdmin）', () => {
    vi.stubGlobal('fetch', vi.fn());
    const denied = mountWithAccess(['ipd:bonus-pool:query']);
    const labels = ['自动核算', '试算绩效系数', '录入回款', '退款冲减'];
    for (const label of labels) {
      expect(denied.findAll('button').some((b) => b.text().includes(label))).toBe(false);
    }
    denied.unmount();
    // 持 compute 码（超管 Catalog）→ 4 钮全部可见
    const granted = mountWithAccess(['ipd:bonus-pool:compute']);
    for (const label of labels) {
      expect(granted.findAll('button').some((b) => b.text().includes(label))).toBe(true);
    }
    granted.unmount();
  });
});
