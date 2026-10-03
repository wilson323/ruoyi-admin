// Guard 规则契约 JSON 消费层单测（补遗 §5-1 跨仓契约链路的前端侧锚点）。
// 事实源：state-machine-guard-rules.json 由后端 StateMachineGuardRulesExportTest 导出；
// 本测试钉住「消费面派生结果 == 后端规则表现态」，后端改规则未重导出 → 后端 compare 红，
// 后端重导出但前端派生语义变了 → 本测试红。
// 规则数演进：42（W11 §5-1 落地）→ 50（R28 §5-2 StageAction 接线轮补 stage_action 8 边，
// 后端 main efe2f167 与 StateMachineGuardContractTest 哨兵 77 绿同批）→ 53（R33 一期补
// kpi_shared_confirm 3 边）→ 89（D-1 蜂群 SWARM-A 六机 36 边三方合并，后端 b5441246 重导出，
// 前端 999b9e0 同步）→ 93（产品线负责人开工批准、拒绝及再提交四条既有授权迁移）
// → 86（2026-10-03「算钱」层下线：移除 bonus_pool 4 条 + coefficient_change 3 条，
// 与后端 StateMachineGuardContractTest 哨兵 86 同批）；
// 后端加删规则须同步此处，与后端 ContractTest 哨兵联动。
import { describe, expect, it } from 'vitest';

import {
  deriveTransitions,
  GUARD_ENTITY_TYPES,
  GUARD_RULES,
  GUARD_RULES_META,
} from './guard-rules';
import { CHANGE_STATUS_MACHINE } from './ipd-state-machines';

describe('契约文件元信息', () => {
  it('ruleCount 哨兵=86（后端加删规则须同步此处，与后端 ContractTest 哨兵联动）', () => {
    expect(GUARD_RULES_META.ruleCount).toBe(86);
    expect(GUARD_RULES).toHaveLength(86);
  });

  it('version 为 sha256 锁（导出侧自洽校验产物）', () => {
    expect(GUARD_RULES_META.version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('已下线域无残留规则（2026-10-03「算钱」层拆除守卫）', () => {
  it('契约 JSON 中不再包含 bonus_pool / coefficient_change 任何规则', () => {
    const retired = GUARD_RULES.filter(
      (r) => r.entityType === 'bonus_pool' || r.entityType === 'coefficient_change',
    );
    expect(retired).toEqual([]);
  });

  it('GUARD_ENTITY_TYPES 不再收录 bonusPool 词表项（派生入口已封）', () => {
    expect(Object.keys(GUARD_ENTITY_TYPES)).not.toContain('bonusPool');
    expect(Object.values(GUARD_ENTITY_TYPES)).not.toContain('bonus_pool');
  });
});

describe('requirement_change 派生', () => {
  it('四态迁移图与后端 4 条规则一致', () => {
    expect(
      deriveTransitions(GUARD_ENTITY_TYPES.requirementChange, [
        'DRAFT',
        'PENDING_SIGN',
        'APPROVED',
        'REJECTED',
      ]),
    ).toEqual({
      DRAFT: ['PENDING_SIGN'],
      PENDING_SIGN: ['APPROVED', 'REJECTED'],
      APPROVED: [],
      REJECTED: [],
    });
  });

  it('CHANGE_STATUS_MACHINE.transitions 与派生结果全等', () => {
    expect(CHANGE_STATUS_MACHINE.transitions).toEqual(
      deriveTransitions(GUARD_ENTITY_TYPES.requirementChange, [
        'DRAFT',
        'PENDING_SIGN',
        'APPROVED',
        'REJECTED',
      ]),
    );
  });
});

describe('KNOWN_DRIFT 边界钉现状（C7：deletion/gate 词表收敛前禁止派生）', () => {
  it('deletion_request 后端词表与前端状态集零交集（漂移现状证据）', () => {
    const backendStates = new Set(
      GUARD_RULES.filter((r) => r.entityType === 'deletion_request').flatMap((r) => [
        r.fromState,
        r.toState,
      ]),
    );
    const frontendStates = ['PENDING', 'LEADER_APPROVED', 'PURGED'];
    expect(frontendStates.filter((s) => backendStates.has(s))).toEqual([]);
  });

  it('消费机器出现 * 通配规则时派生直接抛错（fail-closed，不静默吞）', () => {
    // 现网 requirement_change 无通配；deletion_request 有 *→WITHDRAWN，
    // 用前端词表可命中的 toState 模拟新通配进入消费面
    expect(() => deriveTransitions('deletion_request', ['WITHDRAWN', 'REJECTED'])).toThrow(
      /通配/,
    );
  });
});
