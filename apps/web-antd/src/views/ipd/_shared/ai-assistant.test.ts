/**
 * AI 副驾 done 帧卡片分发渲染测试（R232 批次7 P2-02 重放）。
 *
 * 16 用例：① fillPayload 广播逐字段零回归（既有行为）② 4 卡事件到达（每类卡片 done 帧
 * 渲染出对应组件 + ipd:ai-card 广播）③ 双事件并行（fillPayload 与 ipd:ai-card 互不覆盖）
 * ④ 非法信封零渲染不断对话（缺键/未知 type/version 不符 → ipd-ai-card-notice，后续消息
 * 继续处理）⑤ 渲染抛错降级（组件 render 抛错 → ipd-ai-card-degraded，对话不断）
 * ⑥ confirm 按钮零直写（C08 铁律：点击后无任何 fetch/写调用）⑦ 新轮清卡片态
 * ⑧ done 帧无 card 不渲染不报错（card 缺席 / card:null 原样透传）
 * ⑨ R2 铁律：schema 外字段四层丢弃留痕（card./data./data.<arr>[i]./sourceRefs.）
 * ⑩ C08 mode 防御：mode 非链路输入同口径丢弃（与无 mode 派发全等），fillPayload.mode 恒 suggest
 * ⑪ R3 铁律：卡片数值与 sourceRefs 对账不平 → 拒出卡降级纯文本（对账负向矩阵）
 * ⑫ BR-AI-04：4 卡头部风险 Alert 无一豁免
 * ⑬ C08 敏感值：金额/评分/系数/删除/移交只进「建议值」区，confirm 零写请求零提交指令
 * ⑭ 禁 v-html：恶意标记转义直显 + 副驾/4 卡渲染源码零 v-html/innerHTML
 * ⑮ 放大工作界面：expand → 全屏双栏（左对话 / 右展示），collapse 还原侧栏
 * ⑯ 放大模式右侧展示卡片：card-host 进 showcase-col，对话流保留文本，还原零状态丢失。
 *
 * 信封守卫复用 api/ipd/ai-copilot 真实 parseStreamDone（mock 只替身 streamCopilot；
 * 防双轨红线：isCardEnvelope/parseCardEnvelope 校验逻辑零复制）。R2/R3 过检在
 * ai-assistant.vue 卡片过检层（satisfies schema 镜像零复制）。SSE 传输面（帧解析/
 * fetch）不在本文件测（ai-copilot.test.ts 已覆盖），此处直接驱动 handler 面。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CopilotStreamDone,
  CopilotStreamHandlers,
} from '../../../api/ipd/ai-copilot';
import { streamCopilot } from '../../../api/ipd/ai-copilot';
import { listAiDocumentVersions } from '../../../api/ipd/ai-document';
import { fetchGuideEvents } from '../../../api/ipd/guide-script';
import type { AgentRunEvent } from '../../../api/ipd/project-agent';
import {
  cancelAgentRun,
  createProjectAgentRun,
  fetchAgentRun,
  fetchAgentRunEvents,
  fetchProjectAgentCapabilities,
  listProjectAgentRuns,
} from '../../../api/ipd/project-agent';
import { fetchSubStages } from '../../../api/ipd/stage-sub-stages';
import AiAssistant from './ai-assistant.vue';
import type { AiCardEnvelope } from './ai-cards/types';
import { useIpdAiWorkspace } from './ai-workspace/use-ai-workspace';

vi.mock('../../../api/ipd/ai-copilot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/ipd/ai-copilot')>();
  return { ...actual, streamCopilot: vi.fn() };
});
vi.mock('../../../api/ipd/guide-script', () => ({ fetchGuideEvents: vi.fn() }));
vi.mock('../../../api/ipd/project', () => ({
  listProjects: vi.fn(async () => [
    { id: 'P-1', name: '示例项目', code: 'P-1' },
    { id: 'P-2', name: '另一项目', code: 'P-2' },
  ]),
}));
vi.mock('../../../api/ipd/stage-sub-stages', () => ({ fetchSubStages: vi.fn() }));
vi.mock('../../../api/ipd/project-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/ipd/project-agent')>()),
  cancelAgentRun: vi.fn(),
  createProjectAgentRun: vi.fn(),
  fetchAgentRun: vi.fn(),
  fetchAgentRunEvents: vi.fn(),
  fetchProjectAgentCapabilities: vi.fn(),
  listProjectAgentRuns: vi.fn(),
  saveAiFeedback: vi.fn(),
}));
vi.mock('../../../api/ipd/ai-document', () => ({
  listAiDocumentVersions: vi.fn(),
  rejectAiDocumentVersion: vi.fn(),
  reviewAiDocumentVersion: vi.fn(),
}));
vi.mock('../../../api/ipd/project-agent-agui', () => ({
  /** 组件级集成测试无 pinia 载体；会话属主固定，与 use-project-agent-run.test.ts 同口径。 */
  projectAgentSessionOwner: () => 'person-1',
  /**
   * AG-UI 流只重放已持久化的 ipd_event 投影，与 fetchAgentRunEvents 同源，故直接委托后者。
   * 夹具以 terminal:true 声明运行已终结时补齐后端 ProjectAgentRunHandle 必写的末帧；缺末帧
   * 时消费方按「连接已断开」计入重连，等于把正常收口当成传输故障，掩盖真实契约。
   */
  streamAgentRunEvents: vi.fn(async (
    runId: string,
    afterSeq: number,
    onEvent: (event: AgentRunEvent) => boolean,
  ) => {
    const page = await fetchAgentRunEvents(runId, afterSeq);
    const events = page?.events ?? [];
    for (const event of events) if (onEvent(event)) return;
    if (page?.terminal === true && !events.some((e) => e.type === 'ERROR' || e.type === 'RUN_FINISHED')) {
      onEvent({ seq: page.nextSeq, type: 'RUN_FINISHED', payload: { status: 'SUCCEEDED' }, createdAt: '2026-01-01T00:00:09Z' });
    }
  }),
}));

/** 单包单模型：面板自动选中，主发送可走 createProjectAgentRun。 */
const AGENT_CAPS = {
  packs: [
    {
      code: 'ipd.market',
      version: '1.2.0',
      name: '市场分析',
      description: '',
      stages: [],
      actionCodes: [],
      available: true,
      unavailableReason: null,
      skills: [{ name: 'swot', version: '1', sha256: 's', available: true, reason: null }],
      tools: [{ id: '0007', name: '检索', readOnly: true, available: true, reason: null }],
    },
  ],
  models: [{ id: '0012', name: '通用模型', available: true, reason: null }],
};

/** sourceRefs 构造（信封值面 number|string|string[]，测试引用 id 集用 number[] 表达后收窄断言）。 */
function sourceRefsOf(refs: Record<string, unknown>): AiCardEnvelope['sourceRefs'] {
  return refs as AiCardEnvelope['sourceRefs'];
}

/** gate.precheck 合法信封（四键齐 + data 对齐 types.ts；sourceRefs 对齐 Catalog 清单且 R3 对账平）。 */
const precheckEnvelope: AiCardEnvelope = {
  type: 'gate.precheck',
  version: 1,
  data: {
    gateCode: 'G1-TR',
    round: 1,
    reviewCount: 1,
    totalElements: 1,
    items: [
      { elementId: 101, result: 'PASS', conditionNote: '材料齐备', evidenceRef: 'EV-1', leftoverStatus: 'NONE' },
    ],
  },
  sourceRefs: sourceRefsOf({ gateId: 1, reviewIds: [91], elementResultIds: [501] }),
};

/** gate.conclusion 合法信封（reviews 1↔reviewIds 1；票数和 1↔elementResultIds 1）。 */
const conclusionEnvelope: AiCardEnvelope = {
  type: 'gate.conclusion',
  version: 1,
  data: {
    gateCode: 'G1-TR',
    reviews: [{ reviewerType: 'MARKET_PM', decision: 'APPROVE', opinion: '材料齐备', round: 1 }],
    passCount: 1,
    conditionalCount: 0,
    failCount: 0,
  },
  sourceRefs: sourceRefsOf({ gateId: 1, reviewIds: [91], elementResultIds: [501] }),
};

/** project.charter 合法信封（contextProjectId↔projectId）。 */
const charterEnvelope: AiCardEnvelope = {
  type: 'project.charter',
  version: 1,
  data: {
    contextProjectId: 1001,
    contextProjectCode: 'P-2026-01',
    contextProjectName: '扫地机器人',
    contextCurrentStage: 'G1',
    contextProductId: 2002,
  },
  sourceRefs: sourceRefsOf({ projectId: 1001 }),
};

/** demand.draft 合法信封（requirements 1↔requirementIds 1，requirementId 201∈[201]）。 */
const draftEnvelope: AiCardEnvelope = {
  type: 'demand.draft',
  version: 1,
  data: {
    contextProjectId: 1001,
    contextProjectCode: 'P-2026-01',
    contextProjectName: '扫地机器人',
    requirements: [{ requirementId: 201, title: '拖布自清洁', status: 'OPEN', source: 'REQ' }],
  },
  sourceRefs: sourceRefsOf({ projectId: 1001, requirementIds: [201] }),
};

/** 4 卡 → 卡组件根 testid 对照（与 card-components.test.ts 同构）。 */
const CARD_CASES = [
  { envelope: precheckEnvelope, root: 'ai-card-gate-precheck' },
  { envelope: conclusionEnvelope, root: 'ai-card-gate-conclusion' },
  { envelope: charterEnvelope, root: 'ai-card-project-charter' },
  { envelope: draftEnvelope, root: 'ai-card-demand-draft' },
];

/** 渲染抛错样本：items 含 null 行，模板读 item.elementId 抛错（模拟卡片 render 异常；
 *  sourceRefs/计数过 R3 对账，保证走到渲染崩溃路径而非拒出卡）。 */
const crashEnvelope = {
  type: 'gate.precheck',
  version: 1,
  data: { gateCode: 'G1', round: 1, reviewCount: 1, totalElements: 1, items: [null] },
  sourceRefs: sourceRefsOf({ gateId: 1, reviewIds: [91], elementResultIds: [501] }),
} as unknown as AiCardEnvelope;

/** R2 脏信封样本：四层均混入 schema 外字段（card./data./data.items[0]./sourceRefs.）。 */
const dirtyEnvelope = {
  type: 'gate.precheck',
  version: 1,
  data: {
    gateCode: 'G1-TR',
    round: 1,
    reviewCount: 1,
    totalElements: 1,
    items: [
      {
        elementId: 101,
        result: 'PASS',
        conditionNote: '材料齐备',
        evidenceRef: 'EV-1',
        leftoverStatus: 'NONE',
        hackedRowField: 'drop-row',
      },
    ],
    extraDataField: 'drop-data',
  },
  sourceRefs: sourceRefsOf({
    gateId: 1,
    reviewIds: [91],
    elementResultIds: [501],
    evilRef: 'drop-refs',
  }),
  extraEnvelopeField: 'drop-card',
} as unknown as AiCardEnvelope;

/** C08 mode 样本：data 混入 mode（非链路输入，R2 同口径丢弃，与无 mode 全等）。 */
const withModeEnvelope = {
  ...precheckEnvelope,
  data: { ...(precheckEnvelope.data as unknown as Record<string, unknown>), mode: 'auto' },
} as unknown as AiCardEnvelope;

/** C08 敏感值样本：金额/评分/系数/删除/移交只作为展示文案（建议值区）出现在需求建议行。 */
const sensitiveEnvelope: AiCardEnvelope = {
  type: 'demand.draft',
  version: 1,
  data: {
    contextProjectId: 1001,
    contextProjectCode: 'P-2026-01',
    contextProjectName: '扫地机器人',
    requirements: [
      {
        requirementId: 201,
        title: '预算金额 5000 元、评分 4.5、系数 1.2，拟删除/移交至备用池',
        status: 'OPEN',
        source: 'REQ',
      },
    ],
  },
  sourceRefs: sourceRefsOf({ projectId: 1001, requirementIds: [201] }),
};

/** 注入样本：字段值/增量文本混入 HTML 标记（禁 v-html，插值转义直显）。 */
const xssEnvelope = {
  type: 'gate.precheck',
  version: 1,
  data: {
    gateCode: '<b>bold-gate</b>',
    round: 1,
    reviewCount: 1,
    totalElements: 1,
    items: [
      {
        elementId: 101,
        result: 'PASS',
        conditionNote: '<script>window.__xss=1</script>',
        evidenceRef: 'EV-1',
        leftoverStatus: 'NONE',
      },
    ],
  },
  sourceRefs: sourceRefsOf({ gateId: 1, reviewIds: [91], elementResultIds: [501] }),
} as unknown as AiCardEnvelope;

/** fillPayload 样本（R221 契约：fields/mode/scene 三键）。 */
const fillPayload = {
  fields: { owner: '张三', planDate: '2026-10-01' },
  mode: 'suggest' as const,
  scene: 'stage-action-fields',
};

/** done 帧样本（P2-01 可选超集：card/fillPayload 键缺席时与旧契约一致）。 */
function doneWith(over: Record<string, unknown> = {}): CopilotStreamDone {
  return {
    latencyMs: 12,
    status: 'OK',
    tokenCompletion: 5,
    tokenPrompt: 30,
    ...over,
  } as CopilotStreamDone;
}

/** streamCopilot 替身捕获的逐轮 handler（用例直接驱动 delta/done，SSE 传输不在本文件测）。 */
let streamCalls: Array<{ handlers: CopilotStreamHandlers; message: string; projectId?: string }>;
/** window 事件捕获（ipd:ai-fill-payload / ipd:ai-card），逐用例清场防串态。 */
let trackedEvents: Array<{ listener: (event: Event) => void; type: string }>;
let assistantWrapper: null | VueWrapper;

beforeEach(() => {
  streamCalls = [];
  trackedEvents = [];
  assistantWrapper = null;
  window.localStorage.clear();
  // agui 传输默认 restoreSession=true，会按 sessionKey 复原上次运行；不清理即跨用例污染。
  window.sessionStorage.clear();
  useIpdAiWorkspace().setMode('classic');
  useIpdAiWorkspace().setPane('cards');
  vi.mocked(fetchGuideEvents).mockReset();
  vi.mocked(fetchSubStages).mockReset();
  vi.mocked(streamCopilot).mockReset();
  vi.mocked(streamCopilot).mockImplementation(async (input, handlers) => {
    streamCalls.push({ handlers, message: input.message, projectId: input.projectId });
  });
  vi.mocked(fetchProjectAgentCapabilities).mockReset();
  vi.mocked(cancelAgentRun).mockReset();
  vi.mocked(createProjectAgentRun).mockReset();
  vi.mocked(fetchAgentRun).mockReset();
  vi.mocked(fetchAgentRunEvents).mockReset();
  vi.mocked(fetchProjectAgentCapabilities).mockResolvedValue(AGENT_CAPS);
  vi.mocked(cancelAgentRun).mockResolvedValue({ runId: 'run-1', status: 'CANCEL_REQUESTED' });
  vi.mocked(createProjectAgentRun).mockResolvedValue({ runId: 'run-1', status: 'PENDING' });
  vi.mocked(fetchAgentRunEvents).mockResolvedValue({ events: [], nextSeq: 0, terminal: false });
  vi.mocked(listProjectAgentRuns).mockResolvedValue([]);
  vi.mocked(listAiDocumentVersions).mockReset();
  vi.mocked(listAiDocumentVersions).mockResolvedValue([]);
  vi.mocked(fetchAgentRun).mockResolvedValue({
    runId: 'run-1',
    projectId: 'P-1',
    agentId: 'a-1',
    status: 'PENDING',
    actionCode: null,
    configSnapshot: {
      capabilityPackCode: 'ipd.market',
      capabilityPackVersion: '1.2.0',
      modelConfigId: '0012',
      skills: [],
      toolIds: [],
    },
    errorCode: null,
    createdAt: 'x',
    finishedAt: null,
  });
});

afterEach(() => {
  assistantWrapper?.unmount();
  for (const tracked of trackedEvents) {
    window.removeEventListener(tracked.type, tracked.listener);
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 捕获 window 广播事件（ipd:ai-fill-payload / ipd:ai-card）。 */
function trackEvents(type: string): CustomEvent[] {
  const events: CustomEvent[] = [];
  const listener = (event: Event) => events.push(event as CustomEvent);
  window.addEventListener(type, listener);
  trackedEvents.push({ listener, type });
  return events;
}

function bodyQuery<T extends Element = HTMLElement>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

/** 挂载助手并打开抽屉（Drawer getContainer=body 传送，按仓内惯例 attachTo + body 查询）。 */
async function mountAssistant(
  props: { projectCurrentStage?: string; stages?: Array<{ code: string; name: string }> } = {},
  options: { router?: ReturnType<typeof createRouter> } = {},
) {
  document.body.innerHTML = '';
  assistantWrapper = mount(AiAssistant, {
    attachTo: document.body,
    global: options.router ? { plugins: [options.router] } : undefined,
    props,
  });
  if (useIpdAiWorkspace().mode.value === 'classic') {
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-fab"]')!.click();
  }
  await flushPromises();
}

/** 输入 + 发送一轮（vc-input onInput 驱动 v-model，button.click 走 @click）。 */
async function sendText(text: string) {
  const input = bodyQuery<HTMLInputElement>('[data-testid="ipd-ai-input"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
  bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-send"]')!.click();
  await flushPromises();
}

/** 最近一轮 streamCopilot 替身 handler。 */
function lastHandlers(): CopilotStreamHandlers {
  return streamCalls.at(-1)!.handlers;
}

describe('AI 副驾 done 帧卡片分发渲染（P2-02）', () => {
  it('① fillPayload 广播逐字段零回归：done 帧 fillPayload 原样广播 ipd:ai-fill-payload', async () => {
    await mountAssistant();
    const fillEvents = trackEvents('ipd:ai-fill-payload');
    const cardEvents = trackEvents('ipd:ai-card');

    await sendText('帮我填 C08 表单');
    lastHandlers().onDelta('好的，已为你准备字段建议');
    lastHandlers().onDone(doneWith({ fillPayload }));
    await flushPromises();

    expect(fillEvents).toHaveLength(1);
    const detail = fillEvents[0]!.detail;
    expect(detail).toEqual(fillPayload);
    expect(detail.scene).toBe('stage-action-fields');
    expect(detail.mode).toBe('suggest');
    expect(detail.fields).toEqual({ owner: '张三', planDate: '2026-10-01' });
    expect(detail.fields.owner).toBe('张三');
    // 既有行为零回归：对话文本照常渲染；未携 card 不进卡不降级不提示
    expect(document.body.textContent ?? '').toContain('好的，已为你准备字段建议');
    expect(cardEvents).toHaveLength(0);
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
  });

  it('② 4 卡事件到达：每类卡片 done 帧渲染出对应组件 + ipd:ai-card 广播（容器 ipd-ai-card-host）', async () => {
    const cardEvents = trackEvents('ipd:ai-card');
    for (const cardCase of CARD_CASES) {
      await mountAssistant();
      await sendText('出一张结构化卡片');
      lastHandlers().onDelta('已生成结构化建议');
      lastHandlers().onDone(doneWith({ card: cardCase.envelope }));
      await flushPromises();

      const eventsForCase = cardEvents.filter(
        (event) => event.detail.type === cardCase.envelope.type,
      );
      expect(eventsForCase, cardCase.root).toHaveLength(1);
      expect(eventsForCase[0]!.detail, cardCase.root).toEqual(cardCase.envelope);
      expect(
        bodyQuery(`[data-testid="ipd-ai-card-host"] [data-testid="${cardCase.root}"]`),
        cardCase.root,
      ).toBeTruthy();
      expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]'), cardCase.root).toBeNull();
      expect(bodyQuery('[data-testid="ipd-ai-card-notice"]'), cardCase.root).toBeNull();
    }
  });

  it('③ 双事件并行：fillPayload 与 ipd:ai-card 同帧广播互不覆盖', async () => {
    await mountAssistant();
    const fillEvents = trackEvents('ipd:ai-fill-payload');
    const cardEvents = trackEvents('ipd:ai-card');

    await sendText('既填表又出卡');
    lastHandlers().onDone(doneWith({ card: precheckEnvelope, fillPayload }));
    await flushPromises();

    expect(fillEvents).toHaveLength(1);
    expect(cardEvents).toHaveLength(1);
    // 各自载荷原样、互不覆盖（fill 无卡信封键、card 无填表键）
    expect(fillEvents[0]!.detail).toEqual(fillPayload);
    expect(fillEvents[0]!.detail).not.toHaveProperty('type');
    expect(cardEvents[0]!.detail).toEqual(precheckEnvelope);
    expect(cardEvents[0]!.detail).not.toHaveProperty('fillPayload');
    // 卡片照常分发渲染
    expect(
      bodyQuery('[data-testid="ipd-ai-card-host"] [data-testid="ai-card-gate-precheck"]'),
    ).toBeTruthy();
  });

  it('④ 非法信封零渲染不断对话：缺键/未知 type/version 不符 → ipd-ai-card-notice，后续消息继续处理', async () => {
    const cardEvents = trackEvents('ipd:ai-card');
    const illegalCases: Array<{ envelope: unknown; name: string }> = [
      {
        name: '缺 sourceRefs 键',
        envelope: { type: 'gate.precheck', version: 1, data: { gateCode: 'G1' } },
      },
      { name: '缺 data/sourceRefs 键', envelope: { type: 'gate.precheck', version: 1 } },
      {
        name: '未知 type',
        envelope: { type: 'unknown.card', version: 1, data: {}, sourceRefs: {} },
      },
      { name: 'version 不符', envelope: { ...precheckEnvelope, version: 99 } },
      { name: 'card 非对象', envelope: 'garbage' },
    ];

    for (const illegal of illegalCases) {
      const callsBefore = streamCalls.length;
      await mountAssistant();
      await sendText('来一张卡');
      lastHandlers().onDone(doneWith({ card: illegal.envelope }));
      await flushPromises();

      expect(bodyQuery('[data-testid="ipd-ai-card-host"]'), illegal.name).toBeNull();
      expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]'), illegal.name).toBeNull();
      const notice = bodyQuery('[data-testid="ipd-ai-card-notice"]');
      expect(notice, illegal.name).toBeTruthy();
      expect(notice!.textContent ?? '', illegal.name).toContain('对话继续');
      // 非法信封零广播（合法卡片才广播）
      // 后续消息继续处理：新轮照常应答（不断对话流）
      await sendText('继续聊');
      lastHandlers().onDelta('后续回答正常');
      lastHandlers().onDone(doneWith({}));
      await flushPromises();
      expect(document.body.textContent ?? '', illegal.name).toContain('后续回答正常');
      expect(streamCalls.length - callsBefore, illegal.name).toBe(2);
    }
    expect(cardEvents).toHaveLength(0);
  });

  it('⑤ 渲染抛错降级：卡片组件 render 抛错 → ipd-ai-card-degraded，对话不断', async () => {
    await mountAssistant();
    await sendText('出一张会崩的卡');
    lastHandlers().onDelta('这轮卡片渲染异常');
    lastHandlers().onDone(doneWith({ card: crashEnvelope }));
    await flushPromises();
    await flushPromises();

    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeNull();
    const degraded = bodyQuery('[data-testid="ipd-ai-card-degraded"]');
    expect(degraded).toBeTruthy();
    expect(degraded!.textContent ?? '').toContain('渲染异常');
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
    // 对话不断：文本照常渲染，新消息继续处理
    expect(document.body.textContent ?? '').toContain('这轮卡片渲染异常');
    await sendText('继续');
    lastHandlers().onDelta('降级后对话继续');
    await flushPromises();
    expect(document.body.textContent ?? '').toContain('降级后对话继续');
  });

  it('⑥ confirm 按钮零直写：点击后无任何 fetch/写调用（C08 铁律：卡片层零直写）', async () => {
    const fetcher = vi.fn<(url: string, init?: unknown) => Promise<Response>>(
      async () => new Response('{}'),
    );
    vi.stubGlobal('fetch', fetcher);
    await mountAssistant();
    await sendText('出一张卡');
    lastHandlers().onDone(doneWith({ card: precheckEnvelope }));
    await flushPromises();

    bodyQuery<HTMLButtonElement>('[data-testid="ai-card-confirm"]')!.click();
    await flushPromises();

    // 零直写（C08）：confirm 不触发任何 /api/v1 请求（一切写端点必经 /api/v1）、
    // 不触发 CopilotKit run，也不多发一轮对话。CopilotKitProvider 的 runtime 只读
    // 探测（GET /info / POST {method:"info"}，契约 §6 探针①）非写调用，不计入。
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/api/v1')),
    ).toEqual([]);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/agent/')),
    ).toEqual([]);
    expect(streamCalls).toHaveLength(1);
    // 卡片仍在、未误降级（confirm 只收组件 emit，无副作用）
    expect(
      bodyQuery('[data-testid="ipd-ai-card-host"] [data-testid="ai-card-gate-precheck"]'),
    ).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
  });

  it('⑦ 新轮清卡片态：新消息开启新轮 / 新会话均清上一轮卡片渲染态', async () => {
    await mountAssistant();
    await sendText('第一轮出卡');
    lastHandlers().onDone(doneWith({ card: precheckEnvelope }));
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeTruthy();

    // 新轮（用户发新消息）即清上一轮卡片态
    await sendText('第二轮');
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();

    // 新会话同样清（clearConversation）
    lastHandlers().onDone(doneWith({ card: conclusionEnvelope }));
    await flushPromises();
    expect(
      bodyQuery('[data-testid="ipd-ai-card-host"] [data-testid="ai-card-gate-conclusion"]'),
    ).toBeTruthy();
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-new"]')!.click();
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
  });

  it('⑧ done 帧无 card 不渲染不报错（card 缺席 / card:null 原样透传）', async () => {
    await mountAssistant();
    const cardEvents = trackEvents('ipd:ai-card');

    await sendText('普通问答');
    lastHandlers().onDelta('这是纯文本回答');
    lastHandlers().onDone(doneWith({}));
    await flushPromises();

    expect(document.body.textContent ?? '').toContain('这是纯文本回答');
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
    expect(cardEvents).toHaveLength(0);

    // card:null 同样原样透传，不渲染不报错
    await sendText('再问一句');
    lastHandlers().onDone(doneWith({ card: null }));
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
    expect(cardEvents).toHaveLength(0);
    expect(streamCalls).toHaveLength(2);
  });

  it('⑨ R2 铁律：schema 外字段四层丢弃留痕（card./data./data.<arr>[i]./sourceRefs.），卡片照常派发渲染', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await mountAssistant();
    const cardEvents = trackEvents('ipd:ai-card');

    await sendText('出一张脏卡');
    lastHandlers().onDone(doneWith({ card: dirtyEnvelope }));
    await flushPromises();

    // 派发的是过检后四键纯信封：四层 schema 外字段全部丢弃
    expect(cardEvents).toHaveLength(1);
    const detail = cardEvents[0]!.detail;
    expect(Object.keys(detail).sort()).toEqual(['data', 'sourceRefs', 'type', 'version']);
    expect(detail).not.toHaveProperty('extraEnvelopeField');
    expect(detail.data).not.toHaveProperty('extraDataField');
    expect(detail.data.items[0]).not.toHaveProperty('hackedRowField');
    expect(detail.sourceRefs).not.toHaveProperty('evilRef');
    expect(detail.data).toEqual({
      gateCode: 'G1-TR',
      round: 1,
      reviewCount: 1,
      totalElements: 1,
      items: [
        {
          elementId: 101,
          result: 'PASS',
          conditionNote: '材料齐备',
          evidenceRef: 'EV-1',
          leftoverStatus: 'NONE',
        },
      ],
    });
    // 留痕：console.debug 记录全部丢弃路径（与 action-detail onAiFill 同口径）
    const logged = debugSpy.mock.calls.flat().map(String).join('\n');
    for (const path of [
      'card.extraEnvelopeField',
      'data.extraDataField',
      'data.items[0].hackedRowField',
      'sourceRefs.evilRef',
    ]) {
      expect(logged, path).toContain(path);
    }
    // 丢弃不带病：卡片照常分发渲染、不进提示态
    expect(
      bodyQuery('[data-testid="ipd-ai-card-host"] [data-testid="ai-card-gate-precheck"]'),
    ).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-card-notice"]')).toBeNull();
    debugSpy.mockRestore();
  });

  it('⑩ C08 mode 防御：mode 非链路输入同口径丢弃（与无 mode 派发全等），fillPayload.mode 恒 suggest', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await mountAssistant();
    const cardEvents = trackEvents('ipd:ai-card');
    const fillEvents = trackEvents('ipd:ai-fill-payload');

    await sendText('带 mode 出卡');
    lastHandlers().onDone(doneWith({ card: withModeEnvelope }));
    await flushPromises();
    await sendText('不带 mode 出卡');
    lastHandlers().onDone(doneWith({ card: precheckEnvelope, fillPayload }));
    await flushPromises();

    expect(cardEvents).toHaveLength(2);
    // mode 被丢弃后与无 mode 派发全等（mode 非链路输入，防御性忽略，与无 mode 全等）
    expect(cardEvents[0]!.detail).toEqual(cardEvents[1]!.detail);
    expect(cardEvents[0]!.detail.data).not.toHaveProperty('mode');
    expect(debugSpy.mock.calls.flat().map(String).join('\n')).toContain('data.mode');
    // fillPayload 通道 mode 恒 suggest（建议语义默认，不越界为执行指令）
    expect(fillEvents[0]!.detail.mode).toBe('suggest');
    debugSpy.mockRestore();
  });

  it('⑪ R3 铁律：卡片数值与 sourceRefs 对账不平 → 拒出卡降级纯文本（不派发不崩不断流）', async () => {
    const cardEvents = trackEvents('ipd:ai-card');
    const r3Cases: Array<{ envelope: unknown; name: string }> = [
      {
        name: 'reviewCount 不齐（2↔reviewIds 1）',
        envelope: {
          type: 'gate.precheck',
          version: 1,
          data: {
            gateCode: 'G1',
            round: 1,
            reviewCount: 2,
            totalElements: 1,
            items: [
              { elementId: 101, result: 'PASS', conditionNote: 'ok', evidenceRef: 'EV-1', leftoverStatus: 'NONE' },
            ],
          },
          sourceRefs: sourceRefsOf({ gateId: 1, reviewIds: [91], elementResultIds: [501] }),
        },
      },
      {
        name: 'items 数量漂移（1↔elementResultIds 2）',
        envelope: {
          type: 'gate.precheck',
          version: 1,
          data: {
            gateCode: 'G1',
            round: 1,
            reviewCount: 1,
            totalElements: 2,
            items: [
              { elementId: 101, result: 'PASS', conditionNote: 'ok', evidenceRef: 'EV-1', leftoverStatus: 'NONE' },
            ],
          },
          sourceRefs: sourceRefsOf({ gateId: 1, reviewIds: [91], elementResultIds: [501, 502] }),
        },
      },
      {
        name: '缺 sourceRefs 必备键（reviewIds/elementResultIds）',
        envelope: { ...precheckEnvelope, sourceRefs: sourceRefsOf({ gateId: 1 }) },
      },
      {
        name: 'requirementId 不在账（999∉[201]）',
        envelope: {
          type: 'demand.draft',
          version: 1,
          data: {
            contextProjectId: 1001,
            contextProjectCode: 'P',
            contextProjectName: 'X',
            requirements: [
              { requirementId: 999, title: '漂移需求', status: 'OPEN', source: 'REQ' },
            ],
          },
          sourceRefs: sourceRefsOf({ projectId: 1001, requirementIds: [201] }),
        },
      },
    ];

    for (const r3Case of r3Cases) {
      const callsBefore = streamCalls.length;
      await mountAssistant();
      await sendText('来一张对账不平的卡');
      lastHandlers().onDelta('文本照常');
      lastHandlers().onDone(doneWith({ card: r3Case.envelope }));
      await flushPromises();

      expect(bodyQuery('[data-testid="ipd-ai-card-host"]'), r3Case.name).toBeNull();
      expect(bodyQuery('[data-testid="ipd-ai-card-degraded"]'), r3Case.name).toBeNull();
      const notice = bodyQuery('[data-testid="ipd-ai-card-notice"]');
      expect(notice, r3Case.name).toBeTruthy();
      expect(notice!.textContent ?? '', r3Case.name).toContain('对账');
      // 不断流不崩：文本照常渲染、后续消息继续处理
      expect(document.body.textContent ?? '', r3Case.name).toContain('文本照常');
      await sendText('继续');
      lastHandlers().onDelta('对账降级后对话继续');
      lastHandlers().onDone(doneWith({}));
      await flushPromises();
      expect(document.body.textContent ?? '', r3Case.name).toContain('对账降级后对话继续');
      expect(streamCalls.length - callsBefore, r3Case.name).toBe(2);
    }
    expect(cardEvents).toHaveLength(0);
  });

  it('⑫ BR-AI-04 无一豁免：4 卡渲染头部均有「AI 生成内容…仅供参考」风险 Alert', async () => {
    for (const cardCase of CARD_CASES) {
      await mountAssistant();
      await sendText('出卡');
      lastHandlers().onDone(doneWith({ card: cardCase.envelope }));
      await flushPromises();

      const alert = bodyQuery(
        `[data-testid="${cardCase.root}"] [data-testid="ai-card-alert"]`,
      );
      expect(alert, cardCase.root).toBeTruthy();
      const text = alert!.textContent ?? '';
      expect(text, cardCase.root).toContain('AI 生成内容');
      expect(text, cardCase.root).toContain('仅供参考');
    }
  });

  it('⑬ C08 敏感值只进「建议值」区：金额/评分/系数/删除/移交仅展示，confirm 零写请求零提交指令', async () => {
    const fetcher = vi.fn<(url: string, init?: unknown) => Promise<Response>>(
      async () => new Response('{}'),
    );
    vi.stubGlobal('fetch', fetcher);
    await mountAssistant();
    const cardEvents = trackEvents('ipd:ai-card');
    const fillEvents = trackEvents('ipd:ai-fill-payload');

    await sendText('给我敏感值建议');
    lastHandlers().onDelta('已生成建议值');
    lastHandlers().onDone(
      doneWith({
        card: sensitiveEnvelope,
        fillPayload: {
          fields: { budget: '5000 元', score: '4.5', factor: '1.2' },
          mode: 'suggest',
          scene: 'stage-action-fields',
        },
      }),
    );
    await flushPromises();

    // 敏感值只出现在建议值区（卡片宿主内展示，不进任何写面）
    const host = bodyQuery('[data-testid="ipd-ai-card-host"]')!;
    expect(host.textContent ?? '').toContain('5000');
    expect(host.textContent ?? '').toContain('4.5');
    expect(host.textContent ?? '').toContain('1.2');

    // confirm 只暂存 emit 零直写：点击后无任何 fetch/写调用、不多发对话轮
    bodyQuery<HTMLButtonElement>('[data-testid="ai-card-confirm"]')!.click();
    await flushPromises();
    // C08 同⑥口径：零 /api/v1 直写 + 零 CopilotKit run 触发（只读探测不计入）
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/api/v1')),
    ).toEqual([]);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/agent/')),
    ).toEqual([]);
    expect(streamCalls).toHaveLength(1);

    // 载荷零提交指令：纯四键信封（无 action/submit/落库语义键，语义不越界）
    const detail = cardEvents[0]!.detail;
    expect(Object.keys(detail).sort()).toEqual(['data', 'sourceRefs', 'type', 'version']);
    expect(JSON.stringify(detail)).not.toMatch(
      /"(submit|action|persist|save|insert|delete|transfer)"/i,
    );
    // 建议值语义：fillPayload.mode 恒 suggest（仅建议不执行）
    expect(fillEvents[0]!.detail.mode).toBe('suggest');
  });

  it('⑭ 禁 v-html：恶意标记转义直显 + 副驾/4 卡渲染源码零 v-html/innerHTML', async () => {
    // 源码哨兵：5 个渲染文件零 v-html/innerHTML（防注入展示纪律）
    const renderSources = [
      'ai-assistant.vue',
      'ai-cards/gate-precheck-card.vue',
      'ai-cards/gate-conclusion-card.vue',
      'ai-cards/project-charter-card.vue',
      'ai-cards/demand-draft-card.vue',
    ];
    // happy-dom 全局 URL 对 file:// 基址相对解析有缺陷，经 node:url/fileURLToPath 取真实目录
    const sharedDir = dirname(fileURLToPath(import.meta.url));
    for (const file of renderSources) {
      const source = readFileSync(resolve(sharedDir, file), 'utf8');
      expect(source, file).not.toMatch(/v-html|innerHTML/);
    }

    await mountAssistant();
    await sendText('注入测试');
    lastHandlers().onDelta('<img src=x onerror="window.__xss=1">');
    lastHandlers().onDone(doneWith({ card: xssEnvelope }));
    await flushPromises();

    // 插值转义直显：标记不进 DOM 结构、脚本不执行、原文可见
    const html = document.body.innerHTML;
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold-gate</b>');
    expect(html).not.toContain('<script>');
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
    const text = document.body.textContent ?? '';
    expect(text).toContain('<img src=x');
    expect(text).toContain('<b>bold-gate</b>');
    expect(text).toContain('<script>window.__xss=1</script>');
  });

  it('⑮ 放大工作界面：expand → 全屏双栏（左 ipd-ai-messages / 右 ipd-ai-showcase），collapse 还原侧栏', async () => {
    await mountAssistant();
    // 抽屉形态：单栏，无 workbench 容器、无展示区空态（卡片居消息流下方由 ①-⑭ 覆盖）
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-showcase-empty"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-collapse"]')).toBeNull();

    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-expand"]')!.click();
    await flushPromises();

    const workbench = bodyQuery('[data-testid="ipd-ai-workbench"]');
    expect(workbench).toBeTruthy();
    expect(workbench!.getAttribute('data-expanded')).toBe('true');
    expect(workbench!.classList.contains('is-workbench')).toBe(true);
    // 左对话 / 右展示同屏并存（同一消息列表 DOM，零第二对话通道）
    expect(workbench!.querySelector('[data-testid="ipd-ai-messages"]')).toBeTruthy();
    expect(workbench!.querySelector('[data-testid="ipd-ai-showcase"]')).toBeTruthy();
    // 无卡片时右侧展示区空态提示（仅放大模式出现）
    expect(bodyQuery('[data-testid="ipd-ai-showcase-empty"]')).toBeTruthy();

    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-collapse"]')!.click();
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-showcase-empty"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-expand"]')).toBeTruthy();
  });

  it('⑯ 业务模式切换清理副驾会话，窗口尺寸不改变模式', async () => {
    await mountAssistant();
    await sendText('出一张预审卡');
    lastHandlers().onDelta('已生成预审建议');
    lastHandlers().onDone(doneWith({ card: precheckEnvelope }));
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-card-host"]')).toBeTruthy();
    expect(streamCalls).toHaveLength(1);
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-project"]')!.click();
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-agent-unavailable"]')).toBeNull();
    expect(bodyQuery('[data-testid="project-agent-panel"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-runs"]')).toBeTruthy();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-project"]')?.getAttribute('aria-pressed')).toBe('true');
    const activeWorkbench = bodyQuery('[data-testid="ipd-ai-workbench"]')!;
    expect(activeWorkbench.querySelector('[data-testid="ipd-ai-card-host"]')).toBeNull();
    expect(activeWorkbench.querySelector('[data-testid="ipd-ai-messages"]')?.textContent).not.toContain('已生成预审建议');
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-send"]')?.disabled).toBe(false);
    lastHandlers().onDelta('迟到的副驾帧');
    expect(activeWorkbench.querySelector('[data-testid="ipd-ai-messages"]')?.textContent).not.toContain('迟到的副驾帧');
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-collapse"]')!.click();
    await flushPromises();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-project"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-send"]')?.disabled).toBe(false);
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-classic"]')!.click();
    await flushPromises();
    expect(bodyQuery('.ant-drawer-open')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeNull();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-send"]')?.disabled).toBe(false);
    await sendText('副驾继续');
    expect(streamCalls).toHaveLength(2);
  });

  it('⑰ 切项目清理旧会话，并丢弃取消后的迟到帧', async () => {
    await mountAssistant();
    await sendText('旧项目问题');
    const oldHandlers = lastHandlers();
    window.dispatchEvent(new CustomEvent('ipd:active-project-updated', {
      detail: { projectId: '9007199254740993123' },
    }));
    await flushPromises();
    oldHandlers.onDelta('旧项目的迟到内容');
    oldHandlers.onDone(doneWith());
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-messages"]')?.textContent).not.toContain('旧项目的迟到内容');
    await sendText('新项目问题');
    expect(streamCalls.at(-1)?.projectId).toBe('9007199254740993123');
  });

  it('⑱ 刷新恢复 AI 模式时保持全屏，缩小窗口后可显式切回副驾', async () => {
    useIpdAiWorkspace().setMode('ai');
    await mountAssistant();
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-agent-unavailable"]')).toBeNull();
    expect(bodyQuery('[data-testid="project-agent-panel"]')).toBeTruthy();
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-collapse"]')!.click();
    await flushPromises();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-send"]')?.disabled).toBe(false);
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-classic"]')!.click();
    await flushPromises();
    expect(bodyQuery('.ant-drawer-open')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeNull();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-send"]')?.disabled).toBe(false);
  });

  it('⑲ 阶段栏模式事件进入 AI 工作界面，再回传统页面', async () => {
    await mountAssistant();
    window.dispatchEvent(new CustomEvent('ipd:ai-mode-select', { detail: { mode: 'ai' } }));
    await flushPromises();
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeTruthy();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-project"]')?.getAttribute('aria-pressed')).toBe('true');
    window.dispatchEvent(new CustomEvent('ipd:ai-mode-select', { detail: { mode: 'classic' } }));
    await flushPromises();
    expect(useIpdAiWorkspace().mode.value).toBe('classic');
    expect(bodyQuery('[data-testid="ipd-ai-workbench"]')).toBeNull();
  });

  it('⑳ 项目模式只浏览阶段，不冒充项目推进或已注入执行上下文', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setMode('ai');
    await mountAssistant({
      projectCurrentStage: 'PLAN',
      stages: [
        { code: 'CONCEPT', name: '概念' },
        { code: 'PLAN', name: '计划' },
        { code: 'DEV', name: '开发' },
      ],
    });
    expect(bodyQuery('[data-testid="ipd-ai-stage-nav"]')).toBeTruthy();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-stage-PLAN"]')?.getAttribute('aria-pressed')).toBe('true');
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-stage-DEV"]')!.click();
    await flushPromises();
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-stage-DEV"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(bodyQuery('[data-testid="ipd-ai-showcase"]')?.textContent).toContain('正在浏览：开发阶段');
    expect(bodyQuery('[data-testid="ipd-ai-stage-nav"]')?.textContent).toContain('概念');
    expect(bodyQuery('[data-testid="ipd-ai-run-readout"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="agent-run-history"]')?.textContent).toContain('没有匹配的运行');
    expect(bodyQuery('[data-testid="agent-run-history"]')?.textContent).not.toContain('更早的运行没有列表接口');
    const controls = bodyQuery('[data-testid="ipd-ai-agent-controls"]');
    expect(controls?.closest('[data-testid="ipd-ai-composer"]')).toBeTruthy();
    expect(controls?.hasAttribute('hidden')).toBe(true);
    expect(controls?.querySelector('[data-testid="agent-capability-picker"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-runs"]')?.querySelector('[data-testid="agent-capability-picker"]')).toBeNull();
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-plus"]')!.click();
    await flushPromises();
    expect(controls?.hasAttribute('hidden')).toBe(false);
    expect(bodyQuery('[data-testid="ipd-ai-runs"]')?.querySelector('[data-testid="panel-message"]')).toBeNull();
    expect(controls?.textContent).toContain('市场上还没纳入这个能力包的');
    expect(bodyQuery('[data-testid="agent-run-artifacts"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-showcase"]')?.textContent).not.toContain('B3 落位');
    expect(bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-stage-PLAN"]')?.textContent).toContain('当前进度');
    expect(bodyQuery('[data-testid="ipd-ai-project-select"]')?.textContent).toContain('示例项目');
    expect(bodyQuery('[data-testid="ipd-ai-ctx"]')?.textContent).toContain('当前项目：#P-1');
    expect(bodyQuery('[data-testid="ipd-ai-ctx"]')?.textContent).not.toContain('已注入');
    expect(bodyQuery('[data-testid="ipd-ai-ctx"]')?.textContent).not.toContain('执行未启用');
    expect(bodyQuery('[data-testid="project-agent-panel"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-new"]')).toBeNull();
    expect(streamCalls).toHaveLength(0);

    await sendText('分析竞品');
    expect(streamCalls).toHaveLength(0);
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createProjectAgentRun).mock.calls[0]?.[0]).toBe('P-1');
    expect(vi.mocked(createProjectAgentRun).mock.calls[0]?.[1]).toMatchObject({ message: '分析竞品' });
  });

  it('㉕ 意图卡只挂本次运行，发送后从步骤页切到本次运行', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setMode('ai');
    useIpdAiWorkspace().setPane('steps');
    vi.mocked(listProjectAgentRuns).mockResolvedValue([{
      runId: '9007199254740993',
      status: 'SUCCEEDED',
      actionCode: 'C02',
      capabilityPackCode: 'ipd.market',
      capabilityPackVersion: '1.0.0',
      createdAt: '2026-09-30T01:00:00Z',
      finishedAt: null,
      inputChars: 8,
      artifactTitles: ['竞品报告'],
      artifactExcerpt: '摘录不是提问',
    }]);
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [{
        seq: 1,
        type: 'STEP',
        payload: {
          kind: 'INTENT',
          title: '意图判断',
          detail: '范围还没定，先澄清，不进入执行。',
          needsPlan: true,
          needsClarification: true,
          questions: ['范围还没定'],
          steps: ['核对功能'],
        },
        createdAt: '2026-01-01T00:00:00Z',
      }],
      nextSeq: 2,
      terminal: true,
    });
    await mountAssistant({
      projectCurrentStage: 'PLAN',
      stages: [{ code: 'PLAN', name: '计划' }],
    });
    expect(useIpdAiWorkspace().pane.value).toBe('steps');
    const history = bodyQuery('[data-testid="agent-run-history"]');
    expect(history?.textContent).toContain('C02');
    expect(history?.textContent).toContain('竞品报告');
    expect(history?.textContent).not.toContain('更早的运行没有列表接口');
    expect(history?.textContent).not.toContain('摘录不是提问');
    expect(bodyQuery('[data-testid="ipd-ai-stage-PLAN"]')?.textContent).toContain('当前进度');
    await sendText('分析竞品');
    expect(useIpdAiWorkspace().pane.value).toBe('cards');
    expect(bodyQuery('[data-testid="ipd-ai-stage-PLAN"]')?.getAttribute('aria-pressed')).toBe('true');
    const card = bodyQuery('[data-testid="ipd-ai-run-readout"] [data-testid="agent-intent-card"]');
    expect(card?.textContent).toContain('范围还没定');
    expect(card?.textContent).toContain('核对功能');
    expect(bodyQuery('[data-testid="ipd-ai-msg-assistant"] [data-testid="agent-intent-card"]')).toBeNull();
  });

  it('㉗ 点澄清选项仍走创建运行，并切到本次运行', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setMode('ai');
    useIpdAiWorkspace().setPane('steps');
    const question = '这句话里有未选定的方向：「轻量」还是「完整」。请指定其中一个后再执行。';
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [{
        seq: 1,
        type: 'STEP',
        payload: {
          kind: 'INTENT',
          title: '意图判断',
          detail: '范围还没定，先澄清，不进入执行。',
          needsPlan: false,
          needsClarification: true,
          questions: [question],
          steps: [],
        },
        createdAt: '2026-01-01T00:00:00Z',
      }, {
        seq: 2,
        type: 'STEP',
        payload: { kind: 'AWAIT_USER', reason: 'CLARIFICATION', title: '等待澄清' },
        createdAt: '2026-01-01T00:00:01Z',
      }],
      nextSeq: 3,
      terminal: false,
    });
    vi.mocked(fetchAgentRun).mockResolvedValue({
      runId: 'run-1',
      projectId: 'P-1',
      agentId: 'a-1',
      status: 'WAITING_APPROVAL',
      actionCode: null,
      configSnapshot: {
        capabilityPackCode: 'ipd.market',
        capabilityPackVersion: '1.2.0',
        modelConfigId: '0012',
        skills: [],
        toolIds: [],
      },
      errorCode: null,
      createdAt: 'x',
      finishedAt: null,
    });
    await mountAssistant();
    await sendText('先分析再出报告');
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(bodyQuery('[data-testid="ipd-ai-run-readout"] [data-testid="intent-option"]')).toBeTruthy();
    });
    const options = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="ipd-ai-run-readout"] [data-testid="intent-option"]',
      ),
    );
    expect(options.map((button) => button.textContent?.replace(/\s+/g, '') )).toEqual(['A轻量', 'B完整']);
    options[1]!.click();
    await flushPromises();
    await vi.waitFor(() => {
      expect(createProjectAgentRun).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(createProjectAgentRun).mock.calls[1]?.[1]).toMatchObject({
      message: expect.stringMatching(/^已选：完整。/),
    });
    expect(useIpdAiWorkspace().pane.value).toBe('cards');
    expect(bodyQuery('[data-testid="ipd-ai-messages"] [data-testid="agent-intent-card"]')).toBeNull();
  });

  it('㉓ 项目模式对话栏展示模型回答，思考标签不进正文', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setMode('ai');
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [{
        seq: 1,
        type: 'TEXT_DELTA',
        payload: { text: '<think>三个主题未检索到</think>无法输出项目介绍' },
        createdAt: '2026-01-01T00:00:00Z',
      }],
      nextSeq: 2,
      terminal: true,
    });
    vi.mocked(fetchAgentRun).mockResolvedValue({
      runId: 'run-1',
      projectId: 'P-1',
      agentId: 'a-1',
      status: 'SUCCEEDED',
      actionCode: null,
      configSnapshot: {
        capabilityPackCode: 'ipd.market',
        capabilityPackVersion: '1.2.0',
        modelConfigId: '0012',
        skills: [],
        toolIds: [],
      },
      errorCode: null,
      createdAt: 'x',
      finishedAt: 'y',
    });
    await mountAssistant();
    await sendText('介绍这个项目');
    const messages = bodyQuery('[data-testid="ipd-ai-messages"]');
    expect(messages?.textContent).toContain('介绍这个项目');
    await vi.waitFor(() => {
      const answer = bodyQuery('[data-testid="ipd-ai-msg-assistant"] [data-testid="assistant-answer"]');
      expect(answer?.textContent).toContain('无法输出项目介绍');
    });
    const answer = bodyQuery('[data-testid="ipd-ai-msg-assistant"] [data-testid="assistant-answer"]');
    expect(answer?.textContent).not.toContain('<think>');
    expect(bodyQuery('[data-testid="ipd-ai-msg-assistant"] [data-testid="assistant-think"]')?.textContent)
      .toContain('三个主题未检索到');
  });

  it('㉖ 意图卡短句与思考区分块：C02 执行规约不进意图卡，摘要只留思考', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setMode('ai');
    const c02Rule =
      '按 C02 竞品分析 skill 的执行规约，先对考勤智能体的产品定位、候选竞品、区域准入与需求差异四类事实源做并行检索；检索不到的资料一律标"未取得"';
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [
        {
          seq: 1,
          type: 'STEP',
          payload: {
            kind: 'SKILL_LOADED',
            name: 'c02-competitor',
            detail: c02Rule,
          },
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          seq: 2,
          type: 'STEP',
          payload: {
            kind: 'INTENT',
            title: '意图判断',
            detail: '可以直接回答，不单独列计划。',
            needsPlan: false,
            needsClarification: false,
            questions: [],
            steps: [],
          },
          createdAt: '2026-01-01T00:00:01Z',
        },
        {
          seq: 3,
          type: 'TEXT_DELTA',
          payload: { text: `<think>${c02Rule}</think>` },
          createdAt: '2026-01-01T00:00:02Z',
        },
      ],
      nextSeq: 4,
      terminal: true,
    });
    vi.mocked(fetchAgentRun).mockResolvedValue({
      runId: 'run-1',
      projectId: 'P-1',
      agentId: 'a-1',
      status: 'SUCCEEDED',
      actionCode: null,
      configSnapshot: {
        capabilityPackCode: 'ipd.market',
        capabilityPackVersion: '1.2.0',
        modelConfigId: '0012',
        skills: [],
        toolIds: [],
      },
      errorCode: null,
      createdAt: 'x',
      finishedAt: 'y',
    });
    await mountAssistant();
    await sendText('区域市场准入与需求差异调研，生成考勤智能体的市场洞察调研报告');
    const card = bodyQuery('[data-testid="ipd-ai-run-readout"] [data-testid="agent-intent-card"]');
    expect(card?.textContent).toContain('不要计划');
    expect(card?.textContent).toContain('不要澄清');
    expect(card?.textContent).toContain('可以直接回答，不单独列计划。');
    expect(card?.textContent).not.toContain('C02 竞品分析');
    expect(card?.textContent).not.toContain('执行规约');
    expect(bodyQuery('[data-testid="ipd-ai-msg-assistant"] [data-testid="agent-intent-card"]')).toBeNull();
    await vi.waitFor(() => {
      expect(bodyQuery('[data-testid="ipd-ai-msg-assistant"] [data-testid="assistant-think"]')).toBeTruthy();
    });
    const summary = bodyQuery('[data-testid="assistant-think-summary"]');
    expect(summary?.textContent?.replace(/\s+/g, '')).toContain('思考');
    expect(summary?.textContent).not.toContain('执行规约');
    expect(bodyQuery('[data-testid="assistant-think-body"]')?.textContent).toContain('C02 竞品分析');
    expect(bodyQuery('[data-testid="assistant-answer"]')).toBeNull();
    const think = bodyQuery('[data-testid="assistant-think"]');
    expect(think?.hasAttribute('open')).toBe(false);
  });

  it('㉑ 项目占位模式阻断旧副驾引导事件，切回副驾后恢复引导', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setPane('steps');
    useIpdAiWorkspace().setMode('ai');
    vi.mocked(fetchSubStages).mockResolvedValue([{
      actions: [{
        actionCode: 'A-01', actionName: '竞品分析', skillNames: ['swot'],
        sortOrder: 1, subStageCode: 'S1',
      }],
      code: 'S1', gateCode: null, id: '1', isGate: 'N',
      name: '概念小阶段', ownerRole: 'MARKET_PM', skillHint: null,
      sortOrder: 1, stageCode: 'CONCEPT',
    }]);
    vi.mocked(fetchGuideEvents).mockResolvedValue([]);
    await mountAssistant({ projectCurrentStage: 'CONCEPT', stages: [{ code: 'CONCEPT', name: '概念' }] });
    const emitted = trackEvents('ipd:guide-sub-stage');
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-step-S1"]')!.click();
    window.dispatchEvent(new CustomEvent('ipd:guide-sub-stage', {
      detail: { projectId: 'P-1', subStageCode: 'S1' },
    }));
    await flushPromises();
    expect(emitted).toHaveLength(1); // 只计测试显式派发；项目模式点击不派发。
    expect(fetchGuideEvents).not.toHaveBeenCalled();
    expect(bodyQuery('[data-testid="ipd-ai-step-actions"]')?.textContent).toContain('概念小阶段');
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-step-action-A-01"]')!.click();
    expect(fetchGuideEvents).not.toHaveBeenCalled();

    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-mode-classic"]')!.click();
    await flushPromises();
    expect(bodyQuery('.ant-drawer-open')).toBeTruthy();
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-step-S1"]')!.click();
    await flushPromises();
    expect(fetchGuideEvents).toHaveBeenCalledWith('S1', 'P-1');
  });

  it('㉓ meta 帧的待办清单渲染在回答下方，外链不做成按钮', async () => {
    await mountAssistant();
    await sendText('我的待办');
    lastHandlers().onMeta({
      answer: '',
      data: [
        { hint: '', title: '智能锁通信协议评审', type: 'stage_sign', url: '' },
        { hint: '待签', title: '归档复核', type: 'deletion_review', url: '/ipd/projects/2/actions/9' },
        { hint: null, title: '外链', type: 'TASK', url: 'https://example.invalid/x' },
      ],
      intent: 'TASKS',
      latencyMs: 1,
      sources: ['workbench.tasks'],
      tokenCompletion: 0,
      tokenPrompt: 0,
    });
    lastHandlers().onDelta('你有 2 项待办，下方按类型排序展示。');
    lastHandlers().onDone(doneWith());
    await flushPromises();
    const list = bodyQuery('[data-testid="ipd-ai-msg-items"]');
    expect(list?.textContent).toContain('智能锁通信协议评审');
    expect(list?.textContent).toContain('归档复核');
    expect(list?.textContent).toContain('待签');
    expect(list?.textContent).toContain('外链');
    expect([...(list?.querySelectorAll('button') ?? [])].map((button) => button.textContent?.trim())).toEqual(['归档复核']);
  });

  it('㉓b 站内待办按钮点进已有动作页', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        {
          path: '/ipd/projects/:projectId/actions/:actionId',
          name: 'IpdActionDetail',
          component: { template: '<div data-testid="action-page" />' },
        },
      ],
    });
    await router.push('/');
    await router.isReady();
    await mountAssistant({}, { router });
    await sendText('我的待办');
    lastHandlers().onMeta({
      answer: '',
      data: [
        { hint: '熵基互联+智能锁联动', title: '智能锁通信协议评审', type: 'stage_sign', url: '/ipd/projects/2/actions/9' },
      ],
      intent: 'TASKS',
      latencyMs: 1,
      sources: ['workbench.tasks'],
      tokenCompletion: 0,
      tokenPrompt: 0,
    });
    lastHandlers().onDelta('你有 1 项待办，下方按类型排序展示。');
    lastHandlers().onDone(doneWith());
    await flushPromises();
    const button = bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-msg-items"] button');
    expect(button?.textContent).toContain('智能锁通信协议评审');
    button!.click();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/ipd/projects/2/actions/9');
  });

  it('㉒ 对话栏可以切换项目，并同步全局当前项目', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    await mountAssistant();
    const select = bodyQuery<HTMLSelectElement>('[data-testid="ipd-ai-project-select"]');
    expect(select?.value).toBe('P-1');
    const synced = trackEvents('ipd:current-project-changed');
    select!.value = 'P-2';
    select!.dispatchEvent(new Event('change'));
    await flushPromises();
    expect(window.localStorage.getItem('ipd:current-project')).toBe('P-2');
    expect(synced).toHaveLength(1);
    expect(bodyQuery('[data-testid="ipd-ai-ctx"]')?.textContent).toContain('#P-2');
  });
});

describe('待办进入后的产物审核', () => {
  it('深链带 docId 时在现有侧栏显示当前版本的审核通过和退回修改，不创建运行', async () => {
    const previous = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, '', '/ipd/ai-assistant?projectId=200&docId=9001&actionCode=C02');
    vi.mocked(fetchSubStages).mockResolvedValue([]);
    vi.mocked(listAiDocumentVersions).mockResolvedValue([
      {
        content: '竞品正文',
        contentSha256: null,
        createTime: null,
        docType: 'MRD',
        id: '9001',
        model: null,
        parentVersionId: null,
        projectId: '200',
        reviewedAt: null,
        reviewedBy: null,
        status: 'GENERATED',
        title: '竞品分析',
        tokenCompletion: null,
        tokenPrompt: null,
        versionNo: 1,
      },
    ]);
    try {
      await mountAssistant();
      const review = bodyQuery('[data-testid="document-version-review"]');
      expect(review?.textContent).toContain('待审核');
      expect(review?.textContent).toContain('审核通过');
      expect(review?.textContent).toContain('退回修改');
      expect(bodyQuery('[data-testid="ipd-ai-runs"]')).not.toBeNull();
      expect(createProjectAgentRun).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, '', previous || '/');
    }
  });
});

it('移除动作深链后不残留上一动作绑定', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/ipd/ai-assistant', component: { template: '<div />' } },
  ] });
  await router.push('/ipd/ai-assistant?projectId=200&actionCode=C02');
  await router.isReady();
  vi.mocked(fetchSubStages).mockResolvedValue([]);
  await mountAssistant({}, { router });
  expect(assistantWrapper!.findComponent({ name: 'ProjectAgentPanel' }).props('actionCode')).toBe('C02');
  await router.push('/ipd/ai-assistant?projectId=200');
  await flushPromises();
  expect(assistantWrapper!.findComponent({ name: 'ProjectAgentPanel' }).props('actionCode')).toBeUndefined();
});

describe('正文滚动监听归属', () => {
  it('本实例监听在模式替换与卸载时移除，并不绑定同ID外部节点', async () => {
    window.localStorage.setItem('ipd:current-project', 'P-1');
    useIpdAiWorkspace().setMode('ai');
    await mountAssistant();
    const first = bodyQuery('[data-testid="ipd-ai-run-readout"]')!.closest('.ws-body')!;
    const removeFirst = vi.spyOn(first, 'removeEventListener');
    useIpdAiWorkspace().setMode('classic'); await flushPromises();
    expect(removeFirst.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    const foreign = document.createElement('div');
    foreign.className = 'ws-body';
    const foreignChild = document.createElement('div');
    foreignChild.id = 'ipd-ai-run-readout';
    foreign.append(foreignChild);
    document.body.prepend(foreign);
    const foreignAdd = vi.spyOn(foreign, 'addEventListener');
    useIpdAiWorkspace().setMode('ai'); await flushPromises();
    const second = bodyQuery('[data-testid="ipd-ai-run-readout"]')!.closest('.ws-body')!;
    expect(foreignAdd.mock.calls.some(([type]) => type === 'scroll')).toBe(false);
    const removeSecond = vi.spyOn(second, 'removeEventListener');
    assistantWrapper!.unmount(); assistantWrapper = null;
    expect(removeSecond.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    removeFirst.mockRestore(); removeSecond.mockRestore(); foreignAdd.mockRestore(); foreign.remove();
  });
});
