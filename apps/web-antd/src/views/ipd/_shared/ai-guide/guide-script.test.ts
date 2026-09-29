/**
 * 引导帧解析纯函数测试（C4a）：AG-UI 帧 → 步骤 VM / 门禁 VM / chips / pageContext 摘要。
 *
 * 契约：C2 在 GET /guide-events 的 STATE_DELTA op.value 增 guideSteps/advanceGate 两键
 * （Track C C2.4 wire 形状）；后端 C2 并行开发中，此处按契约 mock 帧形状先行（类型先行）。
 * IPD 目录下的测试文件已被 vitest 白名单纳入（配置无需改动）。
 */
import { describe, expect, it } from 'vitest';

import type { GuideEvent } from '../../../../api/ipd/guide-script';
import {
  buildGuideContextValue,
  buildGuideSuggestions,
  extractGuideText,
  parseAdvanceGate,
  parseGuideSteps,
  MAX_CONTEXT_CHARS,
} from './guide-script';

const EVENTS: GuideEvent[] = [
  { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
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
          ],
          advanceGate: {
            nextSubStageCode: 'CONCEPT-S2', advanceAllowed: false, pendingBlockingCodes: ['C12'],
          },
        },
      },
    ],
  },
];

/** 单步 VM 样本（多步骤/无技能变体从它派生，防重复长字面量）。 */
function stepSample(): ReturnType<typeof parseGuideSteps>[number] {
  return parseGuideSteps(EVENTS)[0]!;
}

describe('guide-script 纯函数', () => {
  it('parseGuideSteps：STATE_DELTA → 步骤 VM（字段全量映射）', () => {
    const steps = parseGuideSteps(EVENTS);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      actionCode: 'C01', bindLevel: 'BIND', stepState: 'PENDING', blocking: true,
    });
    expect(steps[0]!.degradedSteps[0]!.stepPrompt).toBe('准备访谈提纲');
    expect(steps[0]!.skillNames).toEqual(['interview-script']);
    expect(steps[0]!.commandChain).toEqual(['/interview prep']);
  });

  it('parseAdvanceGate：门禁视图映射；无 STATE_DELTA → null', () => {
    expect(parseAdvanceGate(EVENTS)).toEqual({
      nextSubStageCode: 'CONCEPT-S2', advanceAllowed: false, pendingBlockingCodes: ['C12'],
    });
    expect(parseAdvanceGate([{ type: 'RUN_FINISHED' }])).toBeNull();
  });

  it('extractGuideText：TEXT_MESSAGE_CONTENT delta 拼接', () => {
    expect(extractGuideText(EVENTS)).toContain('共 2 个动作');
  });

  it('buildGuideSuggestions：默认 3 条、含技能名、无技能动作标结构化登记', () => {
    const chips = buildGuideSuggestions(parseGuideSteps(EVENTS));
    expect(chips[0]).toContain('市场机会与痛点调研');
    expect(chips[0]).toContain('interview-script');
    const noSkill = buildGuideSuggestions([{ ...stepSample(), skillNames: [] }]);
    expect(noSkill[0]).toContain('（结构化登记）');
    expect(noSkill[0]).not.toContain('interview-script');
  });

  it('buildGuideContextValue：JSON 可解析且超 4000 截断', () => {
    const value = buildGuideContextValue('CONCEPT-S1', parseGuideSteps(EVENTS)[0]!);
    expect(JSON.parse(value).currentAction.actionCode).toBe('C01');
    const long = buildGuideContextValue(
      'CONCEPT-S1',
      { ...parseGuideSteps(EVENTS)[0]!, guidePrompt: 'x'.repeat(5000) },
    );
    expect(long.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it('非法帧（非对象/错键）不崩、返回空', () => {
    const bad: GuideEvent[] = [{ type: 'STATE_DELTA', delta: [{ path: '/other', value: 1 }] }, { type: 'X' }];
    expect(parseGuideSteps(bad)).toEqual([]);
    expect(parseAdvanceGate(bad)).toBeNull();
  });

  it('buildGuideSuggestions：多步骤按序号 1..n 排布，limit 截断', () => {
    const steps = [1, 2, 3].map((n) => ({
      ...stepSample(),
      actionCode: `A${n}`,
      actionName: `动作${n}`,
      sortOrder: n,
    }));
    const chips = buildGuideSuggestions(steps);
    expect(chips.map((chip) => chip.slice(0, 2))).toEqual(['1.', '2.', '3.']);
    expect(buildGuideSuggestions(steps, 2)).toHaveLength(2);
  });
});
