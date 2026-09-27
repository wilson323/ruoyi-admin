/**
 * AI 建议卡片注册表骨架（P1-05，R1 类型骨架作者控制）。
 *
 * <p>职责：type → (scene, shape, 渲染组件) 的唯一映射点；本节点只落注册表骨架与
 * 类型映射，渲染组件（_shared/ai-cards/<type>.vue ×4）由 P1-06 静态 import 注册
 * （执行计划 §5：静态 import 注册表，禁动态拼路径）。
 *
 * <p>type→shape 映射与后端 Catalog（system_configs 'ai.suggest.cardCatalog'）一致：
 * gate.precheck→checklist（清单）、gate.conclusion→decision（判定）、
 * project.charter→compare（对比）、demand.draft→draft（草稿）——
 * 与 P1-06 四组件一一对应；version 与 Catalog cards[].version 对齐，
 * 消费方按 (type, version) 匹配，不匹配视为未知卡降级文本路径。
 *
 * <p>降级铁律：注册表查不到的 (type, version) 一律回退纯文本建议
 * （卡片层是增强不是依赖，文本降级路径永不删）。
 */
import type { Component } from 'vue';

import type { AiCardScene, AiCardType } from './types';

/** 卡片形状（= Catalog cards[].shape；与 P1-06 四组件一一对应）。 */
export type CardShape = 'checklist' | 'compare' | 'decision' | 'draft';

/** 注册表条目：卡片类型的元信息 + 渲染组件槽位。 */
export interface CardTypeEntry {
  /** 卡片类型（= Catalog cards[].type）。 */
  type: AiCardType;
  /** schema 版本（= Catalog cards[].version），按 (type, version) 匹配。 */
  version: number;
  /** 触发场景（= Catalog cards[].scene）。 */
  scene: AiCardScene;
  /** 形状（= Catalog cards[].shape），决定 P1-06 渲染组件形态。 */
  shape: CardShape;
  /**
   * 渲染组件槽位：P1-06 落地时以静态 import 注册；
   * 缺席时消费方必须降级纯文本路径（禁动态拼组件路径）。
   */
  component?: Component;
}

/** 卡片类型注册表（唯一事实源；新增卡片类型 = Catalog + 本表 + interface 三处同步）。 */
export const CARD_REGISTRY: Readonly<Record<AiCardType, CardTypeEntry>> = {
  'demand.draft': {
    type: 'demand.draft',
    version: 1,
    scene: 'demand.create.from-requirement',
    shape: 'draft',
  },
  'gate.conclusion': {
    type: 'gate.conclusion',
    version: 1,
    scene: 'gate.conclusion-draft',
    shape: 'decision',
  },
  'gate.precheck': {
    type: 'gate.precheck',
    version: 1,
    scene: 'gate.precheck-checklist',
    shape: 'checklist',
  },
  'project.charter': {
    type: 'project.charter',
    version: 1,
    scene: 'project.create.suggest',
    shape: 'compare',
  },
};

/** 类型守卫：string → AiCardType（信封 type 是 string，消费前先收窄）。 */
export function isCardType(type: string): type is AiCardType {
  return Object.prototype.hasOwnProperty.call(CARD_REGISTRY, type);
}

/**
 * 按 (type, version) 查注册表条目。
 *
 * @param type - 卡片类型（信封 type 原文）
 * @param version - schema 版本；传入且与注册条目不符时视为未知卡（返回 undefined）
 * @returns 命中的条目；未知 (type, version) 返回 undefined（消费方降级文本路径）
 */
export function getCardType(
  type: string,
  version?: number,
): CardTypeEntry | undefined {
  if (!isCardType(type)) return undefined;
  const entry: CardTypeEntry = CARD_REGISTRY[type];
  if (version !== undefined && entry.version !== version) return undefined;
  return entry;
}

/** 列出全部注册条目（type 字典序，供分发层与对账哨兵遍历）。 */
export function listCardTypes(): CardTypeEntry[] {
  return Object.values(CARD_REGISTRY).sort((a, b) =>
    a.type.localeCompare(b.type),
  );
}
