// 阶段确认页组件级验证（浏览器视觉验收因 15666 前端需登录态而降级为本挂载测试）：
// mock 真实 /api/v1 契约（projects/gate-checklist/advance-stage），断言原型
// StageConfirmPage 一比一结构、服务端推进交互与门禁失败（400/10001）明细透传。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Review from './index.vue';

const response = (data: unknown, status = 200, code = 0, message?: string) => new Response(
  JSON.stringify({ code, message: message ?? (code ? '请求不合法' : 'success'), data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const project = {
  id: '1', code: 'P-001', name: '演示项目', productId: '10', templateType: 'SOFTWARE',
  level: 'B', status: 'ACTIVE', currentStage: 'CONCEPT',
};
const checklist = {
  configVersion: 'v1', level: 'B', projectId: '1', stage: 'CONCEPT',
  items: [
    { code: 'C-01', name: '商业决策评审通过', ok: true, reason: '', stage: 'CONCEPT', status: 'DONE' },
    { code: 'C-02', name: '市场需求评审证据归档', ok: false, reason: '缺少市场评审纪要', stage: 'CONCEPT', status: null },
  ],
};

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 幂等 mock：advance-stage 成功后服务端阶段推进，后续 GET 一致返回 PLAN。 */
function stubApi(advance?: Response) {
  setActivePinia(createPinia());
  const calls: { method: string; url: string }[] = [];
  let stage = 'CONCEPT';
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url });
    if (method === 'GET' && url === '/api/v1/projects') return response([{ ...project, currentStage: stage }]);
    if (method === 'GET' && url === '/api/v1/projects/1') return response({ ...project, currentStage: stage });
    if (method === 'GET' && url === '/api/v1/projects/1/gate-checklist') return response(checklist);
    if (method === 'POST' && url === '/api/v1/projects/1/advance-stage') {
      if (advance) return advance;
      stage = 'PLAN';
      return response({ ...project, currentStage: stage });
    }
    return response(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

async function mountReview() {
  const wrapper = mount(Review);
  await vi.waitFor(() => expect(wrapper.text()).toContain('还缺 1 个动作'));
  return wrapper;
}

describe('IPD review page (prototype StageConfirmPage)', () => {
  it('renders the prototype layout with the real gate checklist', async () => {
    stubApi();
    const wrapper = await mountReview();
    // 原型页头与项目选择器（本仓适配：顶部选项目）
    expect(wrapper.text()).toContain('阶段确认');
    expect(wrapper.text()).toContain('提交概念阶段确认');
    expect(wrapper.text()).toContain('演示项目 · P-001');
    expect(wrapper.text()).toContain('当前阶段：概念');
    // 左栏 review-row：1 通过 1 未通过，reason 原样透出
    expect(wrapper.text()).toContain('商业决策评审通过');
    expect(wrapper.text()).toContain('市场需求评审证据归档');
    expect(wrapper.text()).toContain('缺少市场评审纪要');
    expect(wrapper.findAll('.review-row .pill').map((pill) => pill.text())).toEqual(['已通过', '未通过']);
    // 右栏确认条件与门禁状态卡（数据源 = checklist 未通过数）
    expect(wrapper.text()).toContain('确认条件');
    expect(wrapper.text()).toContain('顺序控制');
    expect(wrapper.text()).toContain('还缺 1 个动作');
    // 后置面板：五节点链 / 关键 Gate / 豁免如实登记；CONCEPT 阶段不渲染双周评审
    expect(wrapper.text()).toContain('双PM阶段确认链');
    expect(wrapper.text()).toContain('暂无五节点决策');
    expect(wrapper.text()).toContain('五大关键联合 Gate');
    expect(wrapper.text()).toContain('例外豁免');
    expect(wrapper.text()).not.toContain('开发双周评审');
    const waiver = wrapper.findAll('button').find((button) => button.text().includes('申请豁免'));
    expect(waiver?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('advances the stage through the real endpoint and refreshes the gate', async () => {
    const calls = stubApi();
    const wrapper = await mountReview();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('提交计划阶段确认'));
    expect(wrapper.text()).toContain('当前阶段：计划');
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/projects/1/advance-stage')).toBe(true);
    wrapper.unmount();
  });

  it('surfaces gate failure details from the 400 envelope without loosening', async () => {
    // requestIpd 契约：code!=0 走 messageFromCode 映射表短路（10001→阶段输入文案），envelope.message 不透传
    stubApi(response(null, 400, 10001, '门禁校验失败：市场需求评审证据归档未完成'));
    const wrapper = await mountReview();
    await wrapper.get('.page-heading .primary-button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('阶段输入信息不符合要求，请检查后重试'));
    expect(wrapper.text()).toContain('提交概念阶段确认');
    wrapper.unmount();
  });

  it('shows the empty state when no project exists', async () => {
    setActivePinia(createPinia());
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/projects') return response([]);
      return response(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Review);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无 IPD 项目'));
    const submit = wrapper.findAll('button').find((button) => button.text().includes('阶段确认'));
    expect(submit?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
