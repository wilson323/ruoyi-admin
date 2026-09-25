/**
 * 页11 项目详情-IPD 流程（flow.vue）「项目 SOP 快照」Drawer（R215 GAP-F8）：
 * - 首屏回归：阶段进度/动作表既有功能不因 F8 追加回归；
 * - 快照入口 → Drawer 打开 + GET /sop-templates/instances?projectId=<路由 19 位雪花逐字符>；
 * - 实例表渲染：状态 tag 三色文案（生效中/已替代/已归档）、模板 ID 19 位逐字符、实例化人/时间透传；
 * - 展开行快照兜底：合法 JSON pretty 展开、非法 JSON 原文展示不抛（BR-IPD-SOP-03 不可变快照）；
 * - 空态与负例：无快照 → 空态文案；非项目成员 403 → Alert 透传后端 envelope message（E2E-B 契约）。
 * 注：instantiate 归 GAP-B2 等 owner 拍板，本页无实例化按钮（断言锁定防回流）。
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import FlowTab from './flow.vue';

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

/** fetch 分发 stub：project 详情 / stage-actions / gate-checklist / sop instances 四口径。 */
function stubFlowFetch(sopResponder?: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/gate-checklist')) return envelope(checklistFixture);
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
