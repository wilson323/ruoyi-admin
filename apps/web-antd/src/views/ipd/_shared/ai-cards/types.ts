/**
 * AI 建议卡片 · 类型骨架（P1-05，R1 类型骨架作者控制）。
 *
 * <p>契约来源（唯一 schema 事实源）：system_configs 行 config_key='ai.suggest.cardCatalog'
 * 的 config_value（catalogVersion=1，2026-09-27 入库）。4 个 data interface 的字段名与
 * 数量和 Catalog 的 fields/itemFields 逐字段一一对应（P1-04 对账哨兵）——
 * **多一个少一个都算失败**；增删字段必须先改后端 Catalog 再同步本文件，禁单侧改动。
 *
 * <p>DynString 陷阱防御（CopilotKit A2UI 官方警告）：凡绑定到数据模型的 prop 都可能以
 * `{ path: '/xxx' }` 绑定对象而非字面量到达，声明成纯 string 会让绑定对象直达渲染层崩溃
 * 且报错不指向 schema。故 Catalog 中 type='string' 的数据槽位一律取 {@link CardDynString}
 * 联合（绑定型宁宽勿窄）；type='number' 槽位保持 number，与 Catalog 类型名一一对应。
 *
 * <p>信封四键 type/version/data/sourceRefs 与后端响应 card 字段（P1-02）逐字对齐；
 * sourceRefs 承载 R3 铁律（卡片数值必须回读 sourceRefs 指向的业务表真实记录，
 * 不得用 LLM 复述值兜底渲染）。
 */

/** 绑定型字符串槽位：字面量 或 数据模型路径绑定（DynString 陷阱防御，宁宽勿窄）。 */
export type CardDynString = string | { path: string };

/** 触发场景（= Catalog cards[].scene；7 场景白名单中的 4 个结构化场景）。 */
export type AiCardScene =
  | 'demand.create.from-requirement'
  | 'gate.conclusion-draft'
  | 'gate.precheck-checklist'
  | 'project.create.suggest';

/** gate.precheck.items[] 槽位（= Catalog itemFields）。 */
export interface GatePrecheckItemData {
  /** 要素 id（gate_review_elements）。 */
  elementId: number;
  /** 要素评审结果。 */
  result: CardDynString;
  /** 条件说明。 */
  conditionNote: CardDynString;
  /** 证据引用。 */
  evidenceRef: CardDynString;
  /** 遗留状态。 */
  leftoverStatus: CardDynString;
}

/** gate.precheck（预检卡，shape=checklist）data 槽位（= Catalog fields）。 */
export interface GatePrecheckCardData {
  /** 门禁编号。 */
  gateCode: CardDynString;
  /** 评审轮次。 */
  round: number;
  /** 评审单数量。 */
  reviewCount: number;
  /** 要素总数。 */
  totalElements: number;
  /** 要素预检明细。 */
  items: GatePrecheckItemData[];
}

/** gate.conclusion.reviews[] 槽位（= Catalog itemFields）。 */
export interface GateConclusionReviewData {
  /** 评审人类型。 */
  reviewerType: CardDynString;
  /** 评审判定。 */
  decision: CardDynString;
  /** 评审意见。 */
  opinion: CardDynString;
  /** 评审轮次。 */
  round: number;
}

/** gate.conclusion（判定卡，shape=decision）data 槽位（= Catalog fields）。 */
export interface GateConclusionCardData {
  /** 门禁编号。 */
  gateCode: CardDynString;
  /** 各评审单判定汇总。 */
  reviews: GateConclusionReviewData[];
  /** 通过票数。 */
  passCount: number;
  /** 有条件通过票数。 */
  conditionalCount: number;
  /** 不通过票数。 */
  failCount: number;
}

/** project.charter（对比卡，shape=compare）data 槽位（= Catalog fields）。 */
export interface ProjectCharterCardData {
  /** 上下文项目 id。 */
  contextProjectId: number;
  /** 上下文项目编号。 */
  contextProjectCode: CardDynString;
  /** 上下文项目名称。 */
  contextProjectName: CardDynString;
  /** 上下文项目当前阶段。 */
  contextCurrentStage: CardDynString;
  /** 上下文产品 id。 */
  contextProductId: number;
}

/** demand.draft.requirements[] 槽位（= Catalog itemFields）。 */
export interface DemandDraftRequirementData {
  /** 来源需求 id。 */
  requirementId: number;
  /** 需求标题。 */
  title: CardDynString;
  /** 需求状态。 */
  status: CardDynString;
  /** 需求来源。 */
  source: CardDynString;
}

/** demand.draft（草稿卡，shape=draft）data 槽位（= Catalog fields）。 */
export interface DemandDraftCardData {
  /** 上下文项目 id。 */
  contextProjectId: number;
  /** 上下文项目编号。 */
  contextProjectCode: CardDynString;
  /** 上下文项目名称。 */
  contextProjectName: CardDynString;
  /** 来源需求草稿明细。 */
  requirements: DemandDraftRequirementData[];
}

/** 卡片类型（= Catalog cards[].type；与 P1-06 四组件按 shape 一一对应）。 */
export type AiCardType =
  | 'demand.draft'
  | 'gate.conclusion'
  | 'gate.precheck'
  | 'project.charter';

/** 4 卡 data 的联合（信封默认数据形态）。 */
export type AiCardData =
  | DemandDraftCardData
  | GateConclusionCardData
  | GatePrecheckCardData
  | ProjectCharterCardData;

/**
 * Card 信封（= 后端响应 card 字段，P1-02；四键逐字对齐 Catalog 信封定义）。
 *
 * @typeParam TData - 卡片 data 形态，默认 4 卡联合。
 */
export interface AiCardEnvelope<TData = AiCardData> {
  /** 卡片类型（= Catalog cards[].type）。 */
  type: string;
  /** schema 版本，注册表按 (type, version) 匹配。 */
  version: number;
  /** 卡片数据（字段与该 type 的 Catalog fields 逐项对齐）。 */
  data: TData;
  /** R3 事实源引用（键值对齐各卡 Catalog sourceRefs 清单）。 */
  sourceRefs: Record<string, number | string | string[]>;
}
