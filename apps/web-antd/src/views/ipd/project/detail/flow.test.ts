/**
 * 页11 项目详情-IPD 流程（flow.vue）「项目 SOP 快照」Drawer（R215 GAP-F8）：
 * - 首屏回归：阶段进度/动作表既有功能不因 F8 追加回归；
 * - 快照入口 → Drawer 打开 + GET /sop-templates/instances?projectId=<路由 19 位雪花逐字符>；
 * - 实例表渲染：状态 tag 三色文案（生效中/已替代/已归档）、模板 ID 19 位逐字符、实例化人/时间透传；
 * - 展开行快照兜底：合法 JSON pretty 展开、非法 JSON 原文展示不抛（BR-IPD-SOP-03 不可变快照）；
 * - 空态与负例：无快照 → 空态文案；非项目成员 403 → Alert 透传后端 envelope message（E2E-B 契约）。
 * 注：instantiate 归 GAP-B2 等 owner 拍板，本页无实例化按钮（断言锁定防回流）。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Popconfirm } from 'ant-design-vue';

import { aiSuggest } from '../../../../api/ipd/ai-suggest';
import FlowTab from './flow.vue';

// 模块层 mock：L2 AI 建议入口（C08 零直写——建议调用替换为 vi.fn，不触达网络）。
vi.mock('../../../../api/ipd/ai-suggest', () => ({ aiSuggest: vi.fn() }));

const envelope = (data: unknown, status = 200, code = 0, message = 'success'): Response =>
  new Response(
    JSON.stringify({ code, message, data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const PROJECT_ID = '2096266883900000001'; // 19 位雪花，路由承载逐字符无损

const projectFixture = {
  id: PROJECT_ID,
  code: 'PRJ-2026-001',
  name: '旗舰平板项目',
  productId: '3001',
  templateType: 'IPD',
  level: 'P1',
  currentStage: 'CONCEPT',
  status: 'ACTIVE',
};

const checklistFixture = { projectId: PROJECT_ID, stage: 'CONCEPT', configVersion: 'v3', level: 'P1', items: [] };

/** 三行实例：a 常规 ACTIVE / b 19 位雪花 SUPERSEDED + 非法 JSON 快照 / c ARCHIVED。 */
const sopInstancesFixture = [
  {
    id: 8801, templateId: 7712, instanceVersion: 3, projectId: Number(PROJECT_ID),
    snapshotJson: '{"actionList":["A1","A2"],"deadlineMap":{}}',
    instantiatedAt: '2026-09-20T06:30:00.000+00:00', instantiatedBy: '900101', status: 'ACTIVE',
  },
  {
    id: '2096266884247736321', templateId: '2096266884054798338', instanceVersion: '12', projectId: PROJECT_ID,
    snapshotJson: 'not-a-json{{{', instantiatedAt: null, instantiatedBy: null, status: 'SUPERSEDED',
  },
  {
    id: '2096266884299999999', templateId: '2096266884054798338', instanceVersion: '11', projectId: PROJECT_ID,
    snapshotJson: '{}', instantiatedAt: '2026-09-01T02:00:00.000+00:00', instantiatedBy: '900102', status: 'ARCHIVED',
  },
];

/** fetch 分发 stub：project 详情 / stages / stage-actions / gate-checklist / sop instances 五口径。 */
function stubFlowFetch(sopResponder?: () => Response, stagesResponder?: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/ipd/stage/sub-stages/progress')) return envelope({ projectId: PROJECT_ID, currentStage: 'CONCEPT', currentSubStageCode: null, version: 0, gateResult: null, replayed: false, advanced: false });
    if (path.endsWith('/ipd/stage/sub-stages')) return envelope([{ id: '801', code: 'CONCEPT-01', name: '机会识别', stageCode: 'CONCEPT', sortOrder: 1, isGate: '0', gateCode: null, skillHint: null, ownerRole: 'PM', actions: [] }]);
    if (path.includes('/gate-checklist')) return envelope(checklistFixture);
    if (path.endsWith('/stages')) return stagesResponder ? stagesResponder() : envelope({ stages: [] });
    if (path.includes('/stage-actions')) return envelope([]);
    if (path.includes('/sop-templates/instances')) {
      return sopResponder ? sopResponder() : envelope(sopInstancesFixture);
    }
    if (path.startsWith('/api/v1/projects/')) return envelope(projectFixture);
    throw new Error(`unexpected fetch: ${path}`);
  });
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/projects/:projectId/flow', name: 'IpdProjectFlow', component: { template: '<div />' } },
    ],
  });
}

async function mountFlow(fetcher: ReturnType<typeof stubFlowFetch>) {
  vi.stubGlobal('fetch', fetcher);
  const router = buildRouter();
  await router.push(`/ipd/projects/${PROJECT_ID}/flow`);
  await router.isReady();
  const wrapper = mount(FlowTab, { global: { plugins: [router] } });
  await vi.waitFor(() => expect(wrapper.text()).toContain('阶段动作（全项目）'));
  return wrapper;
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('页11 IPD 流程 · 项目 SOP 快照 Drawer（R215 GAP-F8）', () => {
  it('读取项目小阶段持久化游标，保持 19 位项目 ID 字符串', async () => {
    const fetcher = stubFlowFetch();
    const wrapper = await mountFlow(fetcher);
    await vi.waitFor(() => expect(wrapper.find('[data-testid="ipd-sub-stage-progress"]').text()).toContain('版本 0'));
    expect(wrapper.find('[data-testid="ipd-sub-stage-progress"]').text()).toContain('尚未开始');
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toContain(`/api/v1/ipd/stage/sub-stages/progress?projectId=${PROJECT_ID}`);
    wrapper.unmount();
  });

  it('人工确认小阶段推进后携带版本并回读服务端游标', async () => {
    let currentCode: null | string = null;
    let version = 0;
    const base = stubFlowFetch();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/ipd/stage/sub-stages/progress')) {
        return envelope({ projectId: PROJECT_ID, currentStage: 'CONCEPT', currentSubStageCode: currentCode, version, gateResult: null, replayed: false, advanced: false });
      }
      if (path.includes('/ipd/stage/sub-stages/advance') && init?.method === 'POST') {
        currentCode = 'CONCEPT-01';
        version = 1;
        return envelope({ projectId: PROJECT_ID, currentStage: 'CONCEPT', currentSubStageCode: currentCode, version, gateResult: 'PASSED', replayed: false, advanced: true });
      }
      return base(input);
    });
    const wrapper = await mountFlow(fetcher as unknown as ReturnType<typeof stubFlowFetch>);
    await vi.waitFor(() => expect(wrapper.find('[data-testid="ipd-sub-stage-progress"]').text()).toContain('版本 0'));
    await wrapper.find('[data-testid="ipd-sub-stage-progress"] .ant-select-selector').trigger('mousedown');
    const option = [...document.body.querySelectorAll('.ant-select-item-option')]
      .find((item) => item.textContent?.includes('机会识别'));
    expect(option).toBeDefined();
    (option as HTMLElement).click();
    await flushPromises();
    const advanceButton = wrapper.findAll('button').find((button) => button.text().includes('确认推进小阶段'));
    expect(advanceButton).toBeDefined();
    expect(advanceButton!.attributes('disabled')).toBeUndefined();
    wrapper.getComponent(Popconfirm).vm.$emit('confirm');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="ipd-sub-stage-progress"]').text()).toContain('版本 1'));
    expect(wrapper.find('[data-testid="ipd-sub-stage-progress"]').text()).toContain('机会识别');
    expect(fetcher.mock.calls.some(([path, init]) =>
      String(path).includes(`/ipd/stage/sub-stages/advance?projectId=${PROJECT_ID}&targetSubStageCode=CONCEPT-01&expectedVersion=0`)
      && init?.method === 'POST')).toBe(true);
    wrapper.unmount();
  });
  it('首屏回归：阶段进度/动作表照常渲染，F8 未引入 instantiate 入口（GAP-B2 边界锁定）', async () => {
    const fetcher = stubFlowFetch();
    const wrapper = await mountFlow(fetcher);
    expect(wrapper.text()).toContain('阶段进度');
    expect(wrapper.text()).toContain('概念'); // CONCEPT 首阶段
    expect(wrapper.text()).toContain('阶段动作（全项目）');
    expect(wrapper.text()).not.toContain('实例化当前阶段'); // instantiate 归 B2，本页不得出现入口
    wrapper.unmount();
  });

  it('打开快照 Drawer → GET /sop-templates/instances?projectId= 19 位雪花逐字符 + 行渲染（tag 文案/模板 ID/版本）', async () => {
    const fetcher = stubFlowFetch();
    const wrapper = await mountFlow(fetcher);

    const btn = wrapper.findAll('button').find((b) => b.text().includes('项目 SOP 快照'));
    expect(btn).toBeDefined();
    await btn!.trigger('click');

    await vi.waitFor(() => expect(document.body.textContent).toContain('生效中'));
    const sopCall = fetcher.mock.calls.map((c) => String(c[0])).find((p) => p.includes('/sop-templates/instances'));
    // 19 位雪花 query 逐字符无损（Number 化即碎精度）
    expect(sopCall).toBe(`/api/v1/sop-templates/instances?projectId=${PROJECT_ID}`);
    const text = document.body.textContent ?? '';
    expect(text).toContain('生效中'); // ACTIVE → success 绿
    expect(text).toContain('已替代'); // SUPERSEDED → 灰
    expect(text).toContain('已归档'); // ARCHIVED → 红
    expect(text).toContain('2096266884054798338'); // 模板 ID 19 位逐字符（实例 ID 在展开行脚注，见下一用例）
    expect(text).toContain('2026-09-20T06:30:00.000+00:00'); // Date→ISO 串原样透传展示
    expect(text).toContain('900101');
    wrapper.unmount();
  });

  it('展开行快照兜底：合法 JSON pretty 展开、非法 JSON 原文展示不抛（BR-IPD-SOP-03）', async () => {
    const fetcher = stubFlowFetch();
    const wrapper = await mountFlow(fetcher);
    const btn = wrapper.findAll('button').find((b) => b.text().includes('项目 SOP 快照'));
    await btn!.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('生效中'));

    // 依次展开第 1/2 行：合法 JSON → pretty；非法 → 原文
    const expandIcons = Array.from(document.body.querySelectorAll('.ant-table-row-expand-icon'));
    expect(expandIcons.length).toBeGreaterThanOrEqual(2);
    (expandIcons[0] as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('"A1"'));
    (expandIcons[1] as HTMLElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('not-a-json{{{'));
    expect(document.body.textContent).toContain('快照不可变'); // 语义脚注
    expect(document.body.textContent).toContain('实例 2096266884247736321'); // 脚注实例 ID 19 位逐字符
    wrapper.unmount();
  });

  it('空快照项目 → Drawer 空态文案（不造假数据）', async () => {
    const fetcher = stubFlowFetch(() => envelope([]));
    const wrapper = await mountFlow(fetcher);
    const btn = wrapper.findAll('button').find((b) => b.text().includes('项目 SOP 快照'));
    await btn!.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('本项目尚无 SOP 实例快照'));
    wrapper.unmount();
  });

  it('负例：非项目成员 403 → Alert 透传后端 envelope message + 重试按钮（IDOR fail-closed 不吞错）', async () => {
    const fetcher = stubFlowFetch(() => envelope(null, 403, 30001, '无权查看该项目 SOP 快照'));
    const wrapper = await mountFlow(fetcher);
    const btn = wrapper.findAll('button').find((b) => b.text().includes('项目 SOP 快照'));
    await btn!.trigger('click');
    await vi.waitFor(() => expect(document.body.textContent).toContain('无权查看该项目 SOP 快照'));
    // antd Button 两字中文自动插空格（「重 试」），正则容错
    const retry = Array.from(document.body.querySelectorAll('button')).find((b) => /重\s*试/.test(b.textContent ?? ''));
    expect(retry).toBeDefined();
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// L2 每页 AI 入口（2026-09-28）：timeline.storyline（projectId 实体上下文驱动，userPrompt 可空）
// ──────────────────────────────────────────────────────────────────────────────

/** L2 AI 测试视图：非结构化场景（无卡）+ 非降级 → 纯文本 + 「采纳到表单」按钮。 */
const suggestView = (scene: string, markdown: string) => ({
  aiModel: 'mock-mini', card: null, completionTokens: 1, degraded: false,
  latencyMs: 5, markdown, promptTokens: 1, scene,
});

describe('L2 AI 入口（timeline.storyline）', () => {
  it('timeline.storyline：按钮存在、projectId 实体上下文触发、adopt 回传宿主（C08 零直写）', async () => {
    const suggestMock = vi.mocked(aiSuggest);
    suggestMock.mockReset();
    suggestMock.mockResolvedValue(suggestView('timeline.storyline', '## 时间线叙事\n- 概念阶段如期完成'));
    const calls: { method: string }[] = [];
    const base = stubFlowFetch();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: (init?.method ?? 'GET').toUpperCase() });
      return base(input);
    });
    const wrapper = await mountFlow(fetcher as unknown as ReturnType<typeof stubFlowFetch>);

    // ① 按钮存在（projectId 驱动，无素材输入框）
    const runBtn = wrapper.find('[data-testid="pd-flow-ai-storyline"] [data-testid="ai-suggest-run"]');
    expect(runBtn.exists()).toBe(true);
    expect(runBtn.text()).toContain('AI 时间线叙事');
    expect(wrapper.find('[data-testid="pd-flow-ai-storyline"] [data-testid="ai-suggest-prompt"]').exists()).toBe(false);

    // ② 触发 scene 正确（projectId 19 位雪花逐字符透传，userPrompt 可空）
    await runBtn.trigger('click');
    await vi.waitFor(() => expect(suggestMock).toHaveBeenCalledWith(
      'timeline.storyline',
      expect.objectContaining({ projectId: PROJECT_ID }),
    ));

    // ③ adopt 回传宿主（仅本地提示，不写库）
    await wrapper.get('[data-testid="pd-flow-ai-storyline"] [data-testid="ai-suggest-adopt"]').trigger('click');
    const ack = wrapper.find('[data-testid="pd-flow-ai-adopted"]');
    expect(ack.exists()).toBe(true);
    expect(ack.text()).toContain('已回传宿主');
    expect(ack.text()).toContain('timeline.storyline');
    expect(ack.text()).toContain('不写库');
    // C08 零直写：挂载 + AI 链路全部为 GET（阶段动作/快照等只读端点）
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 阶段清单接线（R139 派单#4 / P3-6.1 契约）：GET /projects/{id}/stages 服务端数据源 + STAGE_ORDER 回退
// ──────────────────────────────────────────────────────────────────────────────

/** 六阶段服务端 fixture：故意乱序 + 自定义 stageName，验证 sortOrder 归位与 name 透传。 */
const stagesFixtureOutOfOrder = [
  { id: '2096266885000000003', name: '开发', code: 'DEV', status: null, sortOrder: 3 },
  { id: '2096266885000000001', name: '概念', code: 'CONCEPT', status: null, sortOrder: 1 },
  { id: '2096262688500000006'.slice(0, 19), name: '生命周期管理', code: 'LIFECYCLE', status: null, sortOrder: 6 },
  { id: '2096266885000000002', name: '计划', code: 'PLAN', status: null, sortOrder: 2 },
  { id: '2096266885000000005', name: '发布', code: 'LAUNCH', status: null, sortOrder: 5 },
  { id: '2096266885000000004', name: '验证', code: 'VALID', status: null, sortOrder: 4 },
];

describe('阶段清单 GET /projects/{id}/stages（P3-6.1 接线）', () => {
  it('挂载即请求 /api/v1/projects/{19位雪花}/stages（路径逐字符无损，GET 只读）', async () => {
    const fetcher = stubFlowFetch();
    const wrapper = await mountFlow(fetcher);
    const stagesCall = fetcher.mock.calls
      .map((c) => String(c[0]))
      .find((p) => p.endsWith(`/api/v1/projects/${PROJECT_ID}/stages`));
    expect(stagesCall).toBeDefined();
    wrapper.unmount();
  });

  it('server stages 驱动渲染：title 取服务端 stageName，乱序 fixture 按 sortOrder 归位', async () => {
    const fetcher = stubFlowFetch(undefined, () => envelope({ stages: stagesFixtureOutOfOrder }));
    const wrapper = await mountFlow(fetcher);
    await vi.waitFor(() => expect(wrapper.text()).toContain('生命周期管理')); // 自定义服务端名透传
    const titles = wrapper.findAll('.ant-steps-item-title').map((n) => n.text());
    expect(titles).toEqual(['概念', '计划', '开发', '验证', '发布', '生命周期管理']);
    wrapper.unmount();
  });

  it('stages 端点异常（500）→ 回退 STAGE_ORDER 六阶段骨架，页面不断链', async () => {
    const fetcher = stubFlowFetch(undefined, () => envelope(null, 500, 50000, '阶段服务暂不可用'));
    const wrapper = await mountFlow(fetcher);
    await vi.waitFor(() => expect(wrapper.text()).toContain('阶段动作（全项目）'));
    const titles = wrapper.findAll('.ant-steps-item-title').map((n) => n.text());
    expect(titles).toEqual(['概念', '计划', '开发', '验证', '发布', '生命周期']);
    wrapper.unmount();
  });
});
