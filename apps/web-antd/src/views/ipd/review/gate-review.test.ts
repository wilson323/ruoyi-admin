// Gate 评审面板组件级验证：mock 真实 /api/v1/gates/{gateId} 契约（review/sign/reopen），
// 断言盲签视图渲染（对方仅 otherSubmitted/hint，不泄露结论）、签署请求体、
// REJECTED 后重开（round+1 + 第 3 轮组长列席）与错误文案。
// R212 ORPHAN-A1（2026-09-24）：补 POST /submit 提交评审接线（强制输出物 ossId 必填）。

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

  // R212 ORPHAN-A1：POST /gates/{gateId}/submit 接线（此前按钮无 @click，仅前端预检查）
  describe('R212 ORPHAN-A1 · submit gate review with mandatory ossIds', () => {
    function stubSubmitApi(elements: Array<{ elementCode: string; elementId: string; elementName: string; isVeto: boolean; sortOrder: number }>) {
      const calls: { body: unknown; method: string; url: string }[] = [];
      const state = { ...viewFixture() };
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        calls.push({ method, url, body });
        if (method === 'GET' && url === '/api/v1/gates/5/review') return response({ ...state });
        if (method === 'GET' && url === '/api/v1/gates/5/elements') return response(elements);
        if (method === 'POST' && url === '/api/v1/gates/5/element-results') {
          return response({ id: `er-${body.elementId}`, gateId: '5', elementId: String(body.elementId), result: body.result });
        }
        if (method === 'POST' && url === '/api/v1/gates/5/submit') {
          return response({ id: '5', projectId: '101', gateCode: 'GATE-CONCEPT', status: 'PENDING', startedAt: '2026-09-24T10:00:00', snapshotFrozen: true });
        }
        return response(null, 404, 40400);
      });
      vi.stubGlobal('fetch', fetcher);
      return { calls };
    }

    const threeElements = [
      { elementCode: 'G1-01', elementId: 'e-1', elementName: '市场机会验证', isVeto: false, sortOrder: 1 },
      { elementCode: 'G1-02', elementId: 'e-2', elementName: '商业模式可行性', isVeto: true, sortOrder: 2 },
      { elementCode: 'G1-03', elementId: 'e-3', elementName: '技术可行性', isVeto: true, sortOrder: 3 },
    ];

    /** 全部要素选 PASS（无需补必填），逐项提交后可整体 submit。 */
    async function judgeAllPass(wrapper: ReturnType<typeof mount>): Promise<void> {
      for (const row of wrapper.findAll('.element-row')) {
        const passRadio = row.findAll<HTMLInputElement>('input[type="radio"]')
          .find((r) => (r.element as HTMLInputElement).value === 'PASS')!;
        await passRadio.setValue('PASS');
        await passRadio.trigger('change');
        await row.findAll('button').find((b) => b.text().includes('提交此项判定'))!.trigger('click');
        await vi.waitFor(() => {
          expect(row.text()).toContain('已提交：通过');
        });
      }
    }

    it('submits review via POST /gates/5/submit with string ossIds passthrough（19 位无损）after all elements judged', async () => {
      const { calls } = stubSubmitApi(threeElements);
      const wrapper = await mountGate();
      await judgeAllPass(wrapper);

      const materials = wrapper.get('[data-testid="gate-submit-materials-oss"]');
      const minutes = wrapper.get('[data-testid="gate-submit-minutes-oss"]');
      // OSS ID 未填时按钮禁用（强制输出物缺失）
      const submitBtn = wrapper.get('[data-testid="gate-elements-submit"]');
      expect(submitBtn.attributes('disabled')).toBeDefined();
      await materials.setValue('2096266884247736321');
      await minutes.setValue('2096266884247736322');
      await wrapper.vm.$nextTick();
      expect(submitBtn.attributes('disabled')).toBeUndefined();

      await submitBtn.trigger('click');
      await vi.waitFor(() => {
        const submit = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/gates/5/submit');
        expect(submit).toBeTruthy();
        expect(submit?.body).toEqual({ materialsOssId: '2096266884247736321', meetingMinutesOssId: '2096266884247736322' });
      });
      wrapper.unmount();
    });

    it('keeps submit disabled when ossIds are non-numeric (SSRF guard: ossId only)', async () => {
      stubSubmitApi(threeElements);
      const wrapper = await mountGate();
      await judgeAllPass(wrapper);
      await wrapper.get('[data-testid="gate-submit-materials-oss"]').setValue('http://evil.example/x');
      await wrapper.get('[data-testid="gate-submit-minutes-oss"]').setValue('10010');
      await wrapper.vm.$nextTick();
      expect(wrapper.get('[data-testid="gate-elements-submit"]').attributes('disabled')).toBeDefined();
      wrapper.unmount();
    });
  });
});
