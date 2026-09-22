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

import Index from './index.vue';

const envelope = (data: unknown, status = 200, code = 0): Response => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-22T00:00:00Z', traceId: 'fixture' }),
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
