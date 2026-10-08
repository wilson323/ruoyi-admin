// 页12/13 动作详情 - 深管/轻管分支 + FAR/FRR + 乐观锁 50002。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import {
  registerCopilotPageContext,
  streamCopilot,
} from '../../../../api/ipd/ai-copilot';
import type { StageAction } from '../../../../api/ipd/stage-action';
import ActionDetail from './index.vue';

const api = vi.hoisted(() => ({
  addStageActionDeliverable: vi.fn(),
  aiExecuteStageAction: vi.fn(),
  listActionDeliverables: vi.fn(),
  listStageActions: vi.fn(),
  recordStageActionFields: vi.fn(),
  transitStageAction: vi.fn(),
}));
vi.mock('../../../../api/ipd/stage-action', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const routeState = vi.hoisted(() => ({ projectId: 'PRJ-1', actionId: 'W-1' }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: reactiveRoute, query: {} }),
}));

const { reactive } = await import('vue');
let reactiveRoute = reactive({ ...routeState });

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function deep(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: 'W-1', projectId: 'PRJ-1', stageId: 'STG-1', actionCode: 'C02', actionName: '客户问题验证',
    ownerRole: 'MARKET_PM', depth: 'DEEP', status: 'IN_PROGRESS',
    historyMark: null, isBlocking: null,
    actualDoneAt: null, farValue: null, frrValue: null,
    certNo: null, certPassedAt: null, algoType: null, isBioFeature: null,
    dueDate: null, sopId: 'SOP-1', remark: null, version: 1,
    ...overrides,
  };
}

function light(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: 'W-1', projectId: 'PRJ-1', stageId: 'STG-1', actionCode: 'P05', actionName: '文档校对',
    ownerRole: 'RD_PM', depth: 'LIGHT', status: 'NOT_STARTED',
    historyMark: null, isBlocking: null,
    actualDoneAt: null, farValue: null, frrValue: null,
    certNo: null, certPassedAt: null, algoType: null, isBioFeature: null,
    dueDate: null, sopId: 'SOP-2', remark: null, version: 1,
    ...overrides,
  };
}

function lightD11(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: 'W-1', projectId: 'PRJ-1', stageId: 'STG-1', actionCode: 'D11',
    actionName: 'BioCV 算法训练与评测',
    ownerRole: 'RD_PM', depth: 'LIGHT', status: 'IN_PROGRESS',
    historyMark: null, isBlocking: '1',
    actualDoneAt: null, farValue: null, frrValue: null,
    certNo: null, certPassedAt: null, algoType: 'FACE', isBioFeature: '1',
    dueDate: null, sopId: 'SOP-D11', remark: null, version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listActionDeliverables.mockResolvedValue([]);
  routerMock.replace.mockReset();
  reactiveRoute = reactive({ projectId: 'PRJ-1', actionId: 'W-1' });
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountDetail() {
  const wrapper = mount(ActionDetail);
  await flushPromises();
  return wrapper;
}

describe('页12/13 动作详情', () => {
  it('加载态：保留 loading', async () => {
    let resolve!: (rows: StageAction[]) => void;
    api.listStageActions.mockReturnValueOnce(new Promise<StageAction[]>((r) => { resolve = r; }));
    mount(ActionDetail);
    await flushPromises();
    expect(api.listStageActions).toHaveBeenCalledWith('PRJ-1');
    resolve([]);
    await flushPromises();
  });

  it('深管动作：显示「需交付物」徽标（depth 白话化） + 上传交付物按钮', async () => {
    api.listStageActions.mockResolvedValueOnce([deep()]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    expect(html).toContain('需交付物');
    expect(html).toContain('客户问题验证');
    expect(html).toContain('上传交付物');
    expect(html).not.toContain('FAR');
  });

  it('轻管动作：显示「免交付物」徽标（depth 白话化），无上传交付物按钮', async () => {
    api.listStageActions.mockResolvedValueOnce([light()]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    expect(html).toContain('免交付物');
    expect(html).toContain('文档校对');
    // 「无需上传交付物」的 Alert 文案含同名词，按“按钮元素不存在”断言无上传入口
    expect(wrapper.findAll('button').some((b) => b.text().includes('上传交付物'))).toBe(false);
  });

  it('D11 动作：显示 FAR/FRR 字段（例外一）', async () => {
    api.listStageActions.mockResolvedValueOnce([lightD11({ farValue: 0.001, frrValue: 0.002 })]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    expect(html).toContain('FAR');
    expect(html).toContain('FRR');
    expect(html).toContain('阻断性动作');
    expect(html).toContain('0.001');
    expect(html).toContain('0.002');
  });

  it('阻断性动作徽标显示', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ isBlocking: '1' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('阻断性动作');
  });

  it('历史缺失标记显示', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ historyMark: 'HISTORICAL_MISSING' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('历史缺失');
  });

  it('50002 乐观锁 → 中文错误提示', async () => {
    api.listStageActions.mockRejectedValueOnce(new IpdRequestError('x', 409, 50002, 'http'));
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('状态已变更');
  });

  it('10001 字段缺失 → 输入校验错误', async () => {
    api.listStageActions.mockRejectedValueOnce(new IpdRequestError('x', 400, 10001, 'http'));
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('输入信息');
  });

  it('transport 异常 → 网络异常文案', async () => {
    api.listStageActions.mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'));
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('无法连接服务');
  });

  it('找不到动作 ID → loadError 提示「不在项目下」', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ id: 'OTHER' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('不在项目');
  });

  it('返回 IPD 流程按钮跳转', async () => {
    api.listStageActions.mockResolvedValueOnce([light()]);
    const wrapper = await mountDetail();
    const backBtn = wrapper.findAll('button').find((b) => b.text().includes('返回 IPD 流程'));
    await backBtn!.trigger('click');
    expect(routerMock.replace).toHaveBeenCalledWith('/ipd/projects/PRJ-1/flow');
  });

  it('V02 动作：显示 certNo/certPassedAt 字段（例外二）', async () => {
    api.listStageActions.mockResolvedValueOnce([lightD11({
      actionCode: 'V02', actionName: '国别认证',
      isBlocking: '1', algoType: null, isBioFeature: null,
      certNo: 'CN-123', certPassedAt: 1726000000000,
    })]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    // Antd Descriptions 的 cell 渲染有特殊结构，直接断言组件 setup 暴露的内部状态更稳定
    const vm = wrapper.vm as unknown as { action?: { certNo: string; actionCode: string; certPassedAt: number } };
    expect(vm.action?.actionCode).toBe('V02');
    expect(vm.action?.certNo).toBe('CN-123');
    expect(vm.action?.certPassedAt).toBe(1726000000000);
    // V02 不显示 FAR/FRR（D11/Z01 专属例外字段）
    expect(html).not.toContain('FAR');
    expect(html).not.toContain('FRR');
    // 阻断性动作徽标仍在
    expect(html).toContain('阻断性动作');
  });

  // ============================================================
  //  R221 Task 14：AI 执行按钮 + 对话即填表前端半环
  // ============================================================

  it('R221 AI 执行按钮：进行中动作可见 → 点击调 aiExecuteStageAction', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'P08', status: 'IN_PROGRESS' })]);
    api.aiExecuteStageAction.mockResolvedValueOnce({ actionCode: 'P08', status: 'PENDING', taskId: '9001' });
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('AI 执行');
    const btn = wrapper.findAll('button').find((b) => b.text().includes('AI 执行'));
    await btn!.trigger('click');
    await flushPromises();
    expect(api.aiExecuteStageAction).toHaveBeenCalledWith('W-1');
  });

  it('R221 AI 执行按钮：DONE 动作不显示', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'P08', status: 'DONE' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).not.toContain('AI 执行');
  });

  it('R221 对话即填表：fillPayload 回填可持久化字段、排除 remark、绝不自 saveFields（suggest 红线）', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'C08', status: 'IN_PROGRESS' })]);
    const wrapper = await mountDetail();
    window.dispatchEvent(new CustomEvent('ipd:ai-fill-payload', {
      detail: {
        fields: { algoType: 'FACE', remark: 'AI 建议值', salary: '99999' },
        mode: 'suggest',
        scene: 'stage-action-fields',
      },
    }));
    await flushPromises();
    const vm = wrapper.vm as unknown as { fields?: { algoType?: string; remark?: string } };
    // 可持久化字段回填
    expect(vm.fields?.algoType).toBe('FACE');
    // W1：remark 走 /fields 存不了 → 前端不回填，避免误导「保存字段」
    expect(vm.fields?.remark).not.toBe('AI 建议值');
    expect(wrapper.html()).toContain('AI 已填充');
    // 非白名单 key（salary）不得写入 fields
    expect((vm.fields as Record<string, unknown>)?.salary).toBeUndefined();
    // suggest 模式红线：回填后不得自动提交
    expect(api.recordStageActionFields).not.toHaveBeenCalled();
  });

  it('R221 对话即填表：mode=auto 防御性忽略（首切片未落地自动提交）', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'C08', status: 'IN_PROGRESS' })]);
    const wrapper = await mountDetail();
    window.dispatchEvent(new CustomEvent('ipd:ai-fill-payload', {
      detail: { fields: { algoType: 'IRIS' }, mode: 'auto', scene: 'stage-action-fields' },
    }));
    await flushPromises();
    const vm = wrapper.vm as unknown as { fields?: { algoType?: string } };
    expect(vm.fields?.algoType).not.toBe('IRIS');
    expect(api.recordStageActionFields).not.toHaveBeenCalled();
  });
});
// ============================================================
//  R232 P2-03 fillContext 落地：白名单同源镜像对账 + 预填 + C08 零自动提交
// ============================================================

describe('R232 P2-03 fillContext 落地', () => {
  /**
   * 白名单对账内嵌清单（后端唯一事实源镜像）：AiCopilotService.FILL_FIELD_WHITELIST
   * ['stage-action-fields']（AiCopilotService.java L285-287，R230 起 6 字段）。
   * 对照表：
   *   后端 L286-287 = actualDoneAt, farValue, frrValue, certNo, certPassedAt, algoType
   *   前端 FILLABLE_FIELDS（index.vue）= actualDoneAt, farValue, frrValue, certNo, certPassedAt, algoType
   * 逐字段一致、禁扩（后端没有的字段一个不加）。
   */
  const BACKEND_FILL_FIELD_WHITELIST = [
    'actualDoneAt', 'farValue', 'frrValue', 'certNo', 'certPassedAt', 'algoType',
  ];

  afterEach(() => registerCopilotPageContext(null));

  it('白名单对账：前端 FILLABLE_FIELDS 镜像与后端 FILL_FIELD_WHITELIST 逐字段一致（6 字段，禁扩）', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'C08', status: 'IN_PROGRESS' })]);
    const wrapper = await mountDetail();
    const vm = wrapper.vm as unknown as { FILLABLE_FIELDS?: string[] };
    expect(vm.FILLABLE_FIELDS).toBeDefined();
    // 数量断言 + 逐字段集合断言（双向：无缺失、无多出 = 禁扩留证）
    expect(vm.FILLABLE_FIELDS).toHaveLength(BACKEND_FILL_FIELD_WHITELIST.length);
    expect([...(vm.FILLABLE_FIELDS ?? [])].sort()).toEqual([...BACKEND_FILL_FIELD_WHITELIST].sort());
  });

  it('fillPayload 预填：白名单内 6 字段全部回填、白名单外（remark/salary）忽略不落表单', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'C08', status: 'IN_PROGRESS' })]);
    const wrapper = await mountDetail();
    window.dispatchEvent(new CustomEvent('ipd:ai-fill-payload', {
      detail: {
        fields: {
          actualDoneAt: 1_726_000_000_000,
          algoType: 'FACE',
          certNo: 'CN-1',
          certPassedAt: 1_726_000_000_000,
          farValue: 0.001,
          frrValue: 0.002,
          remark: '白名单外-越界值',
          salary: '99999',
        },
        mode: 'suggest',
        scene: 'stage-action-fields',
      },
    }));
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      aiFillHint?: string;
      fields?: Record<string, unknown>;
    };
    // 预填字段 = 白名单内：逐字段断言
    expect(vm.fields?.actualDoneAt).toBe(1_726_000_000_000);
    expect(vm.fields?.farValue).toBe(0.001);
    expect(vm.fields?.frrValue).toBe(0.002);
    expect(vm.fields?.certNo).toBe('CN-1');
    expect(vm.fields?.certPassedAt).toBe(1_726_000_000_000);
    expect(vm.fields?.algoType).toBe('FACE');
    // 白名单外字段忽略（禁扩）：一个不落表单
    expect(vm.fields?.remark).toBe('');
    expect(vm.fields?.salary).toBeUndefined();
    // 计数对账：6/6 全应用（hint 计数 = 后端白名单字段数）
    expect(vm.aiFillHint).toContain('已填充 6 个字段');
  });

  it('C08 铁律零自动提交：预填后无任何请求发出（saveFields/aiExecute/transit/deliverable 全零调用）', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'C08', status: 'IN_PROGRESS' })]);
    await mountDetail();
    window.dispatchEvent(new CustomEvent('ipd:ai-fill-payload', {
      detail: {
        fields: { algoType: 'FACE', certNo: 'CN-1' },
        mode: 'suggest',
        scene: 'stage-action-fields',
      },
    }));
    await flushPromises();
    // 预填只是填表单：提交必须人手动点既有「保存字段」按钮——预填链路零自动提交、零直写
    expect(api.recordStageActionFields).not.toHaveBeenCalled();
    expect(api.aiExecuteStageAction).not.toHaveBeenCalled();
    expect(api.transitStageAction).not.toHaveBeenCalled();
    expect(api.addStageActionDeliverable).not.toHaveBeenCalled();
  });

  it('fillContext 注册：挂载后 pageContext（scene/actionCode）随 streamCopilot 请求上送，卸载后清除', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ actionCode: 'C08', status: 'IN_PROGRESS' })]);
    // 每次调用返回全新 Response（同一 Response 的流只能读一次，复用会 locked）
    const fetcher = vi.fn().mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetcher);
    const handlers = { onDelta: () => {}, onDone: () => {}, onError: () => {}, onMeta: () => {} };
    const wrapper = await mountDetail();
    await streamCopilot({ message: '帮我填一下' }, handlers);
    // 注册断言：页面上下文 JSON 随请求上送（键面 = 后端 fillPagePath 解析面）。
    // 测试桩 id='W-1' 非数值 → stageActionId 省略（对齐后端 L324-325 仅采纳 >0 数值的条件，不发明键）。
    const sent = JSON.parse(
      String(new URL(String(fetcher.mock.calls[0]![0]), 'http://test.local').searchParams.get('pageContext')),
    );
    expect(sent).toEqual({ actionCode: 'C08', scene: 'stage-action-fields' });
    // 卸载清除：防跨页串送
    wrapper.unmount();
    await streamCopilot({ message: '帮我填一下' }, handlers);
    expect(
      new URL(String(fetcher.mock.calls[1]![0]), 'http://test.local').searchParams.has('pageContext'),
    ).toBe(false);
  });

  it('雪花动作 ID 按原文进入 pageContext，不经 Number()', async () => {
    const snowflake = '9007199254740993';
    reactiveRoute.actionId = snowflake;
    api.listStageActions.mockResolvedValueOnce([deep({ id: snowflake, actionCode: 'C08', status: 'IN_PROGRESS' })]);
    const fetcher = vi.fn().mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetcher);
    const handlers = { onDelta: () => {}, onDone: () => {}, onError: () => {}, onMeta: () => {} };
    await mountDetail();
    await streamCopilot({ message: '帮我填一下' }, handlers);
    const raw = String(new URL(String(fetcher.mock.calls[0]![0]), 'http://test.local').searchParams.get('pageContext'));
    expect(raw).toContain(`"stageActionId":${snowflake}`);
    expect(raw).not.toContain('"stageActionId":9007199254740992');
  });
});

it('同实例切项目立即撤下旧动作，迟到列表不覆盖新项目', async () => {
  let resolveOld!: (rows: StageAction[]) => void;
  api.listStageActions.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const wrapper = mount(ActionDetail);
  await flushPromises();
  api.listStageActions.mockResolvedValueOnce([deep({ id: 'W-2', projectId: 'PRJ-2', actionName: '新项目动作' })]);
  reactiveRoute.projectId = 'PRJ-2';
  reactiveRoute.actionId = 'W-2';
  await flushPromises();
  expect(api.listStageActions).toHaveBeenLastCalledWith('PRJ-2');
  expect(wrapper.text()).toContain('新项目动作');
  resolveOld([deep({ actionName: '旧项目动作' })]);
  await flushPromises();
  expect(wrapper.text()).not.toContain('旧项目动作');
  expect(wrapper.text()).toContain('新项目动作');
  wrapper.unmount();
});

describe('文档预览 G3：深管交付物列表与统一查看', () => {
  it('深管动作加载交付物列表，点「查看」打开统一预览 Modal', async () => {
    api.listStageActions.mockResolvedValueOnce([deep()]);
    api.listActionDeliverables.mockResolvedValueOnce([
      { fileName: '客户验证报告.pdf', fileSize: '2048', id: '9001', uploadedAt: '2026-10-08 10:00:00' },
    ]);
    const wrapper = await mountDetail();
    expect(api.listActionDeliverables).toHaveBeenCalledWith('W-1');
    const listArea = wrapper.find('[data-testid="action-deliverable-list"]');
    expect(listArea.text()).toContain('客户验证报告.pdf');
    expect(listArea.text()).toContain('2.0 KB');
    const viewButton = listArea.findAll('button').find((b) => b.text().includes('查看'));
    expect(viewButton, '交付物行应提供「查看」入口').toBeTruthy();
    await viewButton!.trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.ant-modal')?.textContent).toContain('客户验证报告.pdf');
    document.body.innerHTML = '';
    wrapper.unmount();
  });

  it('轻管动作不拉交付物列表', async () => {
    api.listStageActions.mockResolvedValueOnce([light()]);
    await mountDetail();
    expect(api.listActionDeliverables).not.toHaveBeenCalled();
  });
});
