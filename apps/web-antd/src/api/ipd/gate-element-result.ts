/**
 * Gate 要素判定结果接口（[CONSISTENCY-4] 2026-09-06 蜂群审计线1）。
 *
 * 真值：GateElementResultController（/api/v1/gates/{gateId}/element-results）。
 * 已交付端点：GET /elements（评审要素列表）、POST /element-results（提交逐项判定）、
 * POST /element-results/{resultId}/close（关闭带条件项）、POST /submit（提交评审结论）。
 *
 * 设计要点：
 * - 33 要素逐项打勾，命中「is_veto=1」项时前端通过按钮置灰（硬阻断）；
 * - 命中「条件通过」项必须填责任人与关闭期限（AC-GATE-16）；
 * - 提交评审结论前 33 项判定结果必须全提交（AC-GATE-15 否决项硬阻断）。
 *
 * 与 gate-panel.vue 配合使用：判定结果先行 → 然后 POST /submit 整体提交。
 */
import { ipdGet, ipdPost } from './http';

export type GateElementResult = 'FAIL' | 'PASS' | 'PASS_WITH_CONDITION';

/** 评审要素视图（与 GateElementResultService.listView 真值对齐：R30 E2E 实测
 * 后端字段为 elementId/elementCode/elementName——旧类型 id/code/title 属未对齐契约，
 * 已在 R30 修正；description/gateCode/status 仅为前端 FALLBACK 静态数据自有字段）。 */
export interface IpdGateElementView {
  elementCode: string;
  elementId: string;
  elementName: string;
  isVeto: boolean;
  passStandard?: null | string;
  /** 后端视图返回的已判定结果（未判定为 null）。 */
  result?: GateElementResult | null;
  sortOrder: number;
  description?: null | string;
  gateCode?: 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
  status?: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
}

/** 判定结果单条（前端逐项打勾后提交）。 */
export interface IpdGateElementResultReq {
  closeDeadline?: null | string;
  conditionNote?: null | string;
  elementId: string;
  responsiblePersonId?: null | string;
  result: GateElementResult;
}

export interface IpdGateElementResultView extends IpdGateElementResultReq {
  createTime?: null | string;
  id: string;
  operatorId: string;
}

/** 获取评审要素列表（含 33 项种子要素；后端按 gateId 透明过滤）。
 * 命名区分：gate-element.ts 的管理端要素库列表为 listGateElements（/api/v1/gate-elements），
 * 本函数走 /gates/{gateId}/elements 返回视图态，不与其同名（规约 §2 禁同名导出）。 */
export function listGateElementViews(gateId: string): Promise<IpdGateElementView[]> {
  return ipdGet<IpdGateElementView[]>(`/gates/${encodeURIComponent(gateId)}/elements`);
}

/** 提交单条要素判定（前端打勾后调用，可多次提交覆盖。 */
export function submitGateElementResult(gateId: string, req: IpdGateElementResultReq): Promise<IpdGateElementResultView> {
  return ipdPost<IpdGateElementResultView>(`/gates/${encodeURIComponent(gateId)}/element-results`, req);
}

/** 关闭带条件项（提供证据后关闭遗留项；AC-GATE-17）。 */
export function closeGateElementResult(gateId: string, resultId: string, evidence: { evidenceRef?: null | string; note?: null | string }): Promise<IpdGateElementResultView> {
  return ipdPost<IpdGateElementResultView>(
    `/gates/${encodeURIComponent(gateId)}/element-results/${encodeURIComponent(resultId)}/close`,
    evidence,
  );
}

/** 硬阻断检查：要素列表中 is_veto=true 且 result=FAIL 的条目数 > 0 ⇒ 提交按钮置灰。 */
export function countVetoFailures(elements: IpdGateElementView[], results: Map<string, GateElementResult>): number {
  return elements.filter((el) => el.isVeto && results.get(el.elementId) === 'FAIL').length;
}

/**
 * 评审要素静态回退数据（[CONSISTENCY-4] V4 高危修复）。
 *
 * 设计要点：
 * - 后端 /api/v1/gates/{id}/elements 偶尔只返回部分要素（19/33）或异常时，前端必须
 *   能稳定展示 33 项种子要素；
 * - 数量 G1(7) + G2(6) + G3(5) + G4(8) + G5(7) = 33，与后端种子一致；
 * - 14 项 isVeto=true（双 PM 否决项不可管理覆盖 AC-GATE-08）；
 * - 静态 ID 用 `fallback-<code>` 前缀，提交判定时若发现 ID 以该前缀开头则前端
 *   拦截并提示用户「后端未交付此要素，请刷新或联系超管登记」；
 * - 仅在前端 `loadElements` 失败 / 0 项时填充，不覆盖后端真实数据。
 */
export const FALLBACK_GATE_ELEMENTS: IpdGateElementView[] = [
  // G1 概念决策评审（7 项，3 否决）
  { elementId: 'fallback-G1-01', elementCode: 'G1-01', gateCode: 'G1', elementName: '市场机会与用户痛点验证', description: '目标细分市场痛点是否成立，目标用户规模是否支撑商业模型', passStandard: '细分市场 TAM ≥ 项目立项最低门槛，有定量访谈或调研佐证', isVeto: false, sortOrder: 1, status: 'PUBLISHED' },
  { elementId: 'fallback-G1-02', elementCode: 'G1-02', gateCode: 'G1', elementName: '商业模式可行性', description: '收费模式、单位经济、回收周期是否通过 PM + 财务联合评审', passStandard: 'LTV/CAC ≥ 3，回收周期 ≤ 18 个月', isVeto: true, sortOrder: 2, status: 'PUBLISHED' },
  { elementId: 'fallback-G1-03', elementCode: 'G1-03', gateCode: 'G1', elementName: '技术可行性评估', description: '关键技术难点是否已有方案或 PoC 验证', passStandard: '关键技术风险点有明确攻关路径与责任人', isVeto: true, sortOrder: 3, status: 'PUBLISHED' },
  { elementId: 'fallback-G1-04', elementCode: 'G1-04', gateCode: 'G1', elementName: '竞品与替代方案分析', description: '直接竞品、替代品、潜在颠覆者的差异化定位', passStandard: '形成竞品矩阵，识别至少 2 个差异化卖点', isVeto: false, sortOrder: 4, status: 'PUBLISHED' },
  { elementId: 'fallback-G1-05', elementCode: 'G1-05', gateCode: 'G1', elementName: '初步财务评估', description: '三年财务预测、投入产出、关键假设敏感性', passStandard: 'NPV ≥ 0，关键假设有书面依据', isVeto: true, sortOrder: 5, status: 'PUBLISHED' },
  { elementId: 'fallback-G1-06', elementCode: 'G1-06', gateCode: 'G1', elementName: '法规与合规预审', description: '所属行业法规、数据合规、知识产权风险', passStandard: '形成合规清单，无 P0 不可接受项', isVeto: false, sortOrder: 6, status: 'PUBLISHED' },
  { elementId: 'fallback-G1-07', elementCode: 'G1-07', gateCode: 'G1', elementName: '立项建议书（Charter）', description: '项目目标、范围、关键里程碑、核心团队', passStandard: 'Charter 通过 PM 双签会签', isVeto: false, sortOrder: 7, status: 'PUBLISHED' },

  // G2 计划决策评审（6 项，2 否决）
  { elementId: 'fallback-G2-01', elementCode: 'G2-01', gateCode: 'G2', elementName: '项目计划书与里程碑', description: 'WBS、关键里程碑、阶段交付物定义', passStandard: '里程碑可量化，阶段 Gate 与交付物一一对应', isVeto: false, sortOrder: 1, status: 'PUBLISHED' },
  { elementId: 'fallback-G2-02', elementCode: 'G2-02', gateCode: 'G2', elementName: '资源预算与人力配置', description: '预算明细、人力投入、设备采购清单', passStandard: '预算偏差 ≤ 10%，关键岗位 HR 已确认', isVeto: true, sortOrder: 2, status: 'PUBLISHED' },
  { elementId: 'fallback-G2-03', elementCode: 'G2-03', gateCode: 'G2', elementName: '项目风险评估与应对', description: '风险登记册、Owner、应对措施、应急预案', passStandard: 'P0/P1 风险有 Owner 与缓解计划', isVeto: false, sortOrder: 3, status: 'PUBLISHED' },
  { elementId: 'fallback-G2-04', elementCode: 'G2-04', gateCode: 'G2', elementName: '开发与运营流程', description: '研发流程、配置管理、CI/CD、运维支撑', passStandard: '研发流程文档发布，CI/CD 链路 demo 通过', isVeto: false, sortOrder: 4, status: 'PUBLISHED' },
  { elementId: 'fallback-G2-05', elementCode: 'G2-05', gateCode: 'G2', elementName: '团队组建与能力盘点', description: '核心成员到位率、技能差距、外包策略', passStandard: '关键岗位到位率 ≥ 90%', isVeto: false, sortOrder: 5, status: 'PUBLISHED' },
  { elementId: 'fallback-G2-06', elementCode: 'G2-06', gateCode: 'G2', elementName: '立项评审决议', description: '双 PM + 上级三方决议签字', passStandard: '三方签字齐全，无保留意见', isVeto: true, sortOrder: 6, status: 'PUBLISHED' },

  // G3 开发阶段评审（5 项，2 否决）
  { elementId: 'fallback-G3-01', elementCode: 'G3-01', gateCode: 'G3', elementName: '关键功能实现', description: '核心需求实现度、关键场景覆盖', passStandard: 'P0 需求 100% 实现，P1 ≥ 95%', isVeto: true, sortOrder: 1, status: 'PUBLISHED' },
  { elementId: 'fallback-G3-02', elementCode: 'G3-02', gateCode: 'G3', elementName: '系统集成完成度', description: '子系统联调、接口契约、性能基线', passStandard: '端到端核心链路 demo 通过', isVeto: true, sortOrder: 2, status: 'PUBLISHED' },
  { elementId: 'fallback-G3-03', elementCode: 'G3-03', gateCode: 'G3', elementName: '内部测试报告', description: '缺陷分布、修复率、回归通过率', passStandard: '无 P0/P1 遗留缺陷', isVeto: false, sortOrder: 3, status: 'PUBLISHED' },
  { elementId: 'fallback-G3-04', elementCode: 'G3-04', gateCode: 'G3', elementName: '代码质量与安全审查', description: 'Sonar 阈值、依赖漏洞、敏感信息扫描', passStandard: '无 Critical 安全漏洞，Sonar 评级达标', isVeto: false, sortOrder: 4, status: 'PUBLISHED' },
  { elementId: 'fallback-G3-05', elementCode: 'G3-05', gateCode: 'G3', elementName: '性能基准', description: '核心接口响应时延、并发、稳定性', passStandard: '核心接口 P95 ≤ 目标值', isVeto: false, sortOrder: 5, status: 'PUBLISHED' },

  // G4 验证/确认评审（8 项，4 否决）
  { elementId: 'fallback-G4-01', elementCode: 'G4-01', gateCode: 'G4', elementName: 'UAT 用户验收测试', description: '真实用户场景验收、缺陷关闭率', passStandard: '客户代表签字通过，无 P0 遗留', isVeto: true, sortOrder: 1, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-02', elementCode: 'G4-02', gateCode: 'G4', elementName: '安全评估与渗透测试', description: '渗透测试报告、漏洞修复、应急预案', passStandard: '无 High 及以上未修复漏洞', isVeto: true, sortOrder: 2, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-03', elementCode: 'G4-03', gateCode: 'G4', elementName: '性能压力与稳定性', description: '压测报告、长稳测试、容量规划', passStandard: '峰值容量 ≥ 业务预期 2 倍', isVeto: false, sortOrder: 3, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-04', elementCode: 'G4-04', gateCode: 'G4', elementName: '兼容性验证', description: '多端、多版本、多环境兼容性', passStandard: '目标矩阵 100% 覆盖', isVeto: false, sortOrder: 4, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-05', elementCode: 'G4-05', gateCode: 'G4', elementName: '文档完整性', description: '用户手册、运维手册、API 文档、培训材料', passStandard: '文档齐备并通过内部评审', isVeto: false, sortOrder: 5, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-06', elementCode: 'G4-06', gateCode: 'G4', elementName: '培训与知识转移', description: '运维、客服、销售培训完成度', passStandard: '关键角色培训通过率 100%', isVeto: false, sortOrder: 6, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-07', elementCode: 'G4-07', gateCode: 'G4', elementName: '部署与回滚方案', description: '部署脚本、回滚预案、灰度策略', passStandard: '演练通过，回滚 ≤ 30 分钟', isVeto: true, sortOrder: 7, status: 'PUBLISHED' },
  { elementId: 'fallback-G4-08', elementCode: 'G4-08', gateCode: 'G4', elementName: '上市与运营就绪', description: '上市发布材料、运营监控、客服工单预演', passStandard: '上市 checklist 100% 完成', isVeto: true, sortOrder: 8, status: 'PUBLISHED' },

  // G5 上市发布评审（7 项，3 否决）
  { elementId: 'fallback-G5-01', elementCode: 'G5-01', gateCode: 'G5', elementName: '上市发布就绪', description: '发布窗口、风险评估、监管批文', passStandard: '发布条件齐备，监管绿灯', isVeto: true, sortOrder: 1, status: 'PUBLISHED' },
  { elementId: 'fallback-G5-02', elementCode: 'G5-02', gateCode: 'G5', elementName: '客服与支持体系', description: '客服上线、培训、工单流程、SLA', passStandard: '客服首问负责率 ≥ 95%', isVeto: false, sortOrder: 2, status: 'PUBLISHED' },
  { elementId: 'fallback-G5-03', elementCode: 'G5-03', gateCode: 'G5', elementName: '营销与渠道就绪', description: '渠道签约、营销素材、PR 节奏', passStandard: '主渠道签约完成，PR 时间表锁定', isVeto: false, sortOrder: 3, status: 'PUBLISHED' },
  { elementId: 'fallback-G5-04', elementCode: 'G5-04', gateCode: 'G5', elementName: '运营监控与告警', description: '监控大盘、告警阈值、值班排班', passStandard: '监控大盘上线，告警演练通过', isVeto: false, sortOrder: 4, status: 'PUBLISHED' },
  { elementId: 'fallback-G5-05', elementCode: 'G5-05', gateCode: 'G5', elementName: '应急预案', description: '故障演练、危机公关、资金储备', passStandard: '应急预案演练通过', isVeto: true, sortOrder: 5, status: 'PUBLISHED' },
  { elementId: 'fallback-G5-06', elementCode: 'G5-06', gateCode: 'G5', elementName: '监管与法务终审', description: '广告法、数据合规、税务合规', passStandard: '法务终审通过，无 P0 风险', isVeto: true, sortOrder: 6, status: 'PUBLISHED' },
  { elementId: 'fallback-G5-07', elementCode: 'G5-07', gateCode: 'G5', elementName: '上市复盘计划', description: '复盘节奏、关键指标、责任人', passStandard: '复盘计划批准，关键指标已埋点', isVeto: false, sortOrder: 7, status: 'PUBLISHED' },
];

/** 判断当前列表是否来自静态回退（仅用于前端 stale 标记，提交判定会被前端拦截）。 */
export function isFallbackElement(element: IpdGateElementView): boolean {
  return element.elementId.startsWith('fallback-');
}

/** 取全量回退要素（API 失败时由前端兜底展示）。 */
export function getFallbackGateElements(): IpdGateElementView[] {
  return FALLBACK_GATE_ELEMENTS.map((el) => ({ ...el }));
}
