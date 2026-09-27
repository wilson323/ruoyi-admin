/**
 * 站内待办 + AI 任务直达抽屉测试（R232 P2-04）：
 * - 待办语义：收件箱只取 kind=ACTION（FYI 知会不进待办）；
 * - 直达链路：AI 任务行单查 → 深链落 AI 审批卡（跨设备不靠会话回放，notification_events+ai_agent_tasks 均持久化）；
 * - fail 并存路径：非 AI 行 / 单查失败 → 回退 actionUrl「手动找」（/projects/{id} 归一项目概览），不卡死；
 * - 任务时间线：按项目列表渲染 TaskCard 卡片组（状态到 result_summary 粒度）；
 * - C08：直达仅路由跳转，抽屉内零写请求。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { defineComponent } from 'vue';

import type { IpdNotification } from '../../../../api/ipd/notification';
import AiTaskTodoDrawer from './ai-task-todo-drawer.vue';

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-27T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });

const Dummy = defineComponent({ render: () => null });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/workbench', component: Dummy },
      { path: '/ipd/ai-assistant', component: Dummy },
      { path: '/ipd/projects/:projectId/overview', component: Dummy },
    ],
  });
}

const notifFixture: IpdNotification[] = [
  {
    id: 'n-1', kind: 'ACTION', title: 'AI 草稿待审', content: 'G1 要素判定草稿已生成',
    actionUrl: '/projects/200', eventType: 'AI_PREPARED_GENERATE', sourceType: 'ai_agent_task',
    sourceId: '2104', readFlag: '0', readAt: null, createTime: '2026-09-27 10:00:00', deliveryStatus: 'SENT',
  },
  {
    id: 'n-2', kind: 'ACTION', title: 'AI 进度知会', content: '任务执行中',
    actionUrl: '/projects/200', eventType: 'AI_PREPARED_GATE', sourceType: 'ai_agent_task',
    sourceId: '2105', readFlag: '0', readAt: null, createTime: '2026-09-27 10:01:00', deliveryStatus: 'SENT',
  },
  {
    id: 'n-3', kind: 'ACTION', title: '普通业务待办', content: '请补交付物',
    actionUrl: '/projects/200', eventType: 'DELIVERABLE_DUE', sourceType: null,
    sourceId: null, readFlag: '1', readAt: '2026-09-27 10:02:00', createTime: '2026-09-27 09:00:00', deliveryStatus: 'SENT',
  },
  {
    id: 'n-4', kind: 'FYI', title: 'FYI 知会不应进待办', content: '跨组知会',
    actionUrl: '/projects/200', eventType: 'AI_PREPARED_GENERATE', sourceType: 'ai_agent_task',
    sourceId: '2104', readFlag: '0', readAt: null, createTime: '2026-09-27 10:03:00', deliveryStatus: 'SENT',
  },
];

const taskWithDoc = {
  id: '2104', projectId: '200', actionCode: 'C11', stageActionId: '300', triggerType: 'PASSIVE',
  execMode: 'HUMAN_GATE', status: 'SUCCEEDED', attempt: 1, resultSummary: 'G1 备料完成：要素判定草稿 7/7 已生成',
  aiDocId: '9001', errorMsg: null, triggeredBy: '9001', createTime: 1_758_000_000_000, updateTime: null,
};
const taskNoDoc = { ...taskWithDoc, id: '2105', status: 'RUNNING', aiDocId: null, resultSummary: '执行中' };

let calls: string[] = [];

/** 按路径分流的 fetch stub：收件箱 / 列表 / 单查三分支（记录调用面供断言）。 */
function routingFetcher(opts: { failSingleQuery?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://ipd.local');
    calls.push(url.pathname + url.search);
    if (url.pathname === '/api/v1/notifications') return envelope(notifFixture);
    if (url.pathname === '/api/v1/ai-agent-tasks') return envelope([taskWithDoc, taskNoDoc]);
    if (/^\/api\/v1\/ai-agent-tasks\/\d+$/.test(url.pathname)) {
      if (opts.failSingleQuery) throw new Error('single-query boom');
      return envelope(url.pathname.endsWith('2105') ? taskNoDoc : taskWithDoc);
    }
    return envelope(null);
  });
}

async function mountDrawer(props: { open: boolean; projectId?: string }, fetcher: ReturnType<typeof routingFetcher>) {
  vi.stubGlobal('fetch', fetcher);
  const router = makeRouter();
  router.push('/ipd/workbench');
  await router.isReady();
  const wrapper = mount(AiTaskTodoDrawer, {
    props,
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { router, wrapper };
}

function bodyQuery<T extends Element = HTMLElement>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}
function bodyQueryAll<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector));
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('R232 P2-04 站内待办抽屉（NotificationService 载荷复用）', () => {
  it('打开即加载：待办只取 kind=ACTION（FYI 不进）+ 任务时间线卡片组 + BR-AI-04 Alert + 并存路径提示', async () => {
    const { wrapper } = await mountDrawer({ open: true, projectId: '200' }, routingFetcher());
    expect(bodyQuery('[data-testid="ai-card-alert"]')).toBeTruthy();
    const rows = bodyQueryAll('[data-testid="ai-task-todo-list"] li');
    expect(rows).toHaveLength(3);
    expect(document.body.textContent ?? '').not.toContain('FYI 知会不应进待办');
    // AI 任务行有「手动找并存路径」提示（fail 口径前置可见，不藏）
    expect(document.body.textContent ?? '').toContain('/ipd/projects/200/overview');
    const cards = bodyQueryAll('[data-testid="ai-task-timeline"] [data-testid="ai-task-card"]');
    expect(cards).toHaveLength(2);
    expect(document.body.textContent ?? '').toContain('G1 备料完成');
    expect(wrapper.emitted('update:open')).toBeFalsy();
  });

  it('AI 任务待办直达审批卡：单查 → 深链带 docId（跨设备不靠会话回放）', async () => {
    const { router, wrapper } = await mountDrawer({ open: true }, routingFetcher());
    bodyQueryAll<HTMLButtonElement>('[data-testid="ai-todo-direct-link"]')[0]!.click();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/ipd/ai-assistant?projectId=200&docId=9001');
    expect(calls).toContain('/api/v1/ai-agent-tasks/2104');
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('非 AI 待办回退 actionUrl 手动找并存路径（/projects/{id} 归一项目概览），零任务单查', async () => {
    const { router } = await mountDrawer({ open: true }, routingFetcher());
    bodyQueryAll<HTMLButtonElement>('[data-testid="ai-todo-direct-link"]')[2]!.click();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/ipd/projects/200/overview');
    expect(calls.filter((c) => /^\/api\/v1\/ai-agent-tasks\/\d+/.test(c))).toHaveLength(0);
  });

  it('单查失败回退 actionUrl（fail 并存路径，不卡死弹层）', async () => {
    const { router } = await mountDrawer({ open: true }, routingFetcher({ failSingleQuery: true }));
    bodyQueryAll<HTMLButtonElement>('[data-testid="ai-todo-direct-link"]')[0]!.click();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/ipd/projects/200/overview');
  });

  it('任务卡「直达审批卡」：时间线卡片深链（C08 仅路由跳转，零写请求）', async () => {
    const fetcher = routingFetcher();
    const { router } = await mountDrawer({ open: true, projectId: '200' }, fetcher);
    bodyQueryAll<HTMLButtonElement>('[data-testid="ai-task-open-review"]')[0]!.click();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/ipd/ai-assistant?projectId=200&docId=9001');
    const writeCalls = fetcher.mock.calls.filter((call) => {
      const init = (call as unknown[])[1] as RequestInit | undefined;
      return (init?.method ?? 'GET') !== 'GET';
    });
    expect(writeCalls).toHaveLength(0);
  });
});
