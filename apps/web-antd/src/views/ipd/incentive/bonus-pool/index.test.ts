/** 奖金池核算 UI：ZK 口径展示（实际回款×5%×S/A/B）+ 两段实时演算（系数由后端裁决）+ 状态流约束。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputNumber } from 'ant-design-vue';

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

describe('页34 奖金池核算', () => {
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

  it('初始空表单：触发核算按钮禁用，未触发 fetch', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    expect(computeBtn).toBeDefined();
    expect(computeBtn!.attributes('disabled')).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('填写项目 + 回款金额后，按钮启用；公式以 5%×S/A/B 实时演算', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mount(BonusPool);
    const inputs = wrapper.findAll('input');
    // 第一个 input 是「项目编号」
    await inputs[0]!.setValue('P-100');
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
      if (path.endsWith('/list')) return envelope([{
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1.2, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4800, status: 'DRAFT',
          calculatedAt: '2026-09-05 10:00:00',
        }]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('P-100');
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
      if (path.endsWith('/list')) {
        return envelope([{
          id: 'BP-1', projectId: 'P-100', targetSales: 100000, poolRate: 0.05,
          basePool: 5000, coefficient: 1, achievementRate: 100,
          tierCoefficient: 0.8, finalPool: 4000, status: 'CONFIRMED',
          calculatedAt: '2026-09-05 10:00:00',
        }]);
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
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('P-100');
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

  it('空 projectId 时不发起 list 请求（避免误跨项目）', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    await wrapper.vm.$nextTick();
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('transport 错误被 try/catch 捕获，不抛异常', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('network down'); });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(BonusPool);
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('P-100');
    await wrapper.vm.$nextTick();
    const computeBtn = wrapper.findAll('button').find((b) => b.text().includes('触发核算'));
    expect(computeBtn).toBeDefined();
    await computeBtn!.trigger('click');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    wrapper.unmount();
  });
});