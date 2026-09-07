// V4 [HIGH] Gate 评审单详情页：33 要素全渲染 + 14 否决项硬阻断
//
// 覆盖：
// 1. 评审要素卡片 33 项逐项渲染（G1=7 / G2=6 / G3=5 / G4=8 / G5=7）
// 2. 14 项 isVeto=true 的要素带 data-veto="true" + 否决项徽标
// 3. API 失败 / 返回空时回退到 FALLBACK_GATE_ELEMENTS + 顶部 stale 提示
//    + 提交按钮 disabled（防 stale 数据误提交）
// 4. FAIL + isVeto ⇒ 提交评审结论按钮 disabled（AC-GATE-08 硬阻断）

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GateReviewView } from '../../../api/ipd/gate-review';
import {
  FALLBACK_GATE_ELEMENTS,
  type IpdGateElementView,
} from '../../../api/ipd/gate-element-result';
import GatePanel from './gate-panel.vue';

const envelope = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      code: 0,
      data,
      message: 'success',
      timestamp: '2026-09-06T00:00:00Z',
      traceId: 'fixture',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const viewFixture = (over: Partial<GateReviewView> = {}): GateReviewView => ({
  dualSign: true,
  extensionCount: 0,
  gateCode: 'GATE-CONCEPT',
  gateId: '5',
  leadSide: 'MARKET_PM',
  my: null,
  other: null,
  otherSubmitted: false,
  round: 1,
  signDueAt: '2026-09-10 18:00',
  status: 'PENDING',
  ...over,
});

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface ApiState {
  elements?: IpdGateElementView[];
  review?: GateReviewView;
  /** /elements 端点行为：'ok' 正常返回；'empty' 返回 []；'fail' 抛 500。 */
  elementsBehavior?: 'empty' | 'fail' | 'ok';
}

/** 模拟后端双签评审 + 要素列表端点（行为可注入）。 */
function stubApi(state: ApiState = {}) {
  const calls: { body: unknown; method: string; url: string }[] = [];
  const review = state.review ?? viewFixture();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (method === 'GET' && url === '/api/v1/gates/5/review') {
      return envelope(review);
    }
    if (method === 'GET' && url === '/api/v1/gates/5/elements') {
      if (state.elementsBehavior === 'fail') {
        return envelope(null, 500);
      }
      if (state.elementsBehavior === 'empty') {
        return envelope([]);
      }
      return envelope(state.elements ?? FALLBACK_GATE_ELEMENTS);
    }
    return envelope(null, 404, );
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls };
}

async function mountAndLoad(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(GatePanel);
  await wrapper.get('.gate-locate input').setValue('5');
  await wrapper.get('.gate-locate .primary-button').trigger('click');
  await vi.waitFor(() => expect(wrapper.text()).toContain('GATE-CONCEPT'));
  // 等到要素列表渲染完成（避免 onMounted 异步中读到 0 项）
  await vi.waitFor(() => expect(wrapper.findAll('.element-row').length).toBeGreaterThan(0));
  return wrapper;
}

describe('IPD gate panel — V4 33 elements complete render', () => {
  it('renders exactly 33 elements grouped by gate code (G1=7, G2=6, G3=5, G4=8, G5=7)', async () => {
    stubApi({ elements: FALLBACK_GATE_ELEMENTS });
    const wrapper = await mountAndLoad();
    const rows = wrapper.findAll('.element-row');
    expect(rows).toHaveLength(33);

    // 验证每个 gate code 的渲染数量
    const codes = rows.map((row) => row.attributes('data-testid') ?? '');
    const counts: Record<string, number> = {};
    for (const id of codes) {
      const code = id.match(/gate-element-(G\d)-/)?.[1] ?? '';
      if (code) counts[code] = (counts[code] ?? 0) + 1;
    }
    expect(counts.G1).toBe(7);
    expect(counts.G2).toBe(6);
    expect(counts.G3).toBe(5);
    expect(counts.G4).toBe(8);
    expect(counts.G5).toBe(7);
    wrapper.unmount();
  });

  it('marks 14 veto items with data-veto="true" and 否决项 tag', async () => {
    stubApi({ elements: FALLBACK_GATE_ELEMENTS });
    const wrapper = await mountAndLoad();
    const vetoRows = wrapper.findAll('[data-veto="true"]');
    expect(vetoRows).toHaveLength(14);

    // 否决项徽标在标题旁出现 14 次
    expect(wrapper.findAll('.element-veto-tag')).toHaveLength(14);
    // 非否决项使用「必审」徽标
    expect(wrapper.findAll('.element-must-tag')).toHaveLength(19);
    wrapper.unmount();
  });

  it('falls back to 33 elements + stale banner when API returns empty list', async () => {
    stubApi({ elementsBehavior: 'empty' });
    const wrapper = await mountAndLoad();
    expect(wrapper.findAll('.element-row')).toHaveLength(33);
    expect(wrapper.find('[data-testid="gate-elements-stale"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('前端 33 项种子要素兜底');
    // 兜底状态下每行都标 stale
    const staleRows = wrapper.findAll('[data-stale="true"]');
    expect(staleRows.length).toBeGreaterThanOrEqual(33);
    wrapper.unmount();
  });

  it('falls back to 33 elements when API fails (500)', async () => {
    stubApi({ elementsBehavior: 'fail' });
    const wrapper = await mountAndLoad();
    expect(wrapper.findAll('.element-row')).toHaveLength(33);
    expect(wrapper.find('[data-testid="gate-elements-stale"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('disables the bulk submit button when in fallback mode (no backend contract)', async () => {
    stubApi({ elementsBehavior: 'fail' });
    const wrapper = await mountAndLoad();
    const submitBtn = wrapper.get('[data-testid="gate-elements-submit"]');
    expect(submitBtn.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('blocks submit button when any veto element is set to FAIL (AC-GATE-08 hardblock)', async () => {
    stubApi({ elements: FALLBACK_GATE_ELEMENTS });
    const wrapper = await mountAndLoad();
    // 选中第一个否决项并标记 FAIL
    const firstVeto = wrapper.find('[data-veto="true"]');
    const vetoId = firstVeto.attributes('data-testid');
    expect(vetoId).toBeTruthy();
    // 通过 input radio 触发（name 以 element id 结尾，这里直接选择 row 内的 radio）
    const radios = firstVeto.findAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.length).toBeGreaterThan(0);
    // 找到值为 FAIL 的 radio
    const failRadio = radios.find((r) => (r.element as HTMLInputElement).value === 'FAIL');
    expect(failRadio).toBeTruthy();
    await failRadio!.setValue('FAIL');
    await failRadio!.trigger('change');
    await wrapper.vm.$nextTick();

    const submitBtn = wrapper.get('[data-testid="gate-elements-submit"]');
    expect(submitBtn.attributes('disabled')).toBeDefined();
    // 顶部红色「否决项 FAIL」徽标应当出现
    expect(wrapper.find('.elements-veto').exists()).toBe(true);
    expect(wrapper.find('.elements-veto').text()).toContain('否决项 FAIL');
    wrapper.unmount();
  });

  it('renders PASS / PASS_WITH_CONDITION rows with three radio options', async () => {
    stubApi({ elements: FALLBACK_GATE_ELEMENTS });
    const wrapper = await mountAndLoad();
    const firstRow = wrapper.get('.element-row');
    const radios = firstRow.findAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
    const values = radios.map((r) => (r.element as HTMLInputElement).value);
    expect(values).toEqual(expect.arrayContaining(['PASS', 'FAIL', 'PASS_WITH_CONDITION']));
    wrapper.unmount();
  });

  it('shows 提交评审结论 button label with element count (33 项)', async () => {
    stubApi({ elements: FALLBACK_GATE_ELEMENTS });
    const wrapper = await mountAndLoad();
    const submitBtn = wrapper.get('[data-testid="gate-elements-submit"]');
    expect(submitBtn.text()).toContain('33 项');
    wrapper.unmount();
  });
});
