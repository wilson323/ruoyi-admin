/**
 * 引导接线测试（C4b）：ipd:guide-sub-stage → 拉引导帧 → chips/消息流/pageContext 三通道接线。
 *
 * 覆盖详稿点检锚 ①-④ 的自动化等价物（浏览器手检 → 组件测试，测试基线零新增依赖）：
 * ①事件到达 chips 出现 ②点击 chip 填入输入框（零写请求）③引导文本进消息流 ④拉帧失败不崩。
 * 另附源码红线扫描（D-13：接线禁用 suggestions 引擎 hook，chips 数据源自引导帧本地解析；
 * 颜色三级机制：样式块零硬编码色值零 :root，走 --ipd-* 在册令牌；词边界正则防误伓名词真名）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchGuideEvents } from '../../../../api/ipd/guide-script';
import { fetchSubStages } from '../../../../api/ipd/stage-sub-stages';
import AiAssistant from '../ai-assistant.vue';
import { useIpdAiWorkspace } from '../ai-workspace/use-ai-workspace';

vi.mock('../../../../api/ipd/guide-script', () => ({
  fetchGuideEvents: vi.fn(),
}));
vi.mock('../../../../api/ipd/stage-sub-stages', () => ({
  fetchSubStages: vi.fn(),
}));

/** 两步骤引导帧样本（C2 契约：STATE_DELTA op.value 增 guideSteps/advanceGate）。 */
const GUIDE_EVENTS = [
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '小阶段「市场洞察」共 2 个动作' },
  {
    type: 'STATE_DELTA',
    delta: [
      {
        op: 'add',
        path: '/subStageGuide',
        value: {
          subStageCode: 'CONCEPT-S1',
          guideSteps: [
            {
              actionCode: 'C01', actionName: '市场机会与痛点调研', sortOrder: 1,
              bindLevel: 'BIND', aiMode: 'AI_GENERATE',
              skillNames: ['interview-script'], commandChain: ['/interview prep'],
              degradedSteps: [
                { command: '/interview prep', skillNames: ['interview-script'], stepPrompt: '准备访谈提纲' },
              ],
              guidePrompt: '先用 JTBD 提纲做痛点访谈。', stepState: 'PENDING', blocking: true,
            },
            {
              actionCode: 'C02', actionName: '竞品分析', sortOrder: 2,
              bindLevel: 'BIND', aiMode: 'STRUCTURED_LOG',
              skillNames: [], commandChain: [],
              degradedSteps: [],
              guidePrompt: '拆解竞品功能与定价。', stepState: 'PENDING', blocking: true,
            },
          ],
          advanceGate: {
            nextSubStageCode: 'CONCEPT-S2', advanceAllowed: false, pendingBlockingCodes: ['C12'],
          },
        },
      },
    ],
  },
];

const CHIP_1 = '1. 市场机会与痛点调研（技能 interview-script）：先用 JTBD 提纲做痛点访谈。';
const CHIP_2 = '2. 竞品分析（结构化登记）：拆解竞品功能与定价。';

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const mounted: VueWrapper[] = [];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('ipd:current-project', '1001');
  window.sessionStorage.clear();
  const workspace = useIpdAiWorkspace();
  workspace.setMode('classic');
  workspace.setPane('cards');
  workspace.activeSubStageCode.value = null;
  vi.mocked(fetchGuideEvents).mockReset();
  vi.mocked(fetchGuideEvents).mockResolvedValue(GUIDE_EVENTS);
  vi.mocked(fetchSubStages).mockReset();
  vi.mocked(fetchSubStages).mockResolvedValue([{
    actions: [{ actionCode: 'C01', actionName: '市场机会与痛点调研', skillNames: [], sortOrder: 1, subStageCode: 'CONCEPT-S1' }],
    code: 'CONCEPT-S1', gateCode: null, id: '100', isGate: '0', name: '市场洞察',
    ownerRole: 'MARKET_PM', skillHint: null, sortOrder: 1, stageCode: 'CONCEPT',
  }]);
});

afterEach(() => {
  // 卸载防串态：onUnmounted 移除窗口监听，旧实例不得污染 mock 调用计数
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function bodyQuery<T extends Element = HTMLElement>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

/** 挂载副驾并打开抽屉（Drawer 传送 body，按仓内惯例 attachTo + body 查询）。 */
async function mountAssistant(): Promise<VueWrapper> {
  document.body.innerHTML = '';
  const wrapper = mount(AiAssistant, { attachTo: document.body });
  mounted.push(wrapper);
  bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-fab"]')!.click();
  await flushPromises();
  return wrapper;
}

/** 派发窗口事件 ipd:guide-sub-stage（派发端属 Track B，本 Track 只订阅）。 */
async function dispatchGuide(detail: unknown): Promise<void> {
  window.dispatchEvent(new CustomEvent('ipd:guide-sub-stage', { detail }));
  await flushPromises();
}

describe('引导接线（C4b）：ipd:guide-sub-stage → chips/消息流/上下文', () => {
  it('步骤导航选择真实目录项后触发引导帧读取', async () => {
    window.localStorage.setItem('ipd:current-project', '1001');
    await mountAssistant();
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-ws-tab-steps"]')!.click();
    await flushPromises();
    expect(fetchSubStages).toHaveBeenCalledTimes(1);
    bodyQuery<HTMLButtonElement>('[data-testid="ipd-ai-step-CONCEPT-S1"]')!.click();
    await flushPromises();
    expect(fetchGuideEvents).toHaveBeenCalledWith('CONCEPT-S1', '1001');
    expect(bodyQuery('[data-testid="ipd-guide-chip-0"]')).toBeTruthy();
  });

  it('① 事件到达 → 拉引导帧 → chips 条出现且逐条文本契约全等', async () => {
    await mountAssistant();
    await dispatchGuide({ subStageCode: 'CONCEPT-S1', projectId: '1001' });

    expect(vi.mocked(fetchGuideEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchGuideEvents)).toHaveBeenCalledWith('CONCEPT-S1', '1001');
    expect(bodyQuery('[data-testid="ipd-guide-chips"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-guide-chip-0"]')?.textContent?.trim()).toBe(CHIP_1);
    expect(bodyQuery('[data-testid="ipd-guide-chip-1"]')?.textContent?.trim()).toBe(CHIP_2);
  });

  it('② 点击 chip → 填入输入框全文（零写请求，发送仍由真人触发）', async () => {
    await mountAssistant();
    await dispatchGuide({ subStageCode: 'CONCEPT-S1', projectId: '1001' });
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);

    bodyQuery<HTMLButtonElement>('[data-testid="ipd-guide-chip-1"]')!.click();
    await flushPromises();

    expect(bodyQuery<HTMLInputElement>('[data-testid="ipd-ai-input"]')!.value).toBe(CHIP_2);
    const writes = fetchSpy.mock.calls.filter((call) => {
      // CopilotKitProvider 会在挂载后异步探测 runtime；这里只断言 chip 不触发 IPD 业务写。
      if (!String(call[0]).includes('/api/v1/')) return false;
      const init = call[1] as RequestInit | undefined;
      return init?.method ? WRITE_METHODS.has(init.method.toUpperCase()) : false;
    });
    expect(writes).toHaveLength(0);
    expect(vi.mocked(fetchGuideEvents)).toHaveBeenCalledTimes(1);
  });

  it('③ 引导文本降级进消息流（单轨红线 3：文本路径保留）', async () => {
    await mountAssistant();
    await dispatchGuide({ subStageCode: 'CONCEPT-S1', projectId: '1001' });

    expect(bodyQuery('[data-testid="ipd-ai-messages"]')?.textContent ?? '').toContain('共 2 个动作');
  });

  it('④ 拉帧失败 → chips 空态不崩（断网降级，组件存活对话不受影响）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetchGuideEvents).mockRejectedValueOnce(new Error('network down'));
    await mountAssistant();

    await dispatchGuide({ subStageCode: 'CONCEPT-S1', projectId: '1001' });

    expect(bodyQuery('[data-testid="ipd-guide-chips"]')).toBeNull();
    expect(bodyQuery('[data-testid="ipd-ai-fab"]')).toBeTruthy();
    expect(bodyQuery('[data-testid="ipd-ai-messages"]')?.textContent ?? '').not.toContain('共 2 个动作');
    expect(warn).toHaveBeenCalled();
  });

  it('⑤ detail 缺 subStageCode → 不拉帧（防御性早退）', async () => {
    await mountAssistant();
    await dispatchGuide({ projectId: '1001' });
    await dispatchGuide(undefined);
    await dispatchGuide({ subStageCode: '' });

    expect(vi.mocked(fetchGuideEvents)).not.toHaveBeenCalled();
  });
});

describe('源码红线扫描（D-13 / 颜色三级机制 / 词边界正则）', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (relative: string) => readFileSync(resolve(here, relative), 'utf8');
  const IMPL_FILES = [
    './guide-script.ts',
    './guide-script-host.ts',
    './guide-suggestion-bar.vue',
    '../../../../api/ipd/guide-script.ts',
    '../ai-assistant.vue',
  ];

  it('D-13：接线层零 suggestions 引擎 hook（chips 数据源自引导帧本地解析）', () => {
    for (const file of IMPL_FILES) {
      expect(read(file), file).not.toMatch(/\buseSuggestions\b|\buseConfigureSuggestions\b/);
    }
  });

  it('D-13：上下文注入走 useAgentContext 原语（guide-script-host.ts）', () => {
    expect(read('./guide-script-host.ts')).toMatch(/\buseAgentContext\s*\(/);
  });

  it('成熟能力优先：chips 本体为 @copilotkit/vue 既有组件（零自造 chips）', () => {
    const source = read('./guide-suggestion-bar.vue');
    expect(source).toContain('CopilotChatSuggestionView');
    expect(source).toContain('CopilotChatSuggestionPill');
  });

  it('颜色三级机制：样式块零硬编码色值零 :root，仅走 --ipd-* 在册令牌', () => {
    const source = read('./guide-suggestion-bar.vue');
    const styleBlocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');
    expect(styleBlocks.length).toBeGreaterThan(0);
    for (const css of styleBlocks) {
      expect(css, '零 :root').not.toMatch(/:root\b/);
      expect(css, '零硬编码 hex 色值').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, '走 --ipd-* 令牌').toContain('var(--ipd-');
    }
  });

  it('词边界正则：新增接线文件零 TODO/FIXME 残留', () => {
    for (const file of IMPL_FILES) {
      expect(read(file), file).not.toMatch(/\bTODO\b|\bFIXME\b/);
    }
  });
});
