/**
 * 域内 AI 建议 API（R227-C1 AI-FUSION Layer 2 = 核心 5 页每页 AI 入口）。
 *
 * 契约（后端 AiSuggestionController，2026-09-26）：
 * - POST /ai/suggest：单入口多场景（scene 白名单分发），code=0 包络走 ipdPost；
 * - 返回 markdown 正文，**仅展示由用户手动采纳，不自动写业务表**（方案 §5.1 强约束）；
 * - degraded=true 表示本轮未真调 AI（模型未配置降级），前端按引导文案展示；
 * - 权限复用 ipd:ai-copilot:chat（内部角色可调，对象级越权后端二次校验）。
 * - P1-08 挂账②正式化：AiSuggestView.card 四键信封（P1-02 契约）在此正式声明，
 *   类型引自 views/ipd/_shared/ai-cards/types.ts（仅 type import，零运行时依赖）。
 */
import type { AiCardEnvelope } from '../../views/ipd/_shared/ai-cards/types';

import { ipdPost } from './http';

/** 场景白名单（与后端 AiSuggestionService.SCENES 对齐，改动须双端同步）。 */
export type AiSuggestScene =
  | 'demand.create.from-requirement'
  | 'gate.conclusion-draft'
  | 'gate.precheck-checklist'
  | 'project.create.suggest'
  | 'project.summary.refresh'
  | 'workbench.next-step'
  | 'workbench.risk-warning';

export interface AiSuggestInput {
  /** gate 场景 = 评审 id（字符串 ID，不做数值转换）。 */
  entityId?: string;
  /** 项目相关场景必填；workbench 可空=全局维度。 */
  projectId?: string;
  /** 创建类场景必填的原始素材（项目想法 / 需求原文），≤2000 字符。 */
  userPrompt?: string;
}

export interface AiSuggestView {
  aiModel: string;
  /** P1-02 契约：4 结构化场景增四键卡片信封；无卡场景无此字段（undefined）。 */
  card?: AiCardEnvelope | null;
  completionTokens: number;
  degraded: boolean;
  latencyMs: number;
  markdown: string;
  promptTokens: number;
  scene: string;
}

/** POST /ai/suggest：按场景拉业务上下文生成 markdown 建议。 */
export function aiSuggest(
  scene: AiSuggestScene,
  input: AiSuggestInput = {},
): Promise<AiSuggestView> {
  return ipdPost<AiSuggestView>('/ai/suggest', {
    entityId: input.entityId,
    projectId: input.projectId,
    scene,
    userPrompt: input.userPrompt,
  });
}
