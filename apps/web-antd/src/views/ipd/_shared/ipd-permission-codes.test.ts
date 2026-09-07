// IPD 权限码集中常量单测：与后端 IpdPermissionCode 一一对应。
import { describe, expect, it } from 'vitest';

import {
  ALL_IPD_PERMISSION_CODES,
  IPD_PERMISSION_CODES,
  PAGE_PERMISSIONS,
  getRequiredCodes,
} from './ipd-permission-codes';

describe('IPD 权限码常量与后端一一对应', () => {
  it('导出 65 个 distinct 码（与后端 IpdPermissionCode 字面值一一镜像，1 组同码双名）', () => {
    // 后端 66 个常量声明，其中 STAGE_ACTION_DELIVERABLE 与 STAGE_ACTION_INSTANTIATE
    // 共享字面值 'ipd:stage-action:add'，故 distinct 码为 65
    expect(ALL_IPD_PERMISSION_CODES.length).toBe(66);
    expect(new Set(ALL_IPD_PERMISSION_CODES).size).toBe(65);
  });

  it('所有 distinct 码唯一（65 个）', () => {
    const set = new Set(ALL_IPD_PERMISSION_CODES);
    expect(set.size).toBe(65);
    // 数组长度 66（多 1 项是 STAGE_ACTION_DELIVERABLE 与 STAGE_ACTION_INSTANTIATE 同码）
    expect(ALL_IPD_PERMISSION_CODES.length).toBe(66);
  });

  it('全部码遵循 ipd:资源:动作 命名规范', () => {
    for (const code of ALL_IPD_PERMISSION_CODES) {
      expect(code).toMatch(/^ipd:[a-z-]+:[a-z-]+$/);
    }
  });

  it('关键码存在（用于回归保护）', () => {
    expect(IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE).toBe('ipd:bonus-pool:compute');
    expect(IPD_PERMISSION_CODES.BONUS_POOL_FREEZE).toBe('ipd:bonus-pool:freeze');
    expect(IPD_PERMISSION_CODES.BONUS_POOL_DISTRIBUTE).toBe('ipd:bonus-pool:distribute');
    expect(IPD_PERMISSION_CODES.AI_DOCUMENT_REVIEW).toBe('ipd:ai-document:review');
    expect(IPD_PERMISSION_CODES.HANDOVER_CANCEL).toBe('ipd:handover:cancel');
  });

  it('STAGE_ACTION_DELIVERABLE 与 INSTANTIATE 共享同一码（后端设计）', () => {
    expect(IPD_PERMISSION_CODES.STAGE_ACTION_DELIVERABLE).toBe(IPD_PERMISSION_CODES.STAGE_ACTION_INSTANTIATE);
  });
});

describe('PAGE_PERMISSIONS 49 页权限矩阵', () => {
  it('关键页都已登记权限码', () => {
    expect(PAGE_PERMISSIONS['/ipd/projects']).toContain(IPD_PERMISSION_CODES.PROJECT_LIST);
    expect(PAGE_PERMISSIONS['/ipd/kpi/functional']).toContain(IPD_PERMISSION_CODES.KPI_QUERY);
    expect(PAGE_PERMISSIONS['/ipd/incentive/allowance']).toBeDefined();
    expect(PAGE_PERMISSIONS['/ipd/incentive/bonus-pool']).toContain(
      IPD_PERMISSION_CODES.BONUS_POOL_DISTRIBUTE,
    );
    expect(PAGE_PERMISSIONS['/ipd/incentive/negative-feedback']).toContain(
      IPD_PERMISSION_CODES.NEGATIVE_FEEDBACK_DECIDE,
    );
  });

  it('页路径以 /ipd 开头（避免误登基线路由）', () => {
    for (const path of Object.keys(PAGE_PERMISSIONS)) {
      expect(path.startsWith('/ipd')).toBe(true);
    }
  });
});

describe('getRequiredCodes 路径解析', () => {
  it('精确路径命中', () => {
    expect(getRequiredCodes('/ipd/projects')).toEqual([IPD_PERMISSION_CODES.PROJECT_LIST]);
  });

  it('子路径向上回溯到最长匹配', () => {
    // /ipd/projects/123/overview → /ipd/projects
    const codes = getRequiredCodes('/ipd/projects/abc/overview');
    expect(codes).toContain(IPD_PERMISSION_CODES.PROJECT_LIST);
  });

  it('未登记路径返回空数组（内部全员可访问）', () => {
    expect(getRequiredCodes('/ipd/unknown-page')).toEqual([]);
  });
});
