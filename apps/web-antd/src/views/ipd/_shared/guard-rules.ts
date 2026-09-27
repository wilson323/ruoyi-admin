/**
 * 状态机 Guard 规则契约消费层（补遗 §5-1，口径见后端仓
 * docs/ipd-系统说明/状态机Guard契约JSON链路口径-20260927.md）。
 *
 * <p>事实源：`state-machine-guard-rules.json` 由后端 `StateMachineGuardRulesExportTest`
 * 从 `DefaultStateMachineGuard.initRules()`（42 条规则）导出双写至此——改后端规则不重导出，
 * 后端 compare 模式必红。本文件把该 JSON 派生为前端机器的 transitions 图，消灭
 * C7/C9/C10 一类「前端手写迁移图与后端守卫表漂移」。
 *
 * <p>消费边界（本期，见口径文档 §4）：
 * <ul>
 *   <li>bonus_pool / requirement_change → deriveTransitions 派生（词表一致）</li>
 *   <li>deletion_request / gate_review → KNOWN_DRIFT，词表收敛另案（C7），禁止直接派生</li>
 *   <li>其余前端机器无后端守卫规则，保持手写</li>
 * </ul>
 */

import guardRulesJson from './state-machine-guard-rules.json';

/** 契约 JSON 单条规则（后端导出五字段，key/description 不导出）。 */
export interface GuardRule {
  crossDomain: boolean;
  entityType: string;
  fromState: string;
  toState: string;
  trigger: string;
}

interface GuardRulesFile {
  meta: { ruleCount: number; source: string; version: string };
  rules: GuardRule[];
}

const contract = guardRulesJson as unknown as GuardRulesFile;

/** 导出侧 fail-closed：契约文件缺关键字段直接抛，不允许静默降级为「无规则」。 */
if (!Array.isArray(contract.rules) || typeof contract.meta?.version !== 'string') {
  throw new Error('state-machine-guard-rules.json 契约格式异常（rules/meta.version 缺失）');
}

/** 契约元信息（version=sha256 锁、ruleCount 哨兵），供契约测试断言。 */
export const GUARD_RULES_META = contract.meta;

/** 全部规则只读导出，供契约测试与页面对账使用。 */
export const GUARD_RULES: readonly GuardRule[] = Object.freeze([...contract.rules]);

/** 后端守卫表里的实体类型名（仅收录前端已消费的）。 */
export const GUARD_ENTITY_TYPES = {
  bonusPool: 'bonus_pool',
  requirementChange: 'requirement_change',
} as const;

/**
 * 按 entityType 从契约规则派生状态机 transitions。
 *
 * <p>派生规则（与口径文档 §4 一致）：
 * <ul>
 *   <li>`fromState=INITIAL` 的创建迁移过滤掉（前端状态集无 INITIAL）</li>
 *   <li>`fromState='*'` 通配本期前端机器无命中（存量通配仅 deletion/kpi 使用），出现即抛错——
 *       避免静默吞掉语义不明的新通配</li>
 *   <li>to/from 不在 stateCodes 词表内的规则忽略（KNOWN_DRIFT 机器不应走本函数）</li>
 *   <li>后继列表按 stateCodes 给定顺序排列，保证输出与后端规则行序无关（确定性 diff）</li>
 * </ul>
 */
export function deriveTransitions<S extends string>(
  entityType: string,
  stateCodes: readonly S[],
): Record<S, S[]> {
  const order = new Map(stateCodes.map((code, index) => [code, index]));
  const out = Object.fromEntries(
    stateCodes.map((code) => [code, [] as S[]]),
  ) as Record<S, S[]>;

  for (const rule of GUARD_RULES) {
    if (rule.entityType !== entityType) continue;
    if (rule.fromState === 'INITIAL') continue;
    if (rule.fromState === '*') {
      throw new Error(
        `deriveTransitions(${entityType})：契约出现 '*' 通配规则（${rule.toState}），` +
          '前端机器无终态收敛语义，请先在口径文档 §4 明确后再消费',
      );
    }
    const from = rule.fromState as S;
    const to = rule.toState as S;
    if (!order.has(from) || !order.has(to)) continue;
    if (!out[from].includes(to)) out[from].push(to);
  }
  for (const code of stateCodes) {
    out[code].sort((a, b) => order.get(a)! - order.get(b)!);
  }
  return out;
}
