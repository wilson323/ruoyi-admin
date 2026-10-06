/**
 * 项目详情 - 需求与变更（IpdProjectChanges / P0-10.25）：
 *
 * Tab3 需求变更双签：6 端点（POST/PUT/GET）全部交付，本页接完整工作流
 *   - 创建草稿（POST /requirement-changes）
 *   - 提交双签（PUT /{id}/submit，DRAFT → PENDING_SIGN）
 *   - 签署决策（PUT /{id}/sign，APPROVE/REJECT）
 *   - 列表（GET /requirement-changes?projectId=&status=）
 *
 * 上市日期变更 Tab：P1-2（2026-09-21）交付 GET 列表/详情读端点，
 * 「本项目变更单列表」卡片接上，按创建时间倒序展示（pending / confirmed / rejected 全状态可查）。
 * 2026-10-03 拆除：系数变更 Tab 已随业绩窗口域下线（后端 CoefficientChangeController 已删），
 * 本测试同步移除 Tab1 断言，默认激活 Tab 变为 launch-date。
 *
 * Mock 形态：依 .vue 同模块的 ipdPost/ipdPut/ipdGet → ipd-auth.authenticatedRequest → fetch 链。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import ChangesProjectTab from './changes.vue';

const response = (data: unknown, code = 0) => new Response(
  // R215-E2E-B：非零 code 的 message 置空（后端无 message → 查表链意图保留）。
  JSON.stringify({ code, message: '', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const initialList = {
  total: 2,
  records: [
    {
      id: '100001',
      projectId: '9140004',
      requirementId: '20001',
      changeType: 'REQUIREMENT',
      reason: '需求范围调整',
      beforeSnapshot: '{"cost":"50k"}',
      afterSnapshot: '{"cost":"80k"}',
      signatures: null,
      status: 'PENDING_SIGN',
      createTime: '2026-09-06T10:00:00',
      updateTime: '2026-09-06T10:05:00',
    },
    {
      id: '100002',
      projectId: '9140004',
      requirementId: '20002',
      changeType: 'LAUNCH',
      reason: '上市推迟',
      beforeSnapshot: null,
      afterSnapshot: null,
      signatures: '["market","rd"]',
      status: 'APPROVED',
      createTime: '2026-09-05T09:00:00',
      updateTime: '2026-09-05T15:00:00',
    },
  ],
};

const draftResponse = {
  id: '100003',
  projectId: '9140004',
  requirementId: '20003',
  changeType: 'REQUIREMENT',
  reason: '新增导出报表',
  beforeSnapshot: null,
  afterSnapshot: null,
  signatures: null,
  status: 'DRAFT',
  createTime: '2026-09-07T10:00:00',
  updateTime: null,
};

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/projects/:projectId/changes', name: 'IpdProjectChanges', component: { template: '<div />' } },
    ],
  });
}

type FetcherCall = { method: string; url: string };

function stubApi(opts: { initialList?: unknown; failNextPost?: boolean } = {}) {
  const calls: FetcherCall[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url });
    if (opts.failNextPost && method === 'POST' && url.endsWith('/requirement-changes')) {
      return response({ code: 50001, message: '项目不存在' }, 50001);
    }
    // P1-2：上市日期变更列表卡接住 GET 列表端点
    if (method === 'GET' && url.includes('/launch-date-change-requests') && !/\/\d+/.test(url)) {
      return response([
        { id: '5002', projectId: '9140004', proposedLaunchDate: '2026-12-01 00:00:00', previousLaunchDate: '2026-10-01 00:00:00', status: 'PENDING_SECOND', reason: '节奏调整', createTime: '2026-09-21T10:00:00' },
      ]);
    }
    if (method === 'GET' && url.includes('/requirement-changes') && !/\/\d+/.test(url)) {
      return response(opts.initialList ?? initialList);
    }
    if (method === 'POST' && url.endsWith('/requirement-changes')) return response(draftResponse);
    if (method === 'PUT' && url.includes('/requirement-changes/100003/submit')) {
      return response({ ...draftResponse, status: 'PENDING_SIGN' });
    }
    if (method === 'PUT' && url.includes('/requirement-changes/100003/sign')) {
      return response({
        ...draftResponse,
        status: 'APPROVED',
        signatures: '["market","rd"]',
        updateTime: '2026-09-07T11:00:00',
      });
    }
    return response(null, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

/** 切换到「需求变更（双签）」Tab 后返回新 wrapper。 */
async function switchToRequirementTab(router: ReturnType<typeof buildRouter>, path: string) {
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ChangesProjectTab, { global: { plugins: [router] } });
  // ant-design-vue Tabs 默认 lazy 加载，未激活 Tab 内容不渲染；
  // 先等 Tab header 可见（任何时候都渲染），再点击 Tab 激活。
  await vi.waitFor(() => expect(wrapper.text()).toContain('需求变更（双签）'));
  const requirementHeader = wrapper.findAll('.ant-tabs-tab').find((t) => t.text().includes('需求变更'));
  expect(requirementHeader).toBeDefined();
  await requirementHeader!.trigger('click');
  await wrapper.vm.$nextTick();
  // Tab3 onMounted 预拉列表 → 等列表首条 ID 出现表示接口 + 表格都就绪。
  await vi.waitFor(() => expect(wrapper.text()).toContain('100001'));
  return wrapper;
}

describe('IpdProjectChanges 项目需求与变更 (P0-10.25) — Tab3 需求变更双签', () => {
  it('首屏自动 GET /requirement-changes?projectId=9140004 加载列表', async () => {
    const calls = stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    const listCall = calls.find((c) => c.method === 'GET' && c.url.includes('/requirement-changes'));
    expect(listCall).toBeDefined();
    expect(listCall!.url).toContain('projectId=9140004');
    const text = wrapper.text();
    expect(text).toContain('100001');
    expect(text).toContain('100002');
    expect(text).toContain('需求范围调整');
    expect(text).toContain('上市推迟');
    // 状态机标签（来自 _shared/ipd-state-machines.CHANGE_STATUS_MACHINE：待双签/已批准）
    expect(text).toContain('待双签');
    expect(text).toContain('已批准');
    wrapper.unmount();
  });

  it('顶部说明不再含"需求变更 P2-6.1/6.2 未开始"过时文案', async () => {
    stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    const text = wrapper.text();
    // 老占位文案（消除后不应再出现）
    expect(text).not.toContain('P2-6.1 / P2-6.2 未开始');
    expect(text).not.toContain('仅有 domain 类');
    // 新口径：双签工作流已交付（白话化后「双签否决」表述为「任一方驳回即整体驳回」）
    expect(text).toContain('任一方驳回即整体驳回');
    wrapper.unmount();
  });

  it('P1-2 上市日期变更 Tab：首屏自动 GET /launch-date-change-requests?projectId=9140004 接上列表', async () => {
    const calls = stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/changes');
    await router.isReady();
    const wrapper = mount(ChangesProjectTab, { global: { plugins: [router] } });
    // 拆除系数变更 Tab 后，默认激活 Tab 即 launch-date，无需再手动切换
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起上市日期变更'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('5002'));
    const launchCall = calls.find((c) => c.method === 'GET' && c.url.includes('/launch-date-change-requests'));
    expect(launchCall).toBeDefined();
    expect(launchCall!.url).toContain('projectId=9140004');
    // 列表行 5002 渲染出「本项目上市日期变更单列表」卡片
    expect(wrapper.text()).toContain('5002');
    expect(wrapper.text()).toContain('节奏调整');
    // 系数变更 Tab 已拆除：不应再出现任何系数变更入口
    expect(wrapper.text()).not.toContain('系数变更');
    wrapper.unmount();
  });

  it('创建草稿表单：填写后提交 → POST /requirement-changes → 显示 DRAFT alert + 「提交双签」按钮', async () => {
    const calls = stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    const reqIdInput = wrapper.find('input[placeholder*="需求 ID"]');
    expect(reqIdInput.exists()).toBe(true);
    await reqIdInput.setValue('20003');
    const reasonTextarea = wrapper.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('变更缘由'));
    expect(reasonTextarea).toBeDefined();
    await reasonTextarea!.setValue('新增导出报表');
    // D10：影响快照创建时必填（四维 JSON），与后端 P2-6.2 校验同构
    const snapTextareas = wrapper.findAll('textarea').filter((t) => t.attributes('placeholder')?.includes('必填，如'));
    expect(snapTextareas.length).toBe(2);
    await snapTextareas[0]!.setValue('{"范围":"原范围A","成本":1,"时限":"1d","质量":"P1"}');
    await snapTextareas[1]!.setValue('{"范围":"新范围B","成本":2,"时限":"2d","质量":"P2"}');
    const createBtn = wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'));
    expect(createBtn).toBeDefined();
    await createBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单草稿已创建'));
    // POST /requirement-changes 已发出
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/requirement-changes'));
    expect(post).toBeDefined();
    // DRAFT 状态下显示「提交签署」按钮
    expect(wrapper.text()).toContain('提交签署');
    expect(wrapper.text()).toContain('等待两位负责人签署');
    wrapper.unmount();
  });

  it('提交签署：DRAFT → PENDING_SIGN → PUT /{id}/submit → 显示提交成功提示 + 「签署决策」区', async () => {
    const calls = stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    // 创建草稿（D10：快照四维必填）
    await wrapper.find('input[placeholder*="需求 ID"]').setValue('20003');
    await wrapper.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('变更缘由'))!.setValue('新增导出报表');
    const snapTextareas = wrapper.findAll('textarea').filter((t) => t.attributes('placeholder')?.includes('必填，如'));
    await snapTextareas[0]!.setValue('{"范围":"原范围A","成本":1,"时限":"1d","质量":"P1"}');
    await snapTextareas[1]!.setValue('{"范围":"新范围B","成本":2,"时限":"2d","质量":"P2"}');
    await wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单草稿已创建'));
    // 点「提交签署」
    const submitBtn = wrapper.findAll('button').find((b) => b.text() === '提交签署');
    expect(submitBtn).toBeDefined();
    await submitBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单已提交双签'));
    // PUT /submit 已发出
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/requirement-changes/100003/submit'))).toBe(true);
    // 签署决策区出现
    expect(wrapper.text()).toContain('签署决策');
    expect(wrapper.text()).toContain('通过');
    expect(wrapper.text()).toContain('驳回');
    wrapper.unmount();
  });

  it('签署决策：通过 → PUT /{id}/sign?decision=APPROVE → 显示 APPROVED 终态', async () => {
    const calls = stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    await wrapper.find('input[placeholder*="需求 ID"]').setValue('20003');
    await wrapper.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('变更缘由'))!.setValue('新增导出报表');
    const snapTextareas = wrapper.findAll('textarea').filter((t) => t.attributes('placeholder')?.includes('必填，如'));
    await snapTextareas[0]!.setValue('{"范围":"原范围A","成本":1,"时限":"1d","质量":"P1"}');
    await snapTextareas[1]!.setValue('{"范围":"新范围B","成本":2,"时限":"2d","质量":"P2"}');
    await wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单草稿已创建'));
    await wrapper.findAll('button').find((b) => b.text() === '提交签署')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单已提交双签'));
    // 选「通过」（默认就是 approve=true）+ 提交签署
    await wrapper.findAll('button').find((b) => b.text() === '提交签署')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('签署结果'));
    // PUT /sign?decision=APPROVE
    const signCall = calls.find((c) => c.method === 'PUT' && c.url.includes('/requirement-changes/100003/sign'));
    expect(signCall).toBeDefined();
    expect(signCall!.url).toContain('decision=APPROVE');
    // 终态展示（CHANGE_STATUS_MACHINE.APPROVED.label = 已批准）
    expect(wrapper.text()).toContain('已批准');
    wrapper.unmount();
  });

  it('草稿创建失败（业务 50001）：表单错误 Alert 显示 IP-D COMMON 文案', async () => {
    stubApi({ failNextPost: true });
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    await wrapper.find('input[placeholder*="需求 ID"]').setValue('99999999');
    await wrapper.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('变更缘由'))!.setValue('测试错误');
    const snapTextareas = wrapper.findAll('textarea').filter((t) => t.attributes('placeholder')?.includes('必填，如'));
    await snapTextareas[0]!.setValue('{"范围":"原","成本":1,"时限":"1d","质量":"P1"}');
    await snapTextareas[1]!.setValue('{"范围":"新","成本":2,"时限":"2d","质量":"P2"}');
    await wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'))!.trigger('click');
    // 50001 在 IPD_COMMON_CODE_TEXTS → 「数据不存在或已被删除」
    await vi.waitFor(() => expect(wrapper.text()).toContain('数据不存在或已被删除'));
    wrapper.unmount();
  });
});