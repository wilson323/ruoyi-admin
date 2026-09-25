/**
 * Gate 评审详情页契约（R177-A6）：
 * 1. PENDING 状态：signApprove / signReject / extend / arbitrate* / finalRuling* / refresh 可见（8 个），reopen 隐藏；
 * 2. REJECTED 状态：reopen / refresh 可见（2 个），其它隐藏；
 * 3. APPROVED / ABSTAINED_TIMEOUT：仅 refresh 可见（1 个）。
 * 4. listProjectGates 与 getGateReview 后端契约一致（不要造种子数据）。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ComponentPublicInstance } from 'vue';

import type { IpdIdentity } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import Index from './index.vue';

/** 构造登录身份（R212 ORPHAN-A1 列席接线：personType 决定名单/邀约可见性）。 */
function loginAs(personType: IpdIdentity['person']['personType'], personId = '7'): void {
  useIpdAuthStore().identity = {
    mustChangePwd: false,
    person: { accountStatus: 'ACTIVE', groupId: null, id: personId, name: '测试用户', personType, username: 'tester' },
    scope: 'FULL',
  };
}

const envelope = (data: unknown, status = 200, code = 0): Response => new Response(
  // R215-E2E-B：非零 code 的 message 置空（后端无 message → 查表链意图保留）。
  JSON.stringify({ code, message: code === 0 ? 'success' : '', data, timestamp: '2026-09-22T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

/**
 * 提取 wrapper 中所有非 disabled 的 antd Button 文本。
 * button-policy 隐藏的按钮以 disabled 渲染，不计入"可见"集合。
 */
interface ButtonElement {
  attributes: (name: string) => string | undefined;
  text: () => string;
}

function visibleButtonLabels(wrapper: ReturnType<typeof mount>): string[] {
  const all = wrapper.findAll('.ant-btn') as unknown as ButtonElement[];
  return all
    .filter((b) => b.attributes('disabled') === undefined)
    .map((b) => b.text().replace(/\s+/g, ''))
    .filter((t) => t.length > 0);
}

function makeRouter(): ReturnType<typeof createRouter> {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/ipd/admin/gate-detail', component: Index },
    ],
  });
}

async function mountWith(query: Record<string, string>): Promise<ReturnType<typeof mount>> {
  const router = makeRouter();
  router.push({ path: '/ipd/admin/gate-detail', query });
  await router.isReady();
  const wrapper = mount(Index, {
    global: { plugins: [router] },
  });
  return wrapper;
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('R177-A6 Gate 评审详情页 button-policy 接入契约', () => {
  it('PENDING 状态：8 个按钮可见（sign/extend/arbitrate/finalRuling/refresh），reopen 隐藏', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') {
        return envelope([
          { id: '9001', projectId: '101', gateCode: 'G3', status: 'PENDING', currentRound: 1, signDueAt: 1893456000000, concludedAt: null },
        ]);
      }
      if (path === '/api/v1/gates/9001/review') {
        return envelope({
          gateId: '9001',
          gateCode: 'G3',
          status: 'PENDING',
          dualSign: true,
          leadSide: 'MARKET_PM',
          round: 1,
          signDueAt: 1893456000000,
          extensionCount: 0,
          my: null,
          other: null,
          otherSubmitted: false,
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('G3'));
    const labels = visibleButtonLabels(wrapper);
    expect(labels).toContain('签署通过');
    expect(labels).toContain('签署驳回');
    expect(labels).toContain('延期');
    expect(labels).toContain('仲裁同意');
    expect(labels).toContain('仲裁驳回');
    expect(labels).toContain('终裁通过');
    expect(labels).toContain('终裁驳回');
    expect(labels).toContain('刷新');
    expect(labels).not.toContain('重新发起');
    wrapper.unmount();
  });

  it('REJECTED 状态：仅重新发起 + 刷新可见', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') {
        return envelope([
          { id: '9002', projectId: '101', gateCode: 'G2', status: 'REJECTED', currentRound: 1, signDueAt: 1893456000000, concludedAt: 1893456000000 },
        ]);
      }
      if (path === '/api/v1/gates/9002/review') {
        return envelope({
          gateId: '9002',
          gateCode: 'G2',
          status: 'REJECTED',
          dualSign: true,
          leadSide: 'RD_PM',
          round: 1,
          signDueAt: 1893456000000,
          extensionCount: 0,
          my: { decision: 'REJECT', opinion: '材料不足', signedAt: 1893456000000, reviewerType: 'MARKET_PM' },
          other: { decision: 'REJECT', opinion: '需补数据', signedAt: 1893456000000, reviewerType: 'RD_PM' },
          otherSubmitted: true,
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9002' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('已驳回'));
    const labels = visibleButtonLabels(wrapper);
    expect(labels).toContain('重新发起');
    expect(labels).toContain('刷新');
    expect(labels).not.toContain('签署通过');
    expect(labels).not.toContain('签署驳回');
    expect(labels).not.toContain('延期');
    expect(labels).not.toContain('仲裁同意');
    expect(labels).not.toContain('仲裁驳回');
    expect(labels).not.toContain('终裁通过');
    expect(labels).not.toContain('终裁驳回');
    wrapper.unmount();
  });

  it('APPROVED 状态：仅刷新可见（其它按钮全部隐藏）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') {
        return envelope([
          { id: '9003', projectId: '101', gateCode: 'G1', status: 'APPROVED', currentRound: 1, signDueAt: 1893456000000, concludedAt: 1893456000000 },
        ]);
      }
      if (path === '/api/v1/gates/9003/review') {
        return envelope({
          gateId: '9003',
          gateCode: 'G1',
          status: 'APPROVED',
          dualSign: true,
          leadSide: 'MARKET_PM',
          round: 1,
          signDueAt: 1893456000000,
          extensionCount: 0,
          my: { decision: 'APPROVE', opinion: '通过', signedAt: 1893456000000, reviewerType: 'MARKET_PM' },
          other: { decision: 'APPROVE', opinion: '通过', signedAt: 1893456000000, reviewerType: 'RD_PM' },
          otherSubmitted: true,
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9003' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('已通过'));
    const labels = visibleButtonLabels(wrapper);
    expect(labels).toContain('刷新');
    expect(labels).not.toContain('签署通过');
    expect(labels).not.toContain('签署驳回');
    expect(labels).not.toContain('重新发起');
    expect(labels).not.toContain('延期');
    expect(labels).not.toContain('仲裁同意');
    expect(labels).not.toContain('仲裁驳回');
    expect(labels).not.toContain('终裁通过');
    expect(labels).not.toContain('终裁驳回');
    wrapper.unmount();
  });

  it('ABSTAINED_TIMEOUT 状态：仅刷新可见（其它按钮全部隐藏）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') {
        return envelope([
          { id: '9004', projectId: '101', gateCode: 'G4', status: 'ABSTAINED_TIMEOUT', currentRound: 1, signDueAt: 1893456000000, concludedAt: 1893456000000 },
        ]);
      }
      if (path === '/api/v1/gates/9004/review') {
        return envelope({
          gateId: '9004',
          gateCode: 'G4',
          status: 'ABSTAINED_TIMEOUT',
          dualSign: true,
          leadSide: 'MARKET_PM',
          round: 1,
          signDueAt: 1893456000000,
          extensionCount: 3,
          my: null,
          other: null,
          otherSubmitted: false,
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9004' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('超时弃权'));
    const labels = visibleButtonLabels(wrapper);
    expect(labels).toContain('刷新');
    expect(labels).not.toContain('签署通过');
    expect(labels).not.toContain('签署驳回');
    expect(labels).not.toContain('重新发起');
    expect(labels).not.toContain('延期');
    expect(labels).not.toContain('仲裁同意');
    expect(labels).not.toContain('仲裁驳回');
    expect(labels).not.toContain('终裁通过');
    expect(labels).not.toContain('终裁驳回');
    wrapper.unmount();
  });

  it('无 projectId 时显示空态引导（不发起 listProjectGates 请求）', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({});
    await vi.waitFor(() => expect(wrapper.text()).toContain('缺少 projectId'));
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('项目维度 Gate 列表加载失败展示统一错误文案', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') {
        return envelope(null, 400, 10001);
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('输入信息不符合要求'));
    wrapper.unmount();
  });

  it('评审视图加载失败展示数据不存在统一文案', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') {
        return envelope([
          { id: '9001', projectId: '101', gateCode: 'G3', status: 'PENDING', currentRound: 1, signDueAt: 1893456000000, concludedAt: null },
        ]);
      }
      if (path === '/api/v1/gates/9001/review') {
        return envelope(null, 404, 50001);
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('数据不存在或已被删除'));
    wrapper.unmount();
  });

  it('页面渲染至少 3 张 antd Card（评审详情/动作/列表）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/projects/101/gates') return envelope([]);
      if (path === '/api/v1/gates/9001/review') {
        return envelope({
          gateId: '9001', gateCode: 'G3', status: 'PENDING', dualSign: true, leadSide: 'MARKET_PM',
          round: 1, signDueAt: 1893456000000, extensionCount: 0, my: null, other: null, otherSubmitted: false,
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    const vm = wrapper.vm as unknown as ComponentPublicInstance;
    expect(vm).toBeTruthy();
    expect(wrapper.findAll('.ant-card').length).toBeGreaterThanOrEqual(3);
    wrapper.unmount();
  });
});

/** R212 ORPHAN-A1：列席 3 端点 + 条件遗留清单接线（2026-09-24）。 */
describe('R177-A6 Gate 评审详情页 · ORPHAN-A1 列席与遗留接线', () => {
  const reviewFixture = (gateId: string) => ({
    gateId, gateCode: 'G3', status: 'PENDING', dualSign: true, leadSide: 'MARKET_PM',
    round: 1, signDueAt: 1893456000000, extensionCount: 0, my: null, other: null, otherSubmitted: false,
  });

  function stubGateDetailApi(opts: { observerRow?: unknown; legacyRows?: unknown[] }) {
    const calls: { method: string; url: string }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, url });
      if (url === '/api/v1/projects/101/gates') {
        return envelope([{ id: '9001', projectId: '101', gateCode: 'G3', status: 'PENDING', currentRound: 1, signDueAt: 1893456000000, concludedAt: null }]);
      }
      if (url === '/api/v1/gates/9001/review') {
        return envelope(reviewFixture('9001'));
      }
      if (method === 'GET' && url === '/api/v1/gates/9001/observers') {
        return envelope(opts.observerRow === undefined ? [] : [opts.observerRow]);
      }
      if (method === 'POST' && url === '/api/v1/gates/9001/observers/invite') {
        return envelope({ gateId: '9001', role: 'SALES', invitedCount: 1 });
      }
      if (method === 'POST' && url === '/api/v1/gates/9001/observers/7/opinion') {
        return envelope({
          id: '11', gateId: '9001', observerId: '7', role: 'SALES',
          attended: 1, opinion: JSON.parse(String(init?.body ?? '{}')).opinion, invitedAt: 1789388463000,
        });
      }
      if (method === 'GET' && url === '/api/v1/gates/9001/legacy') {
        return envelope(opts.legacyRows ?? []);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    return { calls, fetcher };
  }

  it('组长身份挂载即自动调 GET /observers 并渲染列席行', async () => {
    loginAs('GROUP_LEADER');
    stubGateDetailApi({
      observerRow: { id: '11', gateId: '9001', observerId: '9', role: 'QUALITY', attended: null, opinion: '关注产线良率', invitedAt: 1789388463000 },
    });
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('关注产线良率'));
    // GET /observers 真实发生（自动加载，组长身份）
    const wrapperText = wrapper.text();
    expect(wrapperText).toContain('列席人员与意见');
    expect(wrapperText).toContain('邀约列席');
    wrapper.unmount();
  });

  it('普通 PM 身份不自动调 GET /observers（后端仅组长/超管放行，前端前置避免必然失败请求）', async () => {
    loginAs('MARKET_PM');
    const { calls } = stubGateDetailApi({ observerRow: undefined });
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('列席人员与意见'));
    expect(calls.some((call) => call.url === '/api/v1/gates/9001/observers')).toBe(false);
    expect(wrapper.text()).toContain('列席名单仅组长/超管可查');
    wrapper.unmount();
  });

  it('邀约列席：填 personId 后经 Popconfirm 确认 POST /observers/invite', async () => {
    loginAs('GROUP_LEADER');
    const { calls } = stubGateDetailApi({ observerRow: undefined });
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('邀约列席'));
    const inviteInput = wrapper.find('input[placeholder*="列席人 personId"]');
    expect(inviteInput.exists()).toBe(true);
    await inviteInput.setValue('12, 15');
    await wrapper.findAll('button').find((button) => button.text().includes('邀约列席'))!.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-popconfirm')).toBeTruthy());
    (document.body.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement)
      .dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const invite = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/gates/9001/observers/invite');
      expect(invite).toBeTruthy();
    });
    wrapper.unmount();
  });

  it('列席意见：仅本人行渲染提交入口，POST /observers/{observerId}/opinion 落库回显', async () => {
    loginAs('GROUP_LEADER', '7'); // 本人 personId=7，与 observerId=7 匹配
    // 双行 fixture（本人 observerId=7 + 他人 observerId=8）：stubGateDetailApi 仅支持单行，此处内联
    const calls: { method: string; url: string }[] = [];
    const twoRows = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, url });
      if (url === '/api/v1/projects/101/gates') {
        return envelope([{ id: '9001', projectId: '101', gateCode: 'G3', status: 'PENDING', currentRound: 1, signDueAt: 1893456000000, concludedAt: null }]);
      }
      if (url === '/api/v1/gates/9001/review') {
        return envelope({ gateId: '9001', gateCode: 'G3', status: 'PENDING', dualSign: true, leadSide: 'MARKET_PM', round: 1, signDueAt: 1893456000000, extensionCount: 0, my: null, other: null, otherSubmitted: false });
      }
      if (method === 'GET' && url === '/api/v1/gates/9001/observers') {
        return envelope([
          { id: '11', gateId: '9001', observerId: '7', role: 'SALES', attended: null, opinion: null, invitedAt: 1789388463000 },
          { id: '12', gateId: '9001', observerId: '8', role: 'QUALITY', attended: 1, opinion: '产线已验证', invitedAt: 1789388463000 },
        ]);
      }
      if (method === 'POST' && url === '/api/v1/gates/9001/observers/7/opinion') {
        return envelope({ id: '11', gateId: '9001', observerId: '7', role: 'SALES', attended: 1, opinion: JSON.parse(String(init?.body ?? '{}')).opinion, invitedAt: 1789388463000 });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', twoRows);
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('未提交'));
    // 本人行出现意见输入与提交按钮；他人行显示「仅列席人本人可提交」
    expect(wrapper.find('input[placeholder*="我的列席意见"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('仅列席人本人可提交');
    await wrapper.find('input[placeholder*="我的列席意见"]').setValue('同意本次评审结论');
    await wrapper.findAll('button').find((button) => button.text() === '提交意见')!.trigger('click');
    await vi.waitFor(() => {
      const opinion = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/gates/9001/observers/7/opinion');
      expect(opinion).toBeTruthy();
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('同意本次评审结论'));
    wrapper.unmount();
  });

  it('条件遗留清单：手动加载 GET /legacy 渲染 OPEN/逾期标记', async () => {
    loginAs('GROUP_LEADER');
    stubGateDetailApi({
      legacyRows: [
        { resultId: 'er-2', elementCode: 'G1-02', elementName: '商业模式可行性', result: 'PASS_WITH_CONDITION',
          leftoverItem: '补充单位经济测算', responsiblePersonId: '7', leftoverDueAt: '2026-09-20T23:59:59',
          leftoverStatus: 'OPEN', closedEvidence: null, overdue: true },
      ],
    });
    const wrapper = await mountWith({ projectId: '101', gateId: '9001' });
    await vi.waitFor(() => expect(wrapper.text()).toContain('条件遗留清单'));
    // 未加载前不发起请求（低频查看数据手动拉取）
    expect(wrapper.text()).toContain('加载遗留清单');
    await wrapper.findAll('button').find((button) => button.text().includes('加载遗留清单'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('补充单位经济测算'));
    expect(wrapper.text()).toContain('已逾期');
    expect(wrapper.text()).toContain('未关闭');
    wrapper.unmount();
  });
});
