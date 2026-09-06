// Gate 评审面板组件级验证：mock 真实 /api/v1/gates/{gateId} 契约（review/sign/reopen），
// 断言盲签视图渲染（对方仅 otherSubmitted/hint，不泄露结论）、签署请求体、
// REJECTED 后重开（round+1 + 第 3 轮组长列席）与错误文案。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GateReviewView } from '../../../api/ipd/gate-review';
import GatePanel from './gate-panel.vue';

const response = (data: unknown, status = 200, code = 0, message?: string) => new Response(
  JSON.stringify({ code, message: message ?? (code ? '请求不合法' : 'success'), data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
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

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 服务端状态机 mock：签署落 my、重开 round+1 并注入第 3 轮列席人。 */
function stubApi(initial: GateReviewView) {
  setActivePinia(createPinia());
  const calls: { body: unknown; method: string; url: string }[] = [];
  const state = { ...initial };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (method === 'GET' && url === '/api/v1/gates/5/review') return response({ ...state });
    if (method === 'POST' && url === '/api/v1/gates/5/sign') {
      state.my = {
        decision: String(body.decision),
        opinion: body.opinion ?? null,
        reviewerType: 'MARKET_PM',
        signedAt: '2026-09-06T10:00:00Z',
      };
      return response({ ...state.my });
    }
    if (method === 'POST' && url === '/api/v1/gates/5/reopen') {
      state.status = 'PENDING';
      state.round += 1;
      state.my = null;
      state.other = null;
      state.otherSubmitted = false;
      state.observers = [{ id: '3', name: '组长甲' }, { id: '4', name: '组长乙' }];
      return response({ id: '5', round: state.round, signDueAt: state.signDueAt ?? '', status: state.status });
    }
    return response(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, state };
}

async function mountGate(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(GatePanel);
  await wrapper.get('.gate-locate input').setValue('5');
  await wrapper.get('.gate-locate .primary-button').trigger('click');
  await vi.waitFor(() => expect(wrapper.text()).toContain('GATE-CONCEPT'));
  return wrapper;
}

describe('IPD gate review panel (prototype KeyGatePanel adaptation)', () => {
  it('renders the blind dual-sign view without leaking the other decision', async () => {
    stubApi(viewFixture({ otherSubmitted: true, hint: '对方已提交，等待您签署' }));
    const wrapper = await mountGate();
    expect(wrapper.text()).toContain('五大关键联合 Gate');
    expect(wrapper.text()).toContain('GATE-CONCEPT');
    expect(wrapper.text()).toContain('第 1 轮 · 双PM盲签');
    expect(wrapper.text()).toContain('流转中');
    expect(wrapper.text()).toContain('签署期限：2026-09-10 18:00');
    // AC-GATE-03 盲签：对方行只显示「已提交」，不出现 APPROVE/REJECT 结论
    expect(wrapper.text()).toContain('对方已提交，等待您签署');
    expect(wrapper.text()).toContain('已提交');
    expect(wrapper.text()).not.toContain('通过\n');
    // 签署操作位就绪
    expect(wrapper.text()).toContain('签署通过本节点');
    expect(wrapper.text()).toContain('驳回');
    wrapper.unmount();
  });

  it('signs through the real endpoint with the opinion payload', async () => {
    const { calls } = stubApi(viewFixture({ otherSubmitted: true }));
    const wrapper = await mountGate();
    await wrapper.get('.gate-opinion-input').setValue('会议纪要与评审材料完整，同意');
    await wrapper.get('.gate-card footer .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('本轮已签署'));
    const sign = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/gates/5/sign');
    expect(sign?.body).toEqual({ decision: 'APPROVE', opinion: '会议纪要与评审材料完整，同意' });
    wrapper.unmount();
  });

  it('reopens a rejected gate and reveals round-3 leaders', async () => {
    const { calls } = stubApi(viewFixture({
      my: { decision: 'REJECT', opinion: '关键事实需要整改', reviewerType: 'MARKET_PM', signedAt: '2026-09-05T10:00:00Z' },
      other: { decision: 'APPROVE', opinion: '材料齐全', reviewerType: 'RD_PM', signedAt: '2026-09-05T11:00:00Z' },
      otherSubmitted: true,
      round: 2,
      status: 'REJECTED',
    }));
    const wrapper = await mountGate();
    expect(wrapper.text()).toContain('已驳回');
    // 终态揭示：双方结论与意见原样透出（AC-GATE-04）
    expect(wrapper.text()).toContain('关键事实需要整改');
    expect(wrapper.text()).toContain('材料齐全');
    await wrapper.findAll('button').find((button) => button.text().includes('整改后发起新版本'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('第 3 轮'));
    // AC-GATE-07：第 3 轮起双方组长列席
    expect(wrapper.text()).toContain('第 3 轮起组长列席：组长甲、组长乙');
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/gates/5/reopen')).toBe(true);
    wrapper.unmount();
  });

  it('surfaces the load error without loosening', async () => {
    stubApi(viewFixture());
    const wrapper = mount(GatePanel);
    await wrapper.get('.gate-locate input').setValue('404');
    await wrapper.get('.gate-locate .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('失败'));
    expect(wrapper.text()).not.toContain('GATE-CONCEPT');
    wrapper.unmount();
  });
});
