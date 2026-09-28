/**
 * AI 副驾 done 帧卡片分发渲染测试（R232 批次7 P2-02 重放）。
 *
 * 14 用例：① fillPayload 广播逐字段零回归（既有行为）② 4 卡事件到达（每类卡片 done 帧
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
 * ⑭ 禁 v-html：恶意标记转义直显 + 副驾/4 卡渲染源码零 v-html/innerHTML。
 *
 * 信封守卫复用 api/ipd/ai-copilot 真实 parseStreamDone（mock 只替身 streamCopilot；
 * 防双轨红线：isCardEnvelope/parseCardEnvelope 校验逻辑零复制）。R2/R3 过检在
 * ai-assistant.vue 卡片过检层（satisfies schema 镜像零复制）。SSE 传输面（帧解析/
 * fetch）不在本文件测（ai-copilot.test.ts 已覆盖），此处直接驱动 handler 面。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CopilotStreamDone,
  CopilotStreamHandlers,
} from '../../../api/ipd/ai-copilot';
import { streamCopilot } from '../../../api/ipd/ai-copilot';
import AiAssistant from './ai-assistant.vue';
import type { AiCardEnvelope } from './ai-cards/types';

vi.mock('../../../api/ipd/ai-copilot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/ipd/ai-copilot')>();
  return { ...actual, streamCopilot: vi.fn() };
});

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
let streamCalls: Array<{ handlers: CopilotStreamHandlers; message: string }>;
/** window 事件捕获（ipd:ai-fill-payload / ipd:ai-card），逐用例清场防串态。 */
let trackedEvents: Array<{ listener: (event: Event) => void; type: string }>;

beforeEach(() => {
  streamCalls = [];
  trackedEvents = [];
  window.localStorage.clear();
  vi.mocked(streamCopilot).mockReset();
  vi.mocked(streamCopilot).mockImplementation(async (input, handlers) => {
    streamCalls.push({ handlers, message: input.message });
  });
});

afterEach(() => {
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
async function mountAssistant() {
  document.body.innerHTML = '';
  mount(AiAssistant, { attachTo: document.body });
  bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-fab"]')!.click();
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
    const fetcher = vi.fn(async () => new Response('{}'));
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
    const fetcher = vi.fn(async () => new Response('{}'));
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
});
