/**
 * Gate 评审材料 AI 预审 + 仲裁分歧点汇总接口（AI-P2-1，后端 GatePrecheckController）。
 *
 * 真值：POST /api/v1/gates/{gateId}/precheck 与 POST /api/v1/gates/{gateId}/arbitration-divergences
 * （2026-09-27 磁盘核实 GatePrecheckController.java + GatePrecheckService.java）。
 * 契约要点：
 * - code=0 包络走 ipdPost；ID 一律字符串（大整数 BigNumberSerializer 保真）；
 * - 返回「已覆盖/部分/缺失 + 证据定位 + AI 参考清单」结构化统计（确定性代码算）；
 * - 卡面硬约束自证旗标恒为 blocking=false / decisionWritten=false：只读参考，
 *   不写 Gate 决策、不阻塞评审；
 * - 权限=评审参与人（ipd:gate-review:list 注解层 + 项目成员对象层，非参与人 403）；
 * - 材料全空（无要素判定且无交付物）后端 400 fail-closed，前端透出文案即可。
 */
import { ipdPost } from './http';

/** 要素覆盖状态（后端由 GateElementResult.result 映射：PASS→COVERED / CONDITIONAL→PARTIAL / 其余→MISSING）。 */
export type GatePrecheckItemStatus = 'COVERED' | 'MISSING' | 'PARTIAL';

/** 单要素预审行（后端 items[]；证据定位有什么给什么，空则 null）。 */
export interface GatePrecheckItem {
  /** 条件说明（GateElementResult.conditionNote，空为 null）。 */
  conditionNote: null | string;
  /** 判定证据附件引用（GateElementResult.evidenceRef，空为 null）。 */
  evidenceRef: null | string;
  /** 要素 id（后端 String.valueOf(elementId)，字符串 ID 契约）。 */
  elementId: string;
  /** 遗留状态（GateElementResult.leftoverStatus，空为 null）。 */
  leftoverStatus: null | string;
  /** 要素原始判定结果（PASS / FAIL / PASS_WITH_CONDITION，未判为 null）。 */
  result: null | string;
  /** 覆盖状态（由 result 映射，见 GatePrecheckItemStatus）。 */
  status: GatePrecheckItemStatus;
}

/** 覆盖统计 summary（后端确定性计数，非模型复述）。 */
export interface GatePrecheckCoverage {
  covered: number;
  missing: number;
  partial: number;
  total: number;
}

/** 材料齐套性单行（GateMaterialChecker.listMaterialStatus items[]）。 */
export interface GatePrecheckMaterialRow {
  actionCode: null | string;
  /** 阶段动作 id（Long 序列化字符串）。 */
  actionId: string;
  actionName: null | string;
  isReady: boolean;
  required: number;
  uploaded: number;
}

/** 项目级 stage-action 材料齐套性（GateMaterialChecker 既有口径，原样透传）。 */
export interface GatePrecheckMaterials {
  gateId: string;
  isReady: boolean;
  items: GatePrecheckMaterialRow[];
  missing: number;
  projectId: string;
  total: number;
  uploaded: number;
}

/** AI 参考清单段（复用 gate.precheck-checklist 场景；AI 失败/未启用时 degraded=true，结构化部分恒返回）。 */
export interface GatePrecheckAiChecklist {
  /** 模型名（可能为空）。 */
  aiModel: null | string;
  degraded: boolean;
  markdown: string;
}

/** POST /gates/{gateId}/precheck 响应（GatePrecheckService#precheck 返回 Map 的稳定键集）。 */
export interface GatePrecheckView {
  aiChecklist: GatePrecheckAiChecklist;
  /** 恒 false：预审结果只读参考，不阻塞评审。 */
  blocking: boolean;
  /** 恒 false：预审不写 Gate 决策。 */
  decisionWritten: boolean;
  gateCode: null | string;
  gateId: string;
  items: GatePrecheckItem[];
  latencyMs: number;
  materials: GatePrecheckMaterials;
  projectId: string;
  summary: GatePrecheckCoverage;
}

/**
 * 触发 Gate 评审材料 AI 预审（无请求体；每次调用后端必落一行 AI_PRECHECK 审计）。
 * 对应 GatePrecheckController#precheck — POST /api/v1/gates/{gateId}/precheck
 */
export function runGatePrecheck(gateId: string): Promise<GatePrecheckView> {
  return ipdPost<GatePrecheckView>(`/gates/${encodeURIComponent(gateId)}/precheck`);
}

/** 同轮分歧点（后端 divergences[]；同轮 MARKET_PM/RD_PM 已签 decision 不一致才成行）。 */
export interface GateArbitrationDivergence {
  marketDecision: string;
  marketOpinion: null | string;
  round: number;
  rdDecision: string;
  rdOpinion: null | string;
}

/** AI 归纳段（AiGateway 瞬时通道；零分歧跳 AI 给确定性结论，失败 degraded=true 不抛）。 */
export interface GateArbitrationAiSummary {
  aiModel: null | string;
  degraded: boolean;
  markdown: string;
}

/** POST /gates/{gateId}/arbitration-divergences 响应（GatePrecheckService#arbitrationDivergences）。 */
export interface GateArbitrationDivergencesView {
  aiSummary: GateArbitrationAiSummary;
  /** 恒 false：分歧汇总只读参考，不阻塞仲裁。 */
  blocking: boolean;
  /** 恒 false：不代写仲裁决策（仲裁/终裁恒人工，AI 只归纳不裁决）。 */
  decisionWritten: boolean;
  divergences: GateArbitrationDivergence[];
  gateId: string;
  latencyMs: number;
  /** Gate 当前轮次（数字，非 ID）。 */
  round: null | number;
}

/**
 * 仲裁分歧点汇总（同轮双 PM 决策不一致清单 + AI 归纳；只归纳不裁决）。
 * 对应 GatePrecheckController#arbitrationDivergences — POST /api/v1/gates/{gateId}/arbitration-divergences
 */
export function runArbitrationDivergences(
  gateId: string,
): Promise<GateArbitrationDivergencesView> {
  return ipdPost<GateArbitrationDivergencesView>(
    `/gates/${encodeURIComponent(gateId)}/arbitration-divergences`,
  );
}
