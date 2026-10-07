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
  // R215-E2E-B：默认非零 code 的 message 置空（后端无 message → 查表链意图保留）；显式传 message 的用例走透传断言。
  JSON.stringify({ code, message: message ?? (code ? '' : 'success'), data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
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

    /** 全部要素选 PASS，逐项提交后可整体 submit。
     *
     *  F5（2026-10-07）起 G1-1（首行 e-1「市场机会验证」，编码 G1-01）判 PASS 必须补
     *  一手验证家数或书面意向份数——后端 verifyCustomerEvidence 一直这么校验，前端
     *  此前没有录入位所以测试也无需补。现在录入位接上了，该行必须填。
     */
    async function judgeAllPass(wrapper: ReturnType<typeof mount>): Promise<void> {
      for (const row of wrapper.findAll('.element-row')) {
        const passRadio = row.findAll<HTMLInputElement>('input[type="radio"]')
          .find((r) => (r.element as HTMLInputElement).value === 'PASS')!;
        await passRadio.setValue('PASS');
        await passRadio.trigger('change');
        const g1Verification = row.find('input[name="verifications"]');
        if (g1Verification.exists()) {
          await g1Verification.setValue('5');
        }
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

// AI-P2-1：材料 AI 预审接线（POST /gates/{gateId}/precheck；无请求体、只读参考）
describe('AI-P2-1 · gate material precheck', () => {
  const precheckFixture = {
    aiChecklist: { aiModel: 'intent_match', degraded: false, markdown: '- 逐项核对交付物归档' },
    blocking: false,
    decisionWritten: false,
    gateCode: 'GATE-CONCEPT',
    gateId: '5',
    items: [
      { conditionNote: null, evidenceRef: 'oss://evi/1', elementId: 'e-1', leftoverStatus: null, result: 'PASS', status: 'COVERED' },
      { conditionNote: '需补充纪要', evidenceRef: null, elementId: 'e-2', leftoverStatus: '待关闭', result: 'CONDITIONAL', status: 'PARTIAL' },
    ],
    latencyMs: 15,
    materials: {
      gateId: '5', isReady: true,
      items: [{ actionCode: 'ACT-1', actionId: 'a-1', actionName: '市场需求评审', isReady: true, required: 1, uploaded: 1 }],
      missing: 0, projectId: '101', total: 1, uploaded: 1,
    },
    projectId: '101',
    summary: { covered: 1, missing: 0, partial: 1, total: 2 },
  };

  function stubPrecheckApi(precheck: unknown, status = 200, code = 0) {
    const calls: { body: unknown; method: string; url: string }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ body: init?.body, method, url });
      if (method === 'GET' && url === '/api/v1/gates/5/review') return response(viewFixture());
      if (method === 'GET' && url === '/api/v1/gates/5/elements') return response([]);
      if (method === 'POST' && url === '/api/v1/gates/5/precheck') return response(precheck, status, code);
      return response(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    return { calls };
  }

  async function mountPrecheckGate() {
    const wrapper = mount(GatePanel);
    await wrapper.get('.gate-locate input').setValue('5');
    await wrapper.get('.gate-locate .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('GATE-CONCEPT'));
    return wrapper;
  }

  it('点击「AI 预审」发无请求体 POST，渲染覆盖统计 + 证据定位 + 只读旗标', async () => {
    const { calls } = stubPrecheckApi(precheckFixture);
    const wrapper = await mountPrecheckGate();
    await wrapper.get('[data-testid="gate-precheck-run"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('AI 预审结果（GATE-CONCEPT）'));
    const precheck = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/gates/5/precheck');
    expect(precheck).toBeTruthy();
    // 卡面硬约束：无请求体（后端不收 body、无状态变更）
    expect(precheck?.body).toBeUndefined();
    expect(wrapper.text()).toContain('覆盖统计：共 2 项 — 已覆盖 1 / 部分 1 / 缺失 0');
    expect(wrapper.text()).toContain('只读参考 · 不写决策 · 不阻塞评审');
    expect(wrapper.text()).toContain('证据：oss://evi/1');
    expect(wrapper.text()).toContain('条件：需补充纪要');
    expect(wrapper.text()).toContain('- 逐项核对交付物归档');
    wrapper.unmount();
  });

  it('AI 降级：degraded=true 显示降级提示而非 markdown 面板', async () => {
    stubPrecheckApi({
      ...precheckFixture,
      aiChecklist: { aiModel: null, degraded: true, markdown: 'AI 预审清单暂不可用（INTERNAL_ERROR）' },
    });
    const wrapper = await mountPrecheckGate();
    await wrapper.get('[data-testid="gate-precheck-run"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="gate-precheck-degraded"]').exists()).toBe(true));
    expect(wrapper.text()).toContain('AI 预审清单暂不可用');
    expect(wrapper.find('[data-testid="gate-precheck-ai"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('预审失败（材料为空 400）：错误文案透出且不渲染结果面板', async () => {
    stubPrecheckApi(null, 400, 10001);
    const wrapper = await mountPrecheckGate();
    await wrapper.get('[data-testid="gate-precheck-run"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="gate-precheck-error"]').exists()).toBe(true));
    expect(wrapper.find('[data-testid="gate-precheck-panel"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
