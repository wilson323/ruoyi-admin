/**
 * CopilotKit 渲染层适配纯函数测试（单轨融合 2026-09-28，契约 §5 对账表裁决面）。
 *
 * <p>覆盖：TOOL_CALL_RESULT 元数据解析（parseCardToolResult）、渲染决策降级铁律
 * （resolveCardToolRender：complete 前占位 / 未知 (type, version) 纯文本降级 /
 * data 非法降级 / 命中出卡）、渲染函数 props 接线（renderCardToolCall：
 * parameters→data prop、confirm emit→onConfirm 转发、占位/降级文案）。
 *
 * <p>useIpdAiCardRenderers / IpdAiCardRenderHost 依赖 CopilotKitProvider context
 * （composable 须在 provider 内 setup 调用），单测不挂 provider——注册面由
 * check:type + build + 契约 §5 钉死，round-trip 呈现由 proof 子代理闭环。
 */
import { describe, expect, it, vi } from 'vitest';

import type { VNode } from 'vue';

import { CARD_REGISTRY, getCardType } from './card-registry';
import {
  copilotKitAuthHeaders,
  parseCardToolResult,
  renderCardToolCall,
  resolveCardToolRender,
  type CardToolRenderProps,
} from './copilotkit-render';
import type { GatePrecheckCardData } from './types';

/** 完整 gate.precheck data（字段面与 types.ts Catalog 对齐，见 card-registry.test.ts）。 */
const PRECHECK_DATA: GatePrecheckCardData = {
  gateCode: 'G1',
  items: [
    {
      conditionNote: 'ok',
      elementId: 101,
      evidenceRef: 'EV-1',
      leftoverStatus: 'NONE',
      result: 'PASS',
    },
  ],
  reviewCount: 1,
  round: 1,
  totalElements: 1,
};

/** 构造 useRenderTool 渲染 props（对账表左列形态）。 */
function toolProps(
  overrides: Partial<CardToolRenderProps> = {},
): CardToolRenderProps {
  return {
    name: 'gate.precheck',
    parameters: PRECHECK_DATA as unknown as Record<string, unknown>,
    result: JSON.stringify({
      sourceRefs: { elementResultIds: [1], gateId: 1, reviewIds: [2] },
      version: 1,
    }),
    status: 'complete',
    toolCallId: 'tc-1',
    ...overrides,
  };
}

describe('copilotkit-render/parseCardToolResult', () => {
  it('合法 {version, sourceRefs} JSON → 解析通过', () => {
    const meta = parseCardToolResult(JSON.stringify({ sourceRefs: { a: 1 }, version: 1 }));
    expect(meta).toEqual({ sourceRefs: { a: 1 }, version: 1 });
  });

  it('缺失 / 空串 / 非 JSON / 非对象 → null（防御性降级）', () => {
    expect(parseCardToolResult(undefined)).toBeNull();
    expect(parseCardToolResult(null)).toBeNull();
    expect(parseCardToolResult('')).toBeNull();
    expect(parseCardToolResult('not-json')).toBeNull();
    expect(parseCardToolResult(JSON.stringify([1]))).toBeNull();
    expect(parseCardToolResult(JSON.stringify('str'))).toBeNull();
  });

  it('version 非有限数字 / sourceRefs 非对象 → null', () => {
    expect(parseCardToolResult(JSON.stringify({ sourceRefs: {}, version: '1' }))).toBeNull();
    expect(parseCardToolResult(JSON.stringify({ sourceRefs: {}, version: Number.NaN }))).toBeNull();
    expect(parseCardToolResult(JSON.stringify({ sourceRefs: [], version: 1 }))).toBeNull();
    expect(parseCardToolResult(JSON.stringify({ version: 1 }))).toBeNull();
  });
});

describe('copilotkit-render/resolveCardToolRender（降级铁律）', () => {
  it('inProgress / executing（result 未达）→ pending 占位，不提前出卡', () => {
    expect(resolveCardToolRender(toolProps({ status: 'inProgress' }))).toEqual({
      kind: 'pending',
    });
    expect(
      resolveCardToolRender(toolProps({ result: undefined, status: 'executing' })),
    ).toEqual({ kind: 'pending' });
  });

  it('complete + (type, version) 命中注册表 → 出卡（component = 注册表组件，data = parameters）', () => {
    const decision = resolveCardToolRender(toolProps());
    expect(decision.kind).toBe('card');
    if (decision.kind !== 'card') return;
    expect(decision.component).toBe(CARD_REGISTRY['gate.precheck'].component);
    expect(decision.data).toBe(PRECHECK_DATA);
  });

  it('未知 type → 纯文本降级（文本路径永不删）', () => {
    const decision = resolveCardToolRender(toolProps({ name: 'unknown.card' }));
    expect(decision.kind).toBe('fallback');
    if (decision.kind !== 'fallback') return;
    expect(decision.text).toContain('未命中注册表');
    expect(decision.text).toContain('unknown.card');
  });

  it('version 不匹配注册表 → 纯文本降级（(type, version) 铁律）', () => {
    const decision = resolveCardToolRender(
      toolProps({
        result: JSON.stringify({ sourceRefs: {}, version: 2 }),
      }),
    );
    expect(decision.kind).toBe('fallback');
    expect(getCardType('gate.precheck', 2)).toBeUndefined();
  });

  it('result 元数据缺失/非法 → 纯文本降级', () => {
    for (const result of [undefined, '', 'bad', JSON.stringify({ version: 1 })]) {
      const decision = resolveCardToolRender(toolProps({ result }));
      expect(decision.kind, `result=${String(result)}`).toBe('fallback');
      if (decision.kind === 'fallback') {
        expect(decision.text).toContain('卡片元数据缺失或非法');
      }
    }
  });

  it('data（parameters）非对象 → 纯文本降级', () => {
    for (const parameters of [null, 'str', [1], 42]) {
      const decision = resolveCardToolRender(
        toolProps({ parameters: parameters as unknown as Record<string, unknown> }),
      );
      expect(decision.kind, `parameters=${String(parameters)}`).toBe('fallback');
      if (decision.kind === 'fallback') {
        expect(decision.text).toContain('卡片数据非法');
      }
    }
  });
});

describe('copilotkit-render/renderCardToolCall（props 对账表接线）', () => {
  it('pending → 占位 div（data-testid=ipd-cpk-card-pending）', () => {
    const vn = renderCardToolCall(toolProps({ status: 'inProgress' })) as VNode;
    expect(vn.type).toBe('div');
    expect(vn.props?.['data-testid']).toBe('ipd-cpk-card-pending');
    expect(String(vn.children)).toContain('gate.precheck');
  });

  it('fallback → 降级纯文本 div（data-testid=ipd-cpk-card-degraded）', () => {
    const vn = renderCardToolCall(
      toolProps({ name: 'unknown.card' }),
    ) as VNode;
    expect(vn.type).toBe('div');
    expect(vn.props?.['data-testid']).toBe('ipd-cpk-card-degraded');
    expect(String(vn.children)).toContain('unknown.card');
  });

  it('card → 注册表组件 vnode：parameters 映射 data prop，confirm 事件转 onConfirm（C08 只收不写）', () => {
    const onConfirm = vi.fn();
    const vn = renderCardToolCall(toolProps(), onConfirm) as VNode;
    expect(vn.type).toBe(CARD_REGISTRY['gate.precheck'].component);
    expect(vn.props?.data).toBe(PRECHECK_DATA);
    const payload = { ...PRECHECK_DATA };
    (vn.props?.onConfirm as (p: unknown) => void)(payload);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(payload);
  });

  it('card + 无 onConfirm → 渲染照常，confirm 转发槽为 undefined', () => {
    const vn = renderCardToolCall(toolProps()) as VNode;
    expect(vn.type).toBe(CARD_REGISTRY['gate.precheck'].component);
    expect(vn.props?.onConfirm).toBeUndefined();
  });
});

describe('copilotKitAuthHeaders（鉴权降级口径）', () => {
  it('无 active pinia（测试/SSR/多实例边界）不抛错，降级为空 headers', () => {
    expect(copilotKitAuthHeaders()).toEqual({});
  });
});
