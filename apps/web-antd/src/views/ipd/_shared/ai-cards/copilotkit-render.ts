/**
 * CopilotKit 生成式 UI 渲染层适配（单轨融合 2026-09-28）。
 *
 * <p>契约 SSOT：docs/copilotkit单轨融合契约-20260928.md（Runtime 面 / 四帧→AG-UI 映射 /
 * 渲染映射三张对账表）。本文件只做「渲染层挂载」：把 ai-cards 注册表 4 组件注册为
 * `useRenderTool` 渲染器 + `useDefaultRenderTool()` 通配兜底，**不新建聊天窗口**、
 * **不建平行卡片体系**（渲染器 = 注册表组件原样复用）、**文本降级路径永不删**
 * （未命中注册表/信封非法一律回退纯文本提示，与既有降级铁律同口径）。
 *
 * <p>AG-UI 侧事实源（探针③，契约 §4/§5 对账表）：
 * - `done+card` → TOOL_CALL_START(name=card.type) + TOOL_CALL_ARGS(delta=card.data JSON)
 *   + TOOL_CALL_END + TOOL_CALL_RESULT(content=JSON {version, sourceRefs}）；
 * - useRenderTool 渲染 props = `{name, toolCallId, status, parameters, result?}`
 *   （@copilotkit/vue@1.74.0 dist/v2/hooks/use-render-tool.d.ts 实证；RenderToolProps
 *   未从包顶层导出，此处以本地结构化等价类型承接，props 形态由同名单测钉死）；
 * - 参数 schema 取宽松 `z.record(z.string(), z.unknown())`：数据形态 SSOT 仍是
 *   types.ts/Catalog，不在此再造第 4 面 schema 镜像（防镜像漂移）。
 *
 * <p>降级铁律（契约 §5）：complete 前（result 未达、无法完成 (type, version) 过检）
 * 只出占位；result 元数据缺失/非法、(type, version) 未命中注册表、data 非对象——
 * 一律纯文本降级（文字提示 + 对话继续），绝不带病渲染。
 *
 * <p>R2/R3 过检（schema 外字段丢弃 / sourceRefs 对账）仍由 ai-assistant.vue 的
 * enforceCardRenderRules 在四帧通道执行；本层**不复制**该校验逻辑（宿主注记：禁复制
 * 校验逻辑防双轨），CopilotKit 路径的 R2/R3 镜像接入见契约 §7 遗留项。
 */
import type { Component, PropType, VNodeChild } from 'vue';

import { defineComponent, h } from 'vue';

import { useDefaultRenderTool, useRenderTool } from '@copilotkit/vue/v2';
import { getActivePinia } from 'pinia';
import { z } from 'zod';

import { useIpdAuthStore } from '../../../../store/ipd-auth';

import { getCardType, listCardTypes } from './card-registry';
import type { AiCardData } from './types';

/** useRenderTool 渲染器生命周期（= RenderToolProps['status'] 字面量联合）。 */
export type CardToolStatus = 'complete' | 'executing' | 'inProgress';

/**
 * useRenderTool 渲染 props 本地等价形态（探针③对账表左列）。
 *
 * <p>与 @copilotkit/vue RenderToolProps 判别联合结构等价（name/toolCallId 全态恒在；
 * inProgress|executing 时 result=undefined、parameters 为流中部分参数；complete 时
 * parameters 全量、result 为工具结果字符串）。包未导出 RenderToolProps，此处钉死。
 */
export interface CardToolRenderProps {
  /** 工具名（= AG-UI TOOL_CALL_START.toolCallName = card.type，注册表查找键）。 */
  name: string;
  /** 工具参数（= TOOL_CALL_ARGS JSON.parse(card.data)，映射组件 `data` prop）。 */
  parameters: Record<string, unknown>;
  /** 工具结果（= TOOL_CALL_RESULT.content JSON 串；complete 前为 undefined）。 */
  result?: string | undefined;
  /** 生命周期阶段（inProgress 参数流中 / executing 参数齐 / complete 结果达）。 */
  status: CardToolStatus;
  /** 工具调用唯一 id（= TOOL_CALL_START.toolCallId；渲染 key，不进组件 props）。 */
  toolCallId: string;
}

/** TOOL_CALL_RESULT content 解析结果（= 四键信封的 version/sourceRefs 两键，契约 §4）。 */
export interface CardToolResultMeta {
  /** R3 事实源引用（= card.sourceRefs）。 */
  sourceRefs: Record<string, unknown>;
  /** schema 版本（= card.version，注册表按 (type, version) 匹配）。 */
  version: number;
}

/** 渲染决策（纯函数输出）：占位 / 纯文本降级 / 命中注册表组件。 */
export type CardToolRenderDecision =
  | { component: Component; data: AiCardData; kind: 'card' }
  | { kind: 'pending' }
  | { kind: 'fallback'; text: string };

/**
 * 参数 schema（宽松 record）：只约束「对象」这一层，字段形态由注册表/渲染层按
 * (type, version) 适配——不复制 types.ts/Catalog 镜像（防第 4 面 schema 漂移）。
 */
export const CARD_TOOL_PARAMETERS_SCHEMA = z.record(z.string(), z.unknown());

/** 运行期对象判别（api/ipd 防御性解析同款形态；不 import 私有函数防双轨）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * TOOL_CALL_RESULT content 解析（纯函数）：`JSON.stringify({version, sourceRefs})` 的
 * 逆向。缺失/非法（非 JSON、非对象、version 非有限数字、sourceRefs 非对象）返回 null
 * ——调用方降级纯文本（防御性降级，不抛错不断对话流）。
 */
export function parseCardToolResult(
  raw: null | string | undefined,
): CardToolResultMeta | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  const { sourceRefs, version } = parsed;
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;
  if (!isPlainRecord(sourceRefs)) return null;
  return { sourceRefs, version };
}

/**
 * 渲染决策（纯函数）：探针③对账表的裁决面。
 *
 * - `status !== 'complete'`：result 未达、(type, version) 过检无法完成 → 占位
 *   （useRenderTool 官方 guard-on-status 口径，参数流中不提前出卡）；
 * - complete：result 元数据解析 → (type, version) 注册表命中（降级铁律）→ data 形态
 *   最小校验 → 出卡；任一不过 → 纯文本降级（文本路径永不删）。
 */
export function resolveCardToolRender(
  props: CardToolRenderProps,
): CardToolRenderDecision {
  if (props.status !== 'complete') return { kind: 'pending' };
  const meta = parseCardToolResult(props.result);
  if (!meta) {
    return {
      kind: 'fallback',
      text: `卡片元数据缺失或非法（type=${props.name} toolCallId=${props.toolCallId}），已降级纯文本，对话继续`,
    };
  }
  const entry = getCardType(props.name, meta.version);
  if (!entry?.component) {
    return {
      kind: 'fallback',
      text: `未知卡片（type=${props.name} version=${meta.version}）未命中注册表，已降级纯文本，对话继续`,
    };
  }
  if (!isPlainRecord(props.parameters)) {
    return {
      kind: 'fallback',
      text: `卡片数据非法（type=${props.name}），已降级纯文本，对话继续`,
    };
  }
  return {
    component: entry.component,
    data: props.parameters as unknown as AiCardData,
    kind: 'card',
  };
}

/**
 * useRenderTool 渲染函数（props 对账表右列接线）：
 * `parameters` → 组件 `data` prop；`confirm` emit → 宿主 onConfirm（C08 零直写：
 * 只收组件 emit，本层无任何写库/请求路径）；`name`/`toolCallId`/`status`/`result`
 * 全部为过检与渲染 key 用，不进组件 props。
 */
export function renderCardToolCall(
  props: CardToolRenderProps,
  onConfirm?: (payload: AiCardData) => void,
): VNodeChild {
  const decision = resolveCardToolRender(props);
  if (decision.kind === 'pending') {
    return h(
      'div',
      { class: 'ipd-ai-card-notice', 'data-testid': 'ipd-cpk-card-pending' },
      `正在渲染结构化卡片（${props.name}）…`,
    );
  }
  if (decision.kind === 'fallback') {
    return h(
      'div',
      { class: 'ipd-ai-card-notice', 'data-testid': 'ipd-cpk-card-degraded' },
      decision.text,
    );
  }
  return h(decision.component, {
    data: decision.data,
    onConfirm: onConfirm
      ? (payload: AiCardData) => onConfirm(payload)
      : undefined,
  });
}

/** 渲染层选项（宿主接线口；confirm 只收不写，C08）。 */
export interface IpdAiCardRenderOptions {
  /** 卡片 confirm 回调（= 组件 confirm emit 转发；缺省仅渲染不接 confirm）。 */
  onConfirm?: (payload: AiCardData) => void;
}

/**
 * 4 卡渲染器注册（须在 CopilotKitProvider 内组件 setup 调用）：
 * 按注册表逐 type 注册 `useRenderTool`（name = card.type，探针③实证渲染器按 name
 * 匹配、无 agentId 时匹配任意 agent 的同名调用）+ `useDefaultRenderTool()` 通配兜底
 * （未注册 tool name 一律走 CopilotKit 内置默认卡，不裸渲染）。
 */
export function useIpdAiCardRenderers(
  options: IpdAiCardRenderOptions = {},
): void {
  for (const entry of listCardTypes()) {
    useRenderTool({
      name: entry.type,
      parameters: CARD_TOOL_PARAMETERS_SCHEMA,
      render: (props: CardToolRenderProps) =>
        renderCardToolCall(props, options.onConfirm),
    });
  }
  useDefaultRenderTool();
}

/**
 * 鉴权 headers（对齐既有 Bearer 方案：token 走 header，URL 不收 token；无 token
 * 不发 Authorization 键——与 api/ipd/ai-copilot.ts streamCopilot 同口径）。
 */
export function copilotKitAuthHeaders(): Record<string, string> {
  // 防御：Provider 将 headers 函数包进 computed 且 setup 期即求值，宿主测试/SSR/
  // 多实例边界可能无 active pinia——无 token 上下文即不发 Authorization 键，
  // 与「无 token」同口径降级（不抛错不断挂载）。
  if (!getActivePinia()) return {};
  const token = useIpdAuthStore().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 渲染层挂载宿主（renderless）：挂在 CopilotKitProvider 内承接渲染器注册。
 * useRenderTool 依赖 provider context（inject），故不可在 provider 同级 setup 调用，
 * 由本宿主作为 provider 子组件完成注册（契约 §5）。
 */
export const IpdAiCardRenderHost = defineComponent({
  name: 'IpdAiCardRenderHost',
  props: {
    onConfirm: {
      required: false,
      type: Function as PropType<(payload: AiCardData) => void>,
    },
  },
  setup(props) {
    useIpdAiCardRenderers({
      onConfirm: props.onConfirm
        ? (payload: AiCardData) => props.onConfirm?.(payload)
        : undefined,
    });
    return () => null;
  },
});
