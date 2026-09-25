/**
 * 项目域 API 纯逻辑契约测试（Wave 9 / agent A38）：
 *   A) createProject body 白名单 DTO（pure — toWire 函数过滤 legacyImport 专属字段）
 *   B) listProjects / getProject / legacyImportProject / getGateChecklist normalize 防御性
 *      （pure — 非数组 data → 空数组 / 缺字段 → 空字符串占位 / BigDecimal 保留字符串 /
 *       items 畸形归一化 / ok 严格 true / markedCodes 缺失降级）
 *   C) parseTargetMarkets 容错（pure — JSON 解析失败一律降级空数组）
 *   D) 错误路径解析（pure — HTTP 500 / 非 JSON / fetch TypeError → IpdRequestError）
 *
 * 与 project-live.test.ts 的关系（docs/真HTTP验收规范-20260907.md §二）：
 *   - 本文件（A 桶）：纯逻辑测试，**允许 vi.mock**，覆盖 normalize / parser / 错误码解析
 *   - project-live.test.ts：业务测试，**必须真 HTTP loopback**，
 *     默认 skipIf(!IPD_LIVE_ACCEPTANCE)，跑通 listProjects / getProject / createProject /
 *     legacyImportProject / changeProjectStatus / advanceProjectStage / getGateChecklist 端到端
 *
 * 拆分不增量：原 31 cases → 本文件纯逻辑 16 + project-live.test.ts 业务 15 = 31 总数。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  addProjectCertItem,
  bindProjectMember,
  changeProjectCertItemStatus,
  createProject,
  getGateChecklist,
  getProject,
  legacyImportProject,
  legacyImportProjectsBatch,
  listProjectCertItems,
  listProjectMembers,
  listProjects,
  parseTargetMarkets,
  recordProjectLaunchDate,
  syncProjectCertItems,
  updateProjectBaselines,
} from './project';

const envelope = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({
      code,
      message: code ? '请求不合法' : 'success',
      data,
      timestamp: '2026-09-07T00:00:00Z',
      traceId: 'fixture',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const projectFixture = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: '100',
  code: 'P-100',
  name: '智慧园区一体机',
  productId: 'p-001',
  templateType: 'HARDWARE',
  targetMarkets: '["SA","AE"]',
  level: 'S',
  levelCoefficient: '1.20',
  levelCoefficientReason: 'S 级',
  targetSalesAmount: '5000000.00',
  targetChannelCount: 30,
  targetNps: 60,
  targetSceneCount: 5,
  launchDate: 1_735_660_800_000,
  currentStage: 'CONCEPT',
  declaredStage: null,
  lifecycleStatus: 'TEAMING',
  source: 'NEW',
  missingHistoryAck: null,
  catchupStatus: null,
  legacyEffectiveAt: null,
  status: 'DRAFT',
  mainGroupId: 'g-1',
  createBy: '9001',
  createTime: '2026-09-01 10:00:00',
  ...overrides,
});

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────────────────────────
// A. createProject body 白名单 DTO（pure — toWire 函数过滤 legacyImport 专属字段）
//    评审 Important-1：missingHistoryAck 等 legacyImport 字段混入 createProject body
//    会被后端误判为存量导入请求；toWire 必须对 undefined 字段不序列化。
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — createProject body 白名单 DTO (pure)', () => {
  it('legacyImport 专属字段经 JSON.stringify 后被剔除（undefined 不可序列化）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture()));
    vi.stubGlobal('fetch', fetcher);
    await createProject({
      launchDate: null,
      level: 'A',
      levelCoefficient: null,
      levelCoefficientReason: null,
      mainGroupId: 'g-1',
      name: 'A 级探索',
      productId: 'p-002',
      targetChannelCount: 10,
      targetMarkets: [],
      targetNps: 30,
      targetSalesAmount: 100_000,
      targetSceneCount: 1,
      templateType: 'SOFTWARE',
    });
    const body = JSON.parse(
      String((fetcher.mock.calls[0]?.[1] as RequestInit).body),
    );
    // missingHistoryAck / declaredStage / legacyEffectiveAt 由 JSON.stringify 丢弃（undefined 不可序列化），
    // 等价于「未发 legacyImport 专属字段 → 不可能被误解析为存量导入请求」。
    expect(Object.keys(body).sort()).toEqual([
      'launchDate',
      'level',
      'levelCoefficient',
      'levelCoefficientReason',
      'mainGroupId',
      'name',
      'productId',
      'targetChannelCount',
      'targetMarkets',
      'targetNps',
      'targetSalesAmount',
      'targetSceneCount',
      'templateType',
    ]);
    expect('missingHistoryAck' in body).toBe(false);
    expect('declaredStage' in body).toBe(false);
    expect('legacyEffectiveAt' in body).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B. normalize 防御性（pure — 与后端响应形态无关，仅前端容错）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — listProjects normalize 防御性 (pure)', () => {
  it('非数组 data 直接返回空数组，不抛错', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ junk: true }));
    vi.stubGlobal('fetch', fetcher);
    const list = await listProjects();
    expect(list).toEqual([]);
  });

  it('bigDecimal 字段保持字符串（不被强转 number 丢失精度）', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope([
        projectFixture({
          targetSalesAmount: '9999999999999.99',
          levelCoefficient: '2.40',
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    const [row] = await listProjects();
    expect(row?.targetSalesAmount).toBe('9999999999999.99');
    expect(row?.levelCoefficient).toBe('2.40');
    expect(typeof row?.targetSalesAmount).toBe('string');
  });
});

describe('project API — getProject normalize 防御性 (pure)', () => {
  it('缺字段时返回空字符串占位 id/name（不抛错）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({}));
    vi.stubGlobal('fetch', fetcher);
    const row = await getProject('x');
    expect(row.id).toBe('');
    expect(row.name).toBe('');
    expect(row.code).toBeNull();
  });
});

describe('project API — legacyImportProject normalize 防御性 (pure)', () => {
  it('markedCodes 缺失/非数组时降级为空数组，不抛错', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(envelope({ project: projectFixture() }));
    vi.stubGlobal('fetch', fetcher);
    const result = await legacyImportProject({
      declaredStage: 'PLAN',
      legacyEffectiveAt: 1_700_000_000_000,
      level: 'A',
      levelCoefficient: null,
      levelCoefficientReason: null,
      mainGroupId: 'g-1',
      missingHistoryAck: true,
      name: 'n',
      productId: 'p',
      targetChannelCount: 1,
      targetMarkets: [],
      targetNps: 1,
      targetSalesAmount: 1,
      targetSceneCount: 1,
      templateType: 'SOFTWARE',
    });
    expect(result.markedCodes).toEqual([]);
  });
});

describe('project API — getGateChecklist normalize 防御性 (pure)', () => {
  it('items 缺省/非数组时降级为空数组', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({
        configVersion: null,
        level: null,
        projectId: '100',
        stage: null,
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(view.items).toEqual([]);
  });

  it('items 行畸形（仅部分字段）仍能归一化，缺失字段用空串/null/ok=false 占位', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({
        configVersion: null,
        items: [{ code: 'A' }, { code: 'B', ok: true }],
        level: null,
        projectId: '100',
        stage: null,
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(view.items[0]).toEqual({
      code: 'A',
      name: '',
      stage: '',
      status: null,
      ok: false,
      reason: '',
    });
    expect(view.items[1]?.ok).toBe(true);
  });

  it('ok 严格判定：仅 true 才为 true（不为 truthy 字符串）', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({
        configVersion: null,
        items: [
          {
            code: 'A',
            ok: 'true',
            name: 'n',
            reason: 'r',
            stage: 'CONCEPT',
            status: 'OK',
          },
        ],
        level: null,
        projectId: '100',
        stage: 'CONCEPT',
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(view.items[0]?.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// C. parseTargetMarkets 容错（pure — JSON 解析失败一律降级空数组）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — parseTargetMarkets 容错 (pure)', () => {
  it('解析合法 JSON 数组字符串', () => {
    expect(parseTargetMarkets('["SA","AE"]')).toEqual(['SA', 'AE']);
  });

  it('解析对象/null/数字统一降级为空数组', () => {
    expect(parseTargetMarkets('{"a":1}')).toEqual([]);
    expect(parseTargetMarkets('123')).toEqual([]);
  });

  it('空 / null / undefined 视为无市场配置', () => {
    expect(parseTargetMarkets(null)).toEqual([]);
    expect(parseTargetMarkets(undefined)).toEqual([]);
    expect(parseTargetMarkets('')).toEqual([]);
  });

  it('非字符串 JSON（例如对象）也走 JSON.parse 路径', () => {
    // 真实场景下后端可能直接传对象，但 toRecord 之后 raw 仍可能是 string;
    // 直接传对象会被 JSON.parse 接受并降级（Array.isArray=false）。
    expect(parseTargetMarkets('"SA"')).toEqual([]);
  });

  it('非法 JSON 不抛错，返回空数组', () => {
    expect(parseTargetMarkets('[SA,AE')).toEqual([]);
    expect(parseTargetMarkets('not-json{')).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// D. 错误路径解析（pure — 与后端实际响应解耦）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — 错误传播 (pure)', () => {
  it('hTTP 500 + envelope.code != 0 抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 500, 99_999));
    vi.stubGlobal('fetch', fetcher);
    await expect(listProjects()).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('非 JSON 响应（HTML 网关）抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('<html>502</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(listProjects()).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('fetch 抛 TypeError（断网）抛 IpdRequestError 传输类', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new TypeError('network unavailable'));
    vi.stubGlobal('fetch', fetcher);
    await expect(listProjects()).rejects.toBeInstanceOf(IpdRequestError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// E. R215 WP3.1 批次3 = ORPHAN-A2：项目认证项四端点（ProjectController P1-7.1）
//    清单 / 同步 / 手工补充 / 状态流转（DONE 不被 sync 重置）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — ORPHAN-A2 认证项契约', () => {
  const certItemFixture = {
    id: '2098349975414013954',
    projectId: '100',
    templateId: '1948090600',
    countryCode: 'CN',
    countryName: '中国',
    certName: 'CCC',
    certAuthority: null,
    requirementDesc: '中国强制性产品认证',
    isMandatory: '1',
    source: 'AUTO',
    status: 'PENDING',
    catalogVersion: 'tpl-4-e4f2c2ee',
  };

  it('listProjectCertItems → GET /projects/{id}/cert-items，视图归一化透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({
        projectId: '100',
        catalogVersion: 'tpl-4-e4f2c2ee',
        unknownMarkets: ['XX'],
        items: [certItemFixture],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = await listProjectCertItems('100');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/projects/100/cert-items');
    expect(view.unknownMarkets).toEqual(['XX']);
    expect(view.items[0]!.id).toBe('2098349975414013954');
    expect(view.items[0]!.status).toBe('PENDING');
    expect(view.items[0]!.certAuthority).toBeNull();
  });

  it('syncProjectCertItems → POST /cert-items/sync（body 空），返回新增条数', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(3));
    vi.stubGlobal('fetch', fetcher);
    const added = await syncProjectCertItems('100');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/projects/100/cert-items/sync');
    expect(call[1]?.method).toBe('POST');
    expect(added).toBe(3);
  });

  it('addProjectCertItem → POST /cert-items，body 为 AC-PROD-12 白名单 5 字段', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(envelope({ ...certItemFixture, source: 'MANUAL' }));
    vi.stubGlobal('fetch', fetcher);
    const item = await addProjectCertItem('100', {
      certAuthority: 'TÜV',
      certName: 'CE',
      countryCode: 'DE',
      countryName: '德国',
      isMandatory: '0',
    });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/projects/100/cert-items');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
      certAuthority: 'TÜV',
      certName: 'CE',
      countryCode: 'DE',
      countryName: '德国',
      isMandatory: '0',
    });
    expect(item.source).toBe('MANUAL');
  });

  it('changeProjectCertItemStatus → POST /cert-items/{itemId}/status?target=DONE（target 走 query）', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(envelope({ ...certItemFixture, status: 'DONE' }));
    vi.stubGlobal('fetch', fetcher);
    const item = await changeProjectCertItemStatus(
      '100',
      '2098349975414013954',
      'DONE',
    );
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe(
      '/api/v1/projects/100/cert-items/2098349975414013954/status?target=DONE',
    );
    expect(call[1]?.method).toBe('POST');
    expect(item.status).toBe('DONE');
  });

  it('低权限写操作 → 后端 403/10001 拒绝包装为 IpdRequestError（权限负例代表）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 403, 10_001));
    vi.stubGlobal('fetch', fetcher);
    await expect(syncProjectCertItems('100')).rejects.toBeInstanceOf(
      IpdRequestError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F. R215 WP3.1 批次3 = ORPHAN-A3：基线 / 上市日期 / 成员 / 存量批量导入
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — ORPHAN-A3 基线/上市日期/成员/存量批量契约', () => {
  it('updateProjectBaselines → POST /{id}/baselines，body 四项基准为数字', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(envelope(projectFixture({ targetNps: 70 })));
    vi.stubGlobal('fetch', fetcher);
    const project = await updateProjectBaselines('100', {
      targetChannelCount: 40,
      targetNps: 70,
      targetSalesAmount: 6_000_000,
      targetSceneCount: 6,
    });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/projects/100/baselines');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(String(call[1].body))).toEqual({
      targetChannelCount: 40,
      targetNps: 70,
      targetSalesAmount: 6_000_000,
      targetSceneCount: 6,
    });
    expect(project.targetNps).toBe(70);
  });

  it('recordProjectLaunchDate → POST /{id}/launch-date，body {launchDate:yyyy-MM-dd, reason}', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        envelope(projectFixture({ launchDate: 1_794_672_000_000 })),
      );
    vi.stubGlobal('fetch', fetcher);
    const project = await recordProjectLaunchDate(
      '100',
      '2026-12-11',
      'L08 初次录入：渠道备货排期确认',
    );
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/projects/100/launch-date');
    expect(JSON.parse(String(call[1].body))).toEqual({
      launchDate: '2026-12-11',
      reason: 'L08 初次录入：渠道备货排期确认',
    });
    expect(project.launchDate).toBe(1_794_672_000_000);
  });

  it('listProjectMembers → GET /{projectId}/members，成员快照数组归一化', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope([
        {
          id: '2100001',
          projectId: '100',
          personId: '9001',
          role: 'RD_PM',
          memberType: 'CORE',
          approvalRef: null,
          lockedLevel: 'P6',
          lockedAmount: '12000.00',
          joinDate: '2026-09-01',
          exitDate: null,
          exitReason: null,
          bonusEligible: '1',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    const members = await listProjectMembers('100');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/projects/100/members');
    expect(members[0]!.role).toBe('RD_PM');
    expect(members[0]!.lockedAmount).toBe('12000.00');
    expect(members[0]!.exitDate).toBeNull();
  });

  it('bindProjectMember → POST /{projectId}/members，personId 字符串透传（19 位无损）、空 approvalRef 不序列化', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({
        id: '2100002',
        projectId: '100',
        personId: '2096266884247736321',
        role: 'MARKET_PM',
        memberType: null,
        approvalRef: null,
        lockedLevel: null,
        lockedAmount: null,
        joinDate: '2026-09-25',
        exitDate: null,
        exitReason: null,
        bonusEligible: null,
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    await bindProjectMember('100', {
      approvalRef: '',
      personId: '2096266884247736321',
      role: 'MARKET_PM',
    });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/projects/100/members');
    expect(call[1]?.method).toBe('POST');
    const body = JSON.parse(String(call[1].body));
    expect(body).toEqual({ personId: '2096266884247736321', role: 'MARKET_PM' });
    expect(typeof body.personId).toBe('string');
    expect('approvalRef' in body).toBe(false);
  });

  it('legacyImportProjectsBatch → POST /legacy-import/batch，rows 走 toWire（targetMarkets JSON 字符串）', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope([
        {
          index: 0,
          ok: true,
          projectId: '2096001',
          error: null,
          markedCodes: ['SA-C4'],
        },
        {
          index: 1,
          ok: false,
          projectId: null,
          error: '产品 ID 不存在: p-404',
          markedCodes: [],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    const rows = await legacyImportProjectsBatch([
      {
        declaredStage: 'DEV',
        legacyEffectiveAt: 1_789_000_000_000,
        level: 'A',
        levelCoefficient: null,
        levelCoefficientReason: null,
        mainGroupId: '1948001',
        missingHistoryAck: true,
        name: '存量A',
        productId: '1948002',
        targetChannelCount: 5,
        targetMarkets: ['SA'],
        targetNps: 40,
        targetSalesAmount: 500_000,
        targetSceneCount: 2,
        templateType: 'HARDWARE',
      },
    ]);
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/projects/legacy-import/batch');
    expect(Array.isArray(JSON.parse(String(call[1].body)))).toBe(true);
    expect(JSON.parse(String(call[1].body))[0]).toMatchObject({
      name: '存量A',
      targetMarkets: '["SA"]',
      missingHistoryAck: true,
    });
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.markedCodes).toEqual(['SA-C4']);
    expect(rows[1]!.error).toBe('产品 ID 不存在: p-404');
  });
});
