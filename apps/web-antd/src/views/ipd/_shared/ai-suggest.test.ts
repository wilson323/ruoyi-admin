/**
 * AiSuggest 通用组件行为测试（R227-C1 AI-FUSION L2）。
 *
 * 覆盖：调用参数组装（scene + 全局当前项目回落）、needsPrompt 前置校验、
 * 成功渲染（默认无采纳按钮 = 未声明 schema 场景）、adoptable 门控与 emit、
 * degraded 引导态、错误态走 ipdErrorText 不静默。
 *
 * P1-07 分发层覆盖（第二个 describe）：合法 card→对应卡片组件、无 card→纯文本、
 * 非法 card/渲染异常→可见降级+文本回退、3 轻场景不出卡、confirm 只接住留 hook。
 *
 * P1-08-R232 覆盖（第三个 describe）：decision 按真实票（reviews[].decision 域值
 * APPROVE|REJECT|null|ABSTAIN）推导、票面/要素不一致反例锁定、签署确认弹层
 * （confirm 先出弹层不直达提交 / 弹层可改 decision+opinion / 取消零调用）。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../api/ipd/auth';
import { aiSuggest, type AiSuggestScene, type AiSuggestView } from '../../../api/ipd/ai-suggest';
import { signGate, type GateDecision } from '../../../api/ipd/gate-review';
import AiSuggest from './ai-suggest.vue';
import type { AiCardEnvelope } from './ai-cards/types';

vi.mock('../../../api/ipd/ai-suggest', () => ({
  aiSuggest: vi.fn(),
}));
vi.mock('../../../api/ipd/gate-review', () => ({
  signGate: vi.fn(),
}));

const okView = {
  aiModel: 'mock-mini',
  completionTokens: 30,
  degraded: false,
  latencyMs: 500,
  markdown: '## 建议\n1. 先补齐材料',
  promptTokens: 100,
  scene: 'workbench.next-step',
};

/** 带 card 的响应（P1-02 契约在 AiSuggestView 之上增四键信封 card 字段）。 */
type SuggestViewWithCard = AiSuggestView & { card?: AiCardEnvelope | null };

/** 组装带 card 的响应视图（card=undefined 即「无 card」态）。 */
function viewWith(
  card: SuggestViewWithCard['card'],
  over: Partial<SuggestViewWithCard> = {},
): SuggestViewWithCard {
  return { ...okView, ...over, card };
}

/** gate.precheck 合法信封（四键齐 + data 形态对齐 types.ts）。 */
const precheckEnvelope: AiCardEnvelope = {
  type: 'gate.precheck',
  version: 1,
  data: {
    gateCode: 'G1-TR',
    round: 1,
    reviewCount: 1,
    totalElements: 1,
    items: [
      { elementId: 1, result: 'PASS', conditionNote: '材料齐备', evidenceRef: 'EV-1', leftoverStatus: 'NONE' },
    ],
  },
  sourceRefs: { gate: '1' },
};

/** gate.conclusion 合法信封（reviews[].decision=APPROVE 为 gate_reviews 合法域值）。 */
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
  sourceRefs: { gate: '1' },
};

/** project.charter 合法信封。 */
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
  sourceRefs: { project: 1001 },
};

/** demand.draft 合法信封。 */
const draftEnvelope: AiCardEnvelope = {
  type: 'demand.draft',
  version: 1,
  data: {
    contextProjectId: 1001,
    contextProjectCode: 'P-2026-01',
    contextProjectName: '扫地机器人',
    requirements: [{ requirementId: 201, title: '拖布自清洁', status: 'OPEN', source: 'REQ' }],
  },
  sourceRefs: { project: 1001 },
};

beforeEach(() => {
  vi.mocked(aiSuggest).mockReset();
  window.localStorage.clear();
});

describe('AiSuggest 组件（R227-C1）', () => {
  it('点击发起：aiSuggest 收到 scene，无全局项目时 projectId=undefined', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('workbench.next-step', {
      entityId: undefined,
      projectId: undefined,
      userPrompt: undefined,
    });
    expect(wrapper.get('[data-testid="ai-suggest-result"]').text()).toContain('先补齐材料');
  });

  it('跟随全局当前项目（localStorage ipd:current-project）', async () => {
    window.localStorage.setItem('ipd:current-project', '9140001');
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, { props: { scene: 'project.summary.refresh' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('project.summary.refresh', {
      entityId: undefined,
      projectId: '9140001',
      userPrompt: undefined,
    });
  });

  it('新建立项关掉当前项目：壳上已选项目不进本次建议', async () => {
    window.localStorage.setItem('ipd:current-project', '9001');
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, {
      props: { scene: 'project.create.suggest', needsPrompt: true, useCurrentProject: false },
    });

    await wrapper.get('[data-testid="ai-suggest-prompt"]').setValue('做一款门禁');
    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('project.create.suggest', {
      entityId: undefined,
      projectId: undefined,
      userPrompt: '做一款门禁',
    });
  });

  it('needsPrompt 空素材：本地校验拦截不发请求', async () => {
    const wrapper = mount(AiSuggest, {
      props: { scene: 'project.create.suggest', needsPrompt: true },
    });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');

    expect(aiSuggest).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="ai-suggest-error"]').text()).toContain('原始素材');
  });

  it('needsPrompt 有素材：userPrompt 去空白后随请求发出', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const wrapper = mount(AiSuggest, {
      props: { scene: 'demand.create.from-requirement', needsPrompt: true },
    });

    await wrapper.get('[data-testid="ai-suggest-prompt"]').setValue('  做一款扫地机器人  ');
    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(aiSuggest).toHaveBeenCalledWith('demand.create.from-requirement',
      expect.objectContaining({ userPrompt: '做一款扫地机器人' }));
  });

  it('成功输出默认不展示「采纳到表单」（未声明 schema 场景禁自动采纳）；adoptable 才展示并 emit', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(okView);
    const plain = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });
    await plain.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    expect(plain.find('[data-testid="ai-suggest-adopt"]').exists()).toBe(false);

    const adoptable = mount(AiSuggest, {
      props: { scene: 'project.summary.refresh', adoptable: true },
    });
    await adoptable.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    await adoptable.get('[data-testid="ai-suggest-adopt"]').trigger('click');

    expect(adoptable.emitted('adopt')?.[0]).toEqual([
      { markdown: okView.markdown, scene: 'workbench.next-step' },
    ]);
  });

  it('degraded 引导态：warning 展示且无采纳/复制按钮', async () => {
    vi.mocked(aiSuggest).mockResolvedValue({ ...okView, degraded: true, markdown: 'AI 建议暂未启用' });
    const wrapper = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="ai-suggest-degraded"]').text()).toContain('暂未启用');
    expect(wrapper.find('[data-testid="ai-suggest-adopt"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ai-suggest-copy"]').exists()).toBe(false);
  });

  it('请求失败：错误文案走 ipdErrorText 展示，不静默', async () => {
    // 真实通道形态：requestIpd 非 2xx 拒 IpdRequestError，envelopeMessage 透传后端原文（R215-E2E-B）
    vi.mocked(aiSuggest).mockRejectedValue(new IpdRequestError('request failed', 500, 90001, 'http', 'AI 服务暂时不可用'));
    const wrapper = mount(AiSuggest, { props: { scene: 'workbench.next-step' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="ai-suggest-error"]').text()).toContain('AI 服务暂时不可用');
    expect(wrapper.find('[data-testid="ai-suggest-result"]').exists()).toBe(false);
  });
});

describe('AiSuggest 卡片分发层（P1-07）', () => {
  const structuredCases: Array<{
    envelope: AiCardEnvelope;
    root: string;
    scene: AiSuggestScene;
  }> = [
    { scene: 'gate.precheck-checklist', envelope: precheckEnvelope, root: 'ai-card-gate-precheck' },
    { scene: 'gate.conclusion-draft', envelope: conclusionEnvelope, root: 'ai-card-gate-conclusion' },
    { scene: 'project.create.suggest', envelope: charterEnvelope, root: 'ai-card-project-charter' },
    {
      scene: 'demand.create.from-requirement',
      envelope: draftEnvelope,
      root: 'ai-card-demand-draft',
    },
  ];

  it('4 结构化场景：合法 card（type+version 命中注册表）→ 渲染对应卡片组件，文本 pre 让位', async () => {
    for (const testCase of structuredCases) {
      vi.mocked(aiSuggest).mockReset();
      vi.mocked(aiSuggest).mockResolvedValue(
        viewWith(testCase.envelope, { scene: testCase.scene }),
      );
      const wrapper = mount(AiSuggest, { props: { scene: testCase.scene } });

      await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
      await flushPromises();

      expect(wrapper.find(`[data-testid="${testCase.root}"]`).exists(), testCase.scene).toBe(true);
      expect(wrapper.find('.suggest-md').exists(), `${testCase.scene} 卡态不应出文本 pre`).toBe(false);
      expect(
        wrapper.find('[data-testid="ai-suggest-card-degraded"]').exists(),
        `${testCase.scene} 合法 card 不应降级`,
      ).toBe(false);
    }
  });

  it('结构化场景无 card → 保持既有纯文本渲染（文本路径永不删）', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(viewWith(null, { scene: 'project.create.suggest' }));
    const wrapper = mount(AiSuggest, { props: { scene: 'project.create.suggest' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.suggest-md').exists()).toBe(true);
    expect(wrapper.get('[data-testid="ai-suggest-result"]').text()).toContain('先补齐材料');
    expect(wrapper.find('[data-testid^="ai-card-"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ai-suggest-card-degraded"]').exists()).toBe(false);
  });

  it('非法 card → 可见降级提示 + 文本回退（未知 type / version 不匹配 / 信封缺键 / card 非对象）', async () => {
    const illegalCases: Array<{ envelope: AiCardEnvelope; name: string }> = [
      {
        name: '未知 type',
        envelope: {
          type: 'unknown.card',
          version: 1,
          data: {},
          sourceRefs: {},
        } as unknown as AiCardEnvelope,
      },
      { name: 'version 不匹配', envelope: { ...precheckEnvelope, version: 99 } },
      {
        name: '信封缺 data/sourceRefs',
        envelope: { type: 'gate.precheck', version: 1 } as unknown as AiCardEnvelope,
      },
      { name: 'card 非对象', envelope: 'garbage' as unknown as AiCardEnvelope },
    ];

    for (const testCase of illegalCases) {
      vi.mocked(aiSuggest).mockReset();
      vi.mocked(aiSuggest).mockResolvedValue(
        viewWith(testCase.envelope, { scene: 'gate.precheck-checklist' }),
      );
      const wrapper = mount(AiSuggest, { props: { scene: 'gate.precheck-checklist' } });

      await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
      await flushPromises();

      const degraded = wrapper.find('[data-testid="ai-suggest-card-degraded"]');
      expect(degraded.exists(), `${testCase.name} 应有可见降级`).toBe(true);
      expect(degraded.text(), testCase.name).toContain('回退文本建议');
      expect(wrapper.find('.suggest-md').exists(), `${testCase.name} 文本应回退`).toBe(true);
      expect(wrapper.find('[data-testid^="ai-card-"]').exists(), `${testCase.name} 不应出卡`).toBe(
        false,
      );
    }
  });

  it('渲染异常 → onErrorCaptured 可见降级 + 文本回退（三态之三）', async () => {
    // data 形态过信封校验但 items 含 null 行，模板读 item.result 时抛错（模拟渲染异常）
    const crashEnvelope = {
      type: 'gate.precheck',
      version: 1,
      data: { gateCode: 'G1', round: 1, reviewCount: 1, totalElements: 1, items: [null] },
      sourceRefs: {},
    } as unknown as AiCardEnvelope;
    vi.mocked(aiSuggest).mockResolvedValue(viewWith(crashEnvelope, { scene: 'gate.precheck-checklist' }));
    const wrapper = mount(AiSuggest, { props: { scene: 'gate.precheck-checklist' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    await flushPromises();

    const degraded = wrapper.find('[data-testid="ai-suggest-card-degraded"]');
    expect(degraded.exists()).toBe(true);
    expect(degraded.text()).toContain('渲染异常');
    expect(wrapper.find('.suggest-md').exists()).toBe(true);
    expect(wrapper.get('[data-testid="ai-suggest-result"]').text()).toContain('先补齐材料');
  });

  it('3 轻场景不出卡：带合法 card 也忽略（保持纯文本，不降级不进卡）', async () => {
    const lightScenes: AiSuggestScene[] = [
      'workbench.next-step',
      'workbench.risk-warning',
      'project.summary.refresh',
    ];
    for (const scene of lightScenes) {
      vi.mocked(aiSuggest).mockReset();
      vi.mocked(aiSuggest).mockResolvedValue(viewWith(precheckEnvelope, { scene }));
      const wrapper = mount(AiSuggest, { props: { scene } });

      await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid^="ai-card-"]').exists(), `${scene} 不应出卡`).toBe(false);
      expect(wrapper.find('.suggest-md').exists(), `${scene} 应保持纯文本`).toBe(true);
      expect(
        wrapper.find('[data-testid="ai-suggest-card-degraded"]').exists(),
        `${scene} 轻场景不进卡也非降级`,
      ).toBe(false);
    }
  });

  it('卡片 confirm 只接住留 hook：提示 P1-08 接线，本节点零提交逻辑', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(
      viewWith(precheckEnvelope, { scene: 'gate.precheck-checklist' }),
    );
    const wrapper = mount(AiSuggest, { props: { scene: 'gate.precheck-checklist' } });

    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');

    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]');
    expect(notice.text()).toContain('P1-08');
    // 零提交逻辑：除发起建议那次，confirm 不触发任何请求
    expect(aiSuggest).toHaveBeenCalledTimes(1);
  });
});

describe('AiSuggest 卡片 confirm 提交链（P1-08 C08 收口）', () => {
  /** gate.conclusion 否决票信封（AC-GATE-05：任一 REJECT ⇒ Gate REJECTED；decision=REJECT 为 gate_reviews 合法域值）。 */
  const rejectEnvelope: AiCardEnvelope = {
    type: 'gate.conclusion',
    version: 1,
    data: {
      gateCode: 'G1-TR',
      reviews: [{ reviewerType: 'MARKET_PM', decision: 'REJECT', opinion: '不通过', round: 1 }],
      passCount: 0,
      conditionalCount: 0,
      failCount: 1,
    },
    sourceRefs: { gate: '1' },
  };

  /**
   * 票面/要素反例信封（R232 修复①锁定）：reviews[].decision 直书 gate_reviews 域值
   * （APPROVE|REJECT|null 待签|ABSTAIN 弃权；null 超出 CardDynString 静态联合，运行期域值直书不窄化）。
   */
  function votesEnvelope(reviews: Array<null | string>, failCount: number): AiCardEnvelope {
    return {
      type: 'gate.conclusion',
      version: 1,
      data: {
        gateCode: 'G1-TR',
        reviews: reviews.map((decision) => ({
          reviewerType: 'MARKET_PM',
          decision,
          opinion: '意见',
          round: 1,
        })),
        passCount: 0,
        conditionalCount: 0,
        failCount,
      },
      sourceRefs: { gate: '1' },
    } as unknown as AiCardEnvelope;
  }

  /** 建议值直达防线：金额/评分/系数/删除/移交类槽位绝不允许出现在提交载荷里（方案 §5.1）。 */
  const FORBIDDEN_PAYLOAD_KEYS =
    /passCount|conditionalCount|failCount|reviews|elementId|responsiblePersonId|levelCoefficient|targetSalesAmount|targetNps/;

  let clipboardWrite: ReturnType<typeof vi.fn> = vi.fn();

  beforeEach(() => {
    vi.mocked(signGate).mockReset();
    // Ant Modal Teleport 渲染到 document.body，逐用例清场防串态（仓内惯例）
    document.body.innerHTML = '';
    // 剪贴板 mock 逐用例重装（happy-dom 的 navigator.clipboard 可能不存在）；
    // 测试环境按文件隔离且本 describe 位于文件末尾，故不设 afterEach 还原。
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
  });

  /** 挂载 + 发起建议 + 渲染卡片（4 结构化场景通用入口）。 */
  async function mountCard(scene: AiSuggestScene, envelope: AiCardEnvelope, entityId?: string) {
    vi.mocked(aiSuggest).mockResolvedValue(viewWith(envelope, { scene }));
    const wrapper = mount(AiSuggest, { props: { entityId, scene } });
    await wrapper.get('[data-testid="ai-suggest-run"]').trigger('click');
    await flushPromises();
    return wrapper;
  }

  /**
   * Click a sign-modal footer button (Ant Modal teleports to document.body; repo
   * convention, cf. operation/recovery-warnings.test.ts). Accepts semantic keys
   * ('confirm-sign' = primary ok button, 'cancel' = the other footer button) or a
   * literal button label (existing call sites keep their readable labels).
   */
  async function clickSignModalButton(label: string) {
    const btns = [...document.body.querySelectorAll('.ant-modal-footer button')];
    const btn = (
      label === 'confirm-sign'
        ? btns.find((b) => b.classList.contains('ant-btn-primary'))
        : label === 'cancel'
          ? btns.find((b) => !b.classList.contains('ant-btn-primary'))
          : btns.find((b) => (b.textContent ?? '').replace(/\s+/g, '').includes(label))
    ) as HTMLButtonElement | undefined;
    expect(btn, `sign modal footer should have button: ${label}`).toBeDefined();
    btn!.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();
  }

  it('confirm 后先弹签署确认弹层：明示可修改 + 预填 AI 草稿，未确认零调用（C08 人终审）', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');
    expect(document.body.querySelector('.ant-modal'), 'confirm 前不应有弹层').toBeNull();

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();

    const modal = document.body.querySelector('.ant-modal');
    expect(modal, 'confirm 后应先弹签署确认弹层').toBeTruthy();
    expect(modal?.textContent ?? '').toContain('以下内容将作为你的签署意见提交，可修改');
    // decision 预填 = 真实票推导结果；opinion 预填 = AI 结论草稿（可改可清空）
    expect(wrapper.findComponent({ name: 'ARadioGroup' }).props('value')).toBe('APPROVE');
    expect(wrapper.findComponent({ name: 'ATextarea' }).props('value')).toBe(okView.markdown.trim());
    expect(signGate).not.toHaveBeenCalled();
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('弹层确认后：恰一次既有签署端点调用，载荷无建议值直达字段', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    await clickSignModalButton('确认签署');

    expect(signGate).toHaveBeenCalledTimes(1);
    expect(signGate).toHaveBeenCalledWith('30001', 'APPROVE', okView.markdown.trim());
    expect(JSON.stringify(vi.mocked(signGate).mock.calls[0])).not.toMatch(FORBIDDEN_PAYLOAD_KEYS);
    expect(clipboardWrite).not.toHaveBeenCalled();
    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]').text();
    expect(notice).toContain('签署已提交');
    expect(notice).toContain('P1-08');
  });

  it('gate.conclusion 有否决票：decision=REJECT 由真实票（reviews[].decision）推导（AC-GATE-05），非 AI 生成值', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', rejectEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    await clickSignModalButton('确认签署');

    expect(signGate).toHaveBeenCalledTimes(1);
    expect(signGate).toHaveBeenCalledWith('30001', 'REJECT', okView.markdown.trim());
    expect(JSON.stringify(vi.mocked(signGate).mock.calls[0])).not.toMatch(FORBIDDEN_PAYLOAD_KEYS);
  });

  it('反例锁定：票面/要素不一致按真实票推导（failCount 与 decision 解耦，R232-1 修复①）', async () => {
    const cases: Array<{
      decision: GateDecision;
      failCount: number;
      name: string;
      reviews: Array<null | string>;
    }> = [
      {
        name: 'case-1 all-element-FAIL but all votes APPROVE => APPROVE',
        failCount: 2,
        reviews: ['APPROVE', 'APPROVE'],
        decision: 'APPROVE',
      },
      {
        name: 'case-2 failCount=0 but has REJECT vote => REJECT',
        failCount: 0,
        reviews: ['APPROVE', 'REJECT'],
        decision: 'REJECT',
      },
      {
        name: 'case-3a ABSTAIN votes do not affect derivation => APPROVE',
        failCount: 0,
        reviews: ['ABSTAIN', 'ABSTAIN'],
        decision: 'APPROVE',
      },
      {
        name: 'case-3b REJECT case-insensitive (reject) => REJECT',
        failCount: 0,
        reviews: ['ABSTAIN', 'reject'],
        decision: 'REJECT',
      },
    ];
    for (const testCase of cases) {
      vi.mocked(signGate).mockReset();
      const wrapper = await mountCard(
        'gate.conclusion-draft',
        votesEnvelope(testCase.reviews, testCase.failCount),
        '30001',
      );

      await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
      await flushPromises();
      expect(document.body.querySelector('.ant-modal'), `${testCase.name} should open sign modal`).toBeTruthy();
      expect(signGate, `${testCase.name} zero call before human confirm`).not.toHaveBeenCalled();
      await clickSignModalButton('confirm-sign');

      expect(signGate, testCase.name).toHaveBeenCalledTimes(1);
      expect(vi.mocked(signGate).mock.calls[0]?.[1], testCase.name).toBe(testCase.decision);
      wrapper.unmount();
      document.body.innerHTML = '';
    }
  });

  /**
   * 3c: null decision (pending-sign domain value of gate_reviews.decision) must be
   * skipped by derivation. Card dynText is null-safe since the ai-cards defect fix
   * (null renders as '—'); this case still enters the derivation entry
   * (openGateSignConfirm) directly to isolate derivation semantics from the
   * confirm-button flow covered by the modal cases below.
   */
  it('case-3c null pending votes do not affect derivation (direct entry for derivation isolation)', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');
    const setup = wrapper.vm.$ as unknown as {
      setupState: { openGateSignConfirm: (data: AiCardEnvelope['data']) => void };
    };

    // [null pending, ABSTAIN] => APPROVE (no REJECT vote)
    setup.setupState.openGateSignConfirm(votesEnvelope([null, 'ABSTAIN'], 0).data);
    await flushPromises();
    expect(document.body.querySelector('.ant-modal'), 'direct entry should also open sign modal').toBeTruthy();
    expect(wrapper.findComponent({ name: 'ARadioGroup' }).props('value')).toBe('APPROVE');
    await clickSignModalButton('confirm-sign');
    expect(signGate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signGate).mock.calls[0]?.[1]).toBe('APPROVE');

    // [null pending, REJECT] => REJECT (null vote must not mask a real REJECT vote)
    vi.mocked(signGate).mockReset();
    setup.setupState.openGateSignConfirm(votesEnvelope([null, 'REJECT'], 0).data);
    await flushPromises();
    expect(wrapper.findComponent({ name: 'ARadioGroup' }).props('value')).toBe('REJECT');
    await clickSignModalButton('confirm-sign');
    expect(signGate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signGate).mock.calls[0]?.[1]).toBe('REJECT');
  });

  it('弹层内改 decision/opinion 后确认：恰一次调用，载荷=修改后值（真人终审可改）', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    expect(signGate).not.toHaveBeenCalled();

    // 弹层内改 decision（预填 APPROVE → REJECT）与 opinion（AI 草稿 → 真人意见）
    await wrapper.findComponent({ name: 'ARadioGroup' }).vm.$emit('update:value', 'REJECT');
    await wrapper
      .findComponent({ name: 'ATextarea' })
      .vm.$emit('update:value', '真人复核意见：材料已补齐，同意通过');
    await clickSignModalButton('确认签署');

    expect(signGate).toHaveBeenCalledTimes(1);
    expect(signGate).toHaveBeenCalledWith('30001', 'REJECT', '真人复核意见：材料已补齐，同意通过');
  });

  it('弹层 opinion 可清空：清空后确认提交 opinion=undefined（AI 草稿不强塞）', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    await wrapper.findComponent({ name: 'ATextarea' }).vm.$emit('update:value', '');
    await clickSignModalButton('确认签署');

    expect(signGate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signGate).mock.calls[0]?.[2]).toBeUndefined();
  });

  it('弹层取消：零调用（人未终审不落签）', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', rejectEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    await clickSignModalButton('取消');

    expect(signGate).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="ai-suggest-card-notice"]').exists()).toBe(false);
  });

  it('防重复点击：弹层确认进行中重复点击不重复发起（signGate 恰一次）且卡区可见禁用', async () => {
    vi.mocked(signGate).mockImplementation(() => new Promise<never>(() => {}));
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    await clickSignModalButton('确认签署');
    await clickSignModalButton('确认签署');
    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');

    expect(signGate).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.card-host').classes()).toContain('card-host-busy');
  });

  it('签署失败：可见错误反馈不静默（ipdErrorText 透传后端原文）', async () => {
    vi.mocked(signGate).mockRejectedValue(
      new IpdRequestError('request failed', 500, 90001, 'http', '本轮签署已被拒绝（重复签署）'),
    );
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope, '30001');

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();
    await clickSignModalButton('确认签署');

    expect(signGate).toHaveBeenCalledTimes(1);
    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]').text();
    expect(notice).toContain('签署提交失败');
    expect(notice).toContain('本轮签署已被拒绝（重复签署）');
    expect(notice).toContain('P1-08');
  });

  it('gate.precheck confirm：预填复制降级（零请求零直写），建议值不直达生效', async () => {
    const wrapper = await mountCard('gate.precheck-checklist', precheckEnvelope);

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(clipboardWrite).toHaveBeenCalledWith(okView.markdown);
    expect(signGate).not.toHaveBeenCalled();
    expect(aiSuggest).toHaveBeenCalledTimes(1);
    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]').text();
    expect(notice).toContain('P1-08');
    expect(notice).toContain('评审要素判定');
    expect(notice).toContain('不直达生效');
  });

  it('project.charter confirm：预填复制降级（立项创建表单，系数/金额/评分类禁直达生效）', async () => {
    const wrapper = await mountCard('project.create.suggest', charterEnvelope);

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(signGate).not.toHaveBeenCalled();
    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]').text();
    expect(notice).toContain('立项创建');
    expect(notice).toContain('不直达生效');
  });

  it('demand.draft confirm：预填复制降级（需求受理入口由真人创建落表）', async () => {
    const wrapper = await mountCard('demand.create.from-requirement', draftEnvelope);

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(signGate).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="ai-suggest-card-notice"]').text()).toContain('需求受理');
  });

  it('mode!==suggest 防御保留：防御性忽略，不发任何请求', async () => {
    const autoModeEnvelope = {
      type: 'gate.precheck',
      version: 1,
      data: {
        gateCode: 'G1-TR',
        round: 1,
        reviewCount: 1,
        totalElements: 1,
        items: [
          { elementId: 1, result: 'PASS', conditionNote: '材料齐备', evidenceRef: 'EV-1', leftoverStatus: 'NONE' },
        ],
        mode: 'auto',
      },
      sourceRefs: { gate: '1' },
    } as unknown as AiCardEnvelope;
    const wrapper = await mountCard('gate.precheck-checklist', autoModeEnvelope);

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();

    expect(signGate).not.toHaveBeenCalled();
    expect(clipboardWrite).not.toHaveBeenCalled();
    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]').text();
    expect(notice).toContain('防御');
    expect(notice).toContain('P1-08');
  });

  it('gate.conclusion 缺 entityId：可见失败提示且不发起请求（不硬闯）', async () => {
    const wrapper = await mountCard('gate.conclusion-draft', conclusionEnvelope);

    await wrapper.get('[data-testid="ai-card-confirm"]').trigger('click');
    await flushPromises();

    expect(signGate).not.toHaveBeenCalled();
    const notice = wrapper.get('[data-testid="ai-suggest-card-notice"]').text();
    expect(notice).toContain('签署提交失败');
    expect(notice).toContain('entityId');
    expect(notice).toContain('P1-08');
  });
});
