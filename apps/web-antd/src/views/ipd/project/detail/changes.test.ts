/**
 * 项目详情 - 需求与变更（IpdProjectChanges / P0-10.25）：
 *
 * Tab3 需求变更双签：6 端点（POST/PUT/GET）全部交付，本页接完整工作流
 *   - 创建草稿（POST /requirement-changes）
 *   - 提交双签（PUT /{id}/submit，DRAFT → PENDING_SIGN）
 *   - 签署决策（PUT /{id}/sign，APPROVE/REJECT）
 *   - 列表（GET /requirement-changes?projectId=&status=）
 *
 * Tab1 系数变更 + Tab2 上市日期：仅 POST 发起/决策已交付，GET 列表/详情读端点未交付，
 * 仍挂 backend-pending 占位。
 *
 * Mock 形态：依 .vue 同模块的 ipdPost/ipdPut/ipdGet → ipd-auth.authenticatedRequest → fetch 链。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import ChangesProjectTab from './changes.vue';

const response = (data: unknown, code = 0) => new Response(
  JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
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
    // 新口径：双签工作流已交付
    expect(text).toContain('双签否决');
    wrapper.unmount();
  });

  it('Tab1/Tab2 仍保留 backend-pending 占位（系数/上市日期 GET 列表/详情读端点未交付）', async () => {
    stubApi();
    const router = buildRouter();
    await router.push('/ipd/projects/9140004/changes');
    await router.isReady();
    const wrapper = mount(ChangesProjectTab, { global: { plugins: [router] } });
    // 默认 Tab 是 coefficient；列表占位 prompt 不依赖 Tab 切换，可见
    await vi.waitFor(() => expect(wrapper.text()).toContain('发起系数变更'));
    expect(wrapper.text()).toContain('两类变更单的 GET 列表/详情读端点均未交付');
    expect(wrapper.text()).toContain('读端点交付前本区不展示任何模拟数据');
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
    const createBtn = wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'));
    expect(createBtn).toBeDefined();
    await createBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单草稿已创建'));
    // POST /requirement-changes 已发出
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/requirement-changes'));
    expect(post).toBeDefined();
    // DRAFT 状态下显示「提交双签」按钮
    expect(wrapper.text()).toContain('提交双签');
    expect(wrapper.text()).toContain('DRAFT → PENDING_SIGN');
    wrapper.unmount();
  });

  it('提交双签：DRAFT → PENDING_SIGN → PUT /{id}/submit → 显示 PENDING_SIGN alert + 「签署决策」区', async () => {
    const calls = stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    // 创建草稿
    await wrapper.find('input[placeholder*="需求 ID"]').setValue('20003');
    await wrapper.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('变更缘由'))!.setValue('新增导出报表');
    await wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单草稿已创建'));
    // 点「提交双签」
    const submitBtn = wrapper.findAll('button').find((b) => b.text() === '提交双签');
    expect(submitBtn).toBeDefined();
    await submitBtn!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单已提交双签'));
    // PUT /submit 已发出
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/requirement-changes/100003/submit'))).toBe(true);
    // 签署决策区出现
    expect(wrapper.text()).toContain('签署决策（PENDING_SIGN）');
    expect(wrapper.text()).toContain('通过');
    expect(wrapper.text()).toContain('驳回');
    wrapper.unmount();
  });

  it('签署决策：通过 → PUT /{id}/sign?decision=APPROVE → 显示 APPROVED 终态', async () => {
    const calls = stubApi();
    const wrapper = await switchToRequirementTab(buildRouter(), '/ipd/projects/9140004/changes');
    await wrapper.find('input[placeholder*="需求 ID"]').setValue('20003');
    await wrapper.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('变更缘由'))!.setValue('新增导出报表');
    await wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('变更单草稿已创建'));
    await wrapper.findAll('button').find((b) => b.text() === '提交双签')!.trigger('click');
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
    await wrapper.findAll('button').find((b) => b.text().includes('创建变更草稿'))!.trigger('click');
    // 50001 在 IPD_COMMON_CODE_TEXTS → 「数据不存在或已被删除」
    await vi.waitFor(() => expect(wrapper.text()).toContain('数据不存在或已被删除'));
    wrapper.unmount();
  });
});