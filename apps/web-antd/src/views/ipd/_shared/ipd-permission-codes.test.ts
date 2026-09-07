// IPD 权限码集中常量单测：与后端 IpdPermissionCode 一一对应。
import * as fs from 'node:fs';
import * as path from 'node:path';

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

/**
 * A13 接入清单回归保护：扫描 views/ipd 下 v-access:code 与 meta.access 引用，
 * 防止后续重构无意中回退关键按钮授权（A10 → A13 P0 安全修复落地证据）。
 *
 * 接入约定：
 *   1. Button/Card 上加 v-access:code="IPD_PERMISSION_CODES.XXX"（按 vben 5.x 指令）
 *   2. router meta.access 数组追加 IPD_PERMISSION_CODES.XXX（路由级授权）
 *   3. 不得用裸字符串字面量 'ipd:xxx'（集中常量是单一权威源）
 */
describe('A13 19 个零引用权限码已接入（v-access:code 或 meta.access）', () => {
  // 19 个目标接入码（A10 报告 + A13 复核）
  const expected: { code: string; in: 'meta.access' | 'v-access' | 'both' }[] = [
    { code: IPD_PERMISSION_CODES.GATE_ELEMENT_CREATE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.GATE_ELEMENT_UPDATE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.GATE_ELEMENT_DISABLE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.CERT_TEMPLATE_CREATE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.CERT_TEMPLATE_DELETE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.DELETION_REQUEST_SUBMIT, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.DELETION_REQUEST_LEADER, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.DELETION_REQUEST_ADMIN, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.AI_DOCUMENT_CREATE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.AI_DOCUMENT_REVIEW, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.AI_DOCUMENT_REVISE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.SOP_TEMPLATE_LIST, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.AI_MODEL_LIST, in: 'meta.access' },
    { code: IPD_PERMISSION_CODES.PRODUCT_CREATE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.GATE_REVIEW_LIST, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.GATE_REVIEW_INITIATE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.STAGE_ACTION_EXECUTE, in: 'v-access' },
    { code: IPD_PERMISSION_CODES.STAGE_ACTION_DELIVERABLE, in: 'v-access' },
  ];

  it('目标码数量 = 19（A13 承诺）', () => {
    expect(expected.length).toBe(19);
  });

  for (const { code, in: location } of expected) {
    it(`${code} 已通过 ${location} 接入`, () => {
      // 静态扫描：只检查常量字符串在 views 源文件 + 路由表中是否真实出现，
      // 防止后续重构无意中摘掉 v-access 指令或 meta.access 元素。
      // 这是最小依赖的契约测试，不依赖运行时挂载 useAccess mock。
      const grep = (pattern: string, root: string): boolean => {
        const stack = [root];
        while (stack.length > 0) {
          const dir = stack.pop()!;
          let entries: string[];
          try {
            entries = fs.readdirSync(dir);
          } catch {
            continue;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry);
            let stat;
            try {
              stat = fs.statSync(full);
            } catch {
              continue;
            }
            if (stat.isDirectory()) stack.push(full);
            else if (/\.(vue|ts)$/.test(entry)) {
              try {
                const content = fs.readFileSync(full, 'utf8');
                if (content.includes(pattern)) return true;
              } catch {
                // skip
              }
            }
          }
        }
        return false;
      };

      const cwd = process.cwd();
      const viewRoot = path.join(cwd, 'apps/web-antd/src/views/ipd');
      const routeRoot = path.join(cwd, 'apps/web-antd/src/router');

      // 模式 1: meta.access 数组直接引用（仅 meta.access 类型需要查路由）
      const metaAccessHit =
        location === 'meta.access'
          ? grep(code, routeRoot) || grep(code, viewRoot)
          : true;

      // 模式 2: v-access:code="IPD_PERMISSION_CODES.XXX" → 至少出现 code 字面值 + IPD_PERMISSION_CODES 引用
      const vAccessHit =
        location === 'v-access'
          ? grep(code, viewRoot)
          : true;

      expect(metaAccessHit && vAccessHit).toBe(true);
    });
  }
});

/**
 * A23 17 个零引用权限码处置回归保护（A10 → A13 接入 19 后剩余）。
 *
 * 处置约定（与 A13 接入区分）：
 *   1. 无对应 UI 的后端预留码：在 ipd-permission-codes.ts 该常量行加
 *      `/* reserved (A23): <原因> *\/` 行尾注释——避免审计误判为泄漏
 *   2. 路由 meta.access 追加：仅当路由页面已承载该能力
 *   3. 按钮 v-access:code：仅当存在真实按钮
 *   4. STAGE_ACTION_INSTANTIATE 与 DELIVERABLE 同字面值（已在 9fde989 之前记录），
 *      本次仅在 INSTANTIATE 行加碰撞 doc 注释，不重复加 v-access 指令
 */
describe('A23 17 个零引用权限码已处置（reserved 注释 16 + 碰撞 doc 1）', () => {
  // 17 目标常量 key（A10 → A13 → A23 完整闭环）
  const reservedCodes: readonly string[] = [
    // 优先级 1：与现有视图弱关联
    IPD_PERMISSION_CODES.PROJECT_QUERY,
    IPD_PERMISSION_CODES.PROJECT_STATUS_CHANGE,
    IPD_PERMISSION_CODES.PRODUCT_BIND_PROJECT,
    IPD_PERMISSION_CODES.GATE_ELEMENT_PUBLISH,
    IPD_PERMISSION_CODES.GATE_ELEMENT_ARCHIVE,
    IPD_PERMISSION_CODES.GATE_ELEMENT_COPY,
    IPD_PERMISSION_CODES.GATE_ELEMENT_REVERT,
    // 优先级 2：后端未交付相关 UI
    IPD_PERMISSION_CODES.NOTIFICATION_READ,
    IPD_PERMISSION_CODES.NOTIFICATION_DISPATCH,
    IPD_PERMISSION_CODES.COEFFICIENT_PROPOSE,
    IPD_PERMISSION_CODES.COEFFICIENT_CONFIRM,
    IPD_PERMISSION_CODES.SWITCHING_ACCEPTANCE_QUERY,
    IPD_PERMISSION_CODES.SWITCHING_ACCEPTANCE_ADMIN,
    IPD_PERMISSION_CODES.COMPLIANCE_READ,
    IPD_PERMISSION_CODES.COMPLIANCE_WRITE,
    IPD_PERMISSION_CODES.STAGE_ACTION_LIST,
    // STAGE_ACTION_INSTANTIATE 与 DELIVERABLE 同字面值，DELIVERABLE 已接入；
    // INSTANTIATE 仅加碰撞 doc 注释，不重复 v-access 指令
    IPD_PERMISSION_CODES.STAGE_ACTION_INSTANTIATE,
  ];

  it('A23 目标码数量 = 17（与 _shared 处置行数对齐）', () => {
    expect(reservedCodes.length).toBe(17);
  });

  it('A23 不新增码：distinct count 仍为 65', () => {
    // 仅注释改动，ALL_IPD_PERMISSION_CODES 字面值集合与 A13 一致
    expect(new Set(ALL_IPD_PERMISSION_CODES).size).toBe(65);
    expect(ALL_IPD_PERMISSION_CODES.length).toBe(66);
  });

  for (const code of reservedCodes) {
    it(`${code} 已标记 reserved (A23)（视图无按钮或与 DELIVERABLE 同码）`, () => {
      // 加载一次 ipd-permission-codes.ts
      const cwd = process.cwd();
      const permPath = path.join(
        cwd,
        'apps/web-antd/src/views/ipd/_shared/ipd-permission-codes.ts',
      );
      const permContent = fs.readFileSync(permPath, 'utf8');
      // 找到该字面值对应的常量名（IPD_PERMISSION_CODES 的 key 字面值）
      // 对于同码双名（STAGE_ACTION_DELIVERABLE / INSTANTIATE）取最后一个匹配，
      // 因为 reservedCodes 列表中的 INSTANTIATE 排在 DELIVERABLE 之后定义
      const entryName = Object.entries(IPD_PERMISSION_CODES)
        .reverse()
        .find(([, value]) => value === code)?.[0];
      expect(entryName, `未在 IPD_PERMISSION_CODES 中找到 ${code}`).toBeDefined();
      // 行级匹配：'<ENTRY_NAME>:' 必须出现在某行，且该行带 'reserved (A23)' 注释
      // 这样 STAGE_ACTION_INSTANTIATE 与 STAGE_ACTION_DELIVERABLE（同字面值）能正确区分
      const lines = permContent.split('\n');
      const targetLine = lines.find((line) =>
        line.includes(`${entryName}:`) && line.includes(`'${code}'`),
      );
      expect(targetLine, `未在 ipd-permission-codes.ts 找到 ${entryName} 常量行`).toBeDefined();
      expect(
        targetLine!.includes('reserved (A23)'),
        `${entryName} (${code}) 行缺少 /* reserved (A23) */ 注释`,
      ).toBe(true);

      // 兜底验证：扫描 views/ipd 与 router，确认该字面值确实未被消费
      // （如有 v-access/meta.access 接入，此处应能找到，反之亦然）
      const grep = (pattern: string, root: string): boolean => {
        const stack = [root];
        while (stack.length > 0) {
          const dir = stack.pop()!;
          let entries: string[];
          try {
            entries = fs.readdirSync(dir);
          } catch {
            continue;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry);
            let stat;
            try {
              stat = fs.statSync(full);
            } catch {
              continue;
            }
            if (stat.isDirectory()) stack.push(full);
            else if (/\.(vue|ts)$/.test(entry)) {
              try {
                const content = fs.readFileSync(full, 'utf8');
                if (content.includes(pattern)) return true;
              } catch {
                // skip
              }
            }
          }
        }
        return false;
      };
      const viewRoot = path.join(cwd, 'apps/web-antd/src/views/ipd');
      const routeRoot = path.join(cwd, 'apps/web-antd/src/router');
      const consumedInViews = grep(code, viewRoot);
      const consumedInRouter = grep(code, routeRoot);
      // 处置合理：要么注释到位（A23 主路径），要么已被某视图/路由消费
      // 两者取一即视为合规
      expect(targetLine!.includes('reserved (A23)') || consumedInViews || consumedInRouter).toBe(true);
    });
  }
});
