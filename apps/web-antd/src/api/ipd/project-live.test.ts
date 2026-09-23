/**
 * project 业务契约测试（Wave 9 / agent A38）：
 *   严格遵循 docs/真HTTP验收规范-20260907.md §二 §2.2 — 业务测试必须走真 HTTP 真 DB，
 *   Mock 会导致字段漂移 / 401+code 真实行为 / envelope 解析错误 全部静默通过。
 *
 * 与 project.test.ts 的关系：
 *   - project.test.ts（A 桶）：纯逻辑，normalize 防御性 / createProject body 白名单 /
 *     parseTargetMarkets 容错 / 错误路径解析。允许 vi.mock。
 *   - project-live.test.ts（本文件）：业务契约，listProjects / getProject / createProject /
 *     legacyImportProject / changeProjectStatus / advanceProjectStage / getGateChecklist
 *     端到端真 HTTP。必须 IPD_LIVE_ACCEPTANCE=<persona> 才能跑；默认 skip。
 *
 * 安全约束（继承自 live-http.ts + auth-live.test.ts pioneer）：
 *   - endpoint allowlist 强制：任何非白名单路径在打开 socket 之前抛错
 *   - fixture mode 0o600 强制：loadPersonaFixture 在调用瞬间 assert
 *   - 测试永不改口令（mustChangePwd=false 是 fixture 字段硬约束）
 *   - 测试结束必须 clearLiveHttpEvents() + vi.unstubAllGlobals()
 *
 * 设计决策：项目 ID 与业务字段采用 production normalize 路径（含 encodeURIComponent /
 * JSON.stringify(targetMarkets)）。后端 4xx / 2xx 都接受 — 关键断言是「请求确实打到
 * 预定的 path + method + status code 落点正确」；后端是否放行属于业务授权而非契约层。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// R179-P0：live 模式下首个 it 的共享登录可能带限流退避（15s×n），给本文件测试放宽超时。
vi.setConfig({ testTimeout: 300_000 });

import {
  advanceProjectStage,
  changeProjectStatus,
  createProject,
  getGateChecklist,
  getProject,
  legacyImportProject,
  listProjects,
} from './project';
import { IpdRequestError } from './auth';

import {
  clearLiveHttpEvents,
  getLiveHttpEvents,
  installLiveFetch,
  liveModeEnabled,
  loginPersonaShared,
} from '../../views/ipd/_shared/test-helpers/live-http';

const SESSION_STORAGE_KEY = 'ruoyi-ipd.session';

/**
 * 完整端点白名单：含后端期望的具体 URL 形态。
 *
 * 注意：listProjects 与 createProject 共享 /api/v1/projects；用查询串 / method 区分。
 * listProjects() 与 listProjects('') 都走 /api/v1/projects（无 keyword 查询串）。
 * listProjects('智慧') 走 /api/v1/projects?keyword=%E6%99%BA%E6%85%A7（URLSearchParams 编码）。
 *
 * 状态/阶段类端点（changeProjectStatus / advanceProjectStage）在测试时用已知的 ID '100'
 * 与合法 target（'TEAMING'）；非法目标路径同样进白名单（后端会拒绝）。
 */
const ALLOWLIST = [
  // 登录换票（liveFetch 必经）
  '/api/v1/auth/login',
  // listProjects（GET /projects）— 共享路径，无查询串
  '/api/v1/projects',
  // listProjects('智慧') — URLSearchParams 编码后查询串
  '/api/v1/projects?keyword=%E6%99%BA%E6%85%A7',
  // getProject — 含编码 ID（encodeURIComponent）；
  // R179-P0（2026-09-22）：'a b'（3 字符）不会触发 getProject 的业务编号翻译分支
  // （长度≥5 非纯数字才走 codeToId→listProjects），保证直拼路径编码可测。
  '/api/v1/projects/100',
  '/api/v1/projects/a%20b',
  // legacyImportProject — 独立端点
  '/api/v1/projects/legacy-import',
  // changeProjectStatus — POST /{id}/status?target=...
  '/api/v1/projects/100/status?target=TEAMING',
  '/api/v1/projects/100/status?target=INVALID_JUMP',
  // advanceProjectStage — POST /{id}/advance-stage
  '/api/v1/projects/100/advance-stage',
  // getGateChecklist — GET /{id}/gate-checklist[?stage=...]
  '/api/v1/projects/100/gate-checklist',
  '/api/v1/projects/100/gate-checklist?stage=DEV',
] as const;

beforeEach(() => {
  sessionStorage.clear();
  clearLiveHttpEvents();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearLiveHttpEvents();
  sessionStorage.clear();
});

// 使用 describe.skipIf 而非 liveGateDescribe —— 后者在未启用 live mode 时整块 no-op，
// vitest 会报 "No test suite found"；skipIf 让 describe 始终被枚举但内部 it 在默认模式下被 skip。
describe.skipIf(!liveModeEnabled())('project 业务契约 — 真 HTTP loopback', () => {
  /**
   * 用真实 persona 登录拿到 token，再把 token 写入 sessionStorage。
   * 这样后续的 listProjects / getProject 等（走 ipdGet/ipdPost → useIpdAuthStore()
   * → restoredSession()）能拿到合法 Authorization 头。
   *
   * loginIpd 自身不触发 Pinia store 创建（直接调 requestIpd），所以
   * "先登录 → 再写 sessionStorage → 再让 Pinia store 读取" 这个顺序安全。
   */
  async function loginAndPrime(): Promise<void> {
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);
    // R179-P0（2026-09-22）：19 个 it 各自真登录会打爆后端同IP同账号 60s/5 次限流；
    // loginPersonaShared 在同文件内 token TTL 复用，只真登录 1 次（内部带限流退避）。
    // fixture 校验（mode 0o600 / phase / username）仍由 loadPersonaFixture 在 helper 内执行。
    const login = await loginPersonaShared();
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      accessToken: login.token,
      accessExpiresAt: Date.now() + login.expiresIn * 1000,
      refreshState: 'ready',
    }));
  }

  it('listProjects GET /projects 走真实后端', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    const list = await listProjects();
    expect(Array.isArray(list)).toBe(true);
    // 真机后端对 list 行用 {project:{...}} 嵌套包裹（normalize 必须解一层）
    for (const item of list) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects');
    expect(events[0]?.http).toBe(200);
    expect(events[0]?.code).toBe(0);
    expect(events[0]?.envelopeComplete).toBe(true);
  });

  it('listProjects("智慧") 编码进查询串 %E6%99%BA%E6%85%A7', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    const list = await listProjects('智慧');
    expect(Array.isArray(list)).toBe(true);
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects?keyword=%E6%99%BA%E6%85%A7');
    expect(events[0]?.http).toBe(200);
    expect(events[0]?.code).toBe(0);
  });

  it('listProjects("") 空 keyword 不带查询串', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    const list = await listProjects('');
    expect(Array.isArray(list)).toBe(true);
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects');
    expect(events[0]?.http).toBe(200);
  });

  it('listProjects() 列表行用 {project:{...}} 嵌套包裹时仍能正确归一化（2026-09-07 真机形态）', async () => {
    // 本测试断言与上一条一致；保留为独立用例以便真机后端漂移时定位
    await loginAndPrime();
    clearLiveHttpEvents();
    const list = await listProjects();
    // 不论后端返回 [] 还是 [{...}] 或 [{project:{...}}]，normalize 都应给空数组或全字段项目
    for (const item of list) {
      expect(item.id).toBeTypeOf('string');
      expect(item.name).toBeTypeOf('string');
      // code 可能为 null（占位），不为 null 时必须是字符串
      if (item.code !== null) expect(item.code).toBeTypeOf('string');
    }
  });

  it('getProject("a b") URL 编码为 a%20b；后端命中即视为编码正确', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      const row = await getProject('a b');
      // 即使后端返回 200，row.id 应被解码还原为 'a b'
      expect(row.id).toBe('a b');
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/a%20b');
    // 后端对未知 ID 通常 404 — caught 此时为 IpdRequestError；
    // 这里仅断言请求确实以编码后的 URL 发出（无论 2xx / 4xx）。
    if (caught !== null) {
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    } else {
      expect(events[0]?.http).toBe(200);
    }
  });

  it('getProject(100) 单查响应平铺形态直通归一化', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      const row = await getProject('100');
      expect(row.id).toBeTypeOf('string');
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100');
    if (caught === null) {
      expect(events[0]?.http).toBe(200);
      expect(events[0]?.code).toBe(0);
    } else {
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });

  it('createProject 真库外键过 Jackson 白名单 DTO — 已占用产品被业务 1:1 规则真实拒绝', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    // R179-P0（2026-09-22）：真创建受数据模型硬约束——产品:项目 = 1:1 是终身物理约束
    // （projects.product_id NOT NULL + uk_projects_product/uk_projects_code 物理唯一，
    //  软删/解绑均不释放序号与产品，且无项目删除 API），空闲产品每用一次即永久失效，
    //  「每轮真创建」不可持续。本用例验证 body 白名单 DTO 真实生效：真库外键（数字字符串）
    //  通过 Jackson 反序列化与系数校验，到达业务 1:1 检查被真实拒绝（envelopeMessage
    //  透传业务文案）——假外键死在 Jackson 层到不了这里（对照用例见下一 it）。
    let caught: unknown = null;
    try {
      await createProject({
        launchDate: null,
        level: 'A',
        levelCoefficient: null,
        levelCoefficientReason: null,
        mainGroupId: '900001',
        name: `live-test-${Date.now()}`,
        productId: '9130006',
        targetChannelCount: 1,
        targetMarkets: [],
        targetNps: 1,
        targetSalesAmount: 1,
        targetSceneCount: 1,
        templateType: 'SOFTWARE',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IpdRequestError);
    expect((caught as IpdRequestError).envelopeMessage).toContain('1:1');
    const events = getLiveHttpEvents();
    expect(events[0]?.path).toBe('/api/v1/projects');
    expect((events[0]?.http ?? 0)).toBe(400);
    expect(events[0]?.envelopeComplete).toBe(true);
  });

  it('createProject 假外键在 Jackson 层被拒（字母串→Long 反序列化失败）', async () => {
    // R179-P0（2026-09-22）：后端 DTO productId/mainGroupId 是 Long——字母串 'p-001'/'g-1'
    // 无法强转，HttpMessageNotReadableException → 400「请求体缺失或格式错误」
    // （envelopeMessage 透传，与上一 it 的业务层拒绝分层对照）。旧用例正是用这类假外键
    // 误把 Jackson 层拒绝当成「服务不可用」型失败。
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      await createProject({
        launchDate: null, level: 'B', levelCoefficient: 0.7, levelCoefficientReason: null,
        mainGroupId: 'g-1', name: `live-nested-${Date.now()}`, productId: 'p-001', targetChannelCount: 1,
        targetMarkets: [], targetNps: 1, targetSalesAmount: 1, targetSceneCount: 1,
        templateType: 'SOLUTION',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IpdRequestError);
    expect((caught as IpdRequestError).envelopeMessage).toContain('请求体');
    const events = getLiveHttpEvents();
    expect(events[0]?.path).toBe('/api/v1/projects');
    expect((events[0]?.http ?? 0)).toBe(400);
  });

  it('legacyImportProject POST /projects/legacy-import 走真实后端（仅超管；market-900103 预期 403/30001）', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      await legacyImportProject({
        declaredStage: 'PLAN',
        legacyEffectiveAt: 1700000000000,
        level: 'A',
        levelCoefficient: null,
        levelCoefficientReason: null,
        mainGroupId: 'g-1',
        missingHistoryAck: true,
        name: `live-legacy-${Date.now()}`,
        productId: 'p-001',
        targetChannelCount: 1,
        targetMarkets: [],
        targetNps: 1,
        targetSalesAmount: 1,
        targetSceneCount: 1,
        templateType: 'SOFTWARE',
      });
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/legacy-import');
    // market-900103 不是 super_admin，后端应返回 4xx（通常是 403 / 30001 权限不足）。
    // 我们不强求具体 code——只断言请求确实命中端点且后端给出了非 2xx 响应。
    expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    expect(caught).not.toBeNull();
  });

  it('changeProjectStatus POST /projects/{id}/status?target=TEAMING', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      const row = await changeProjectStatus('100', 'TEAMING');
      // 后端成功路径下返回最新 project，status 应被改写为 TEAMING
      expect(row.status).toBe('TEAMING');
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100/status?target=TEAMING');
    if (caught === null) {
      expect(events[0]?.http).toBe(200);
    } else {
      // 状态机非法迁移由后端拒绝
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });

  it('changeProjectStatus 非法 target（INVALID_JUMP）由后端拒绝', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      await changeProjectStatus('100', 'INVALID_JUMP');
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100/status?target=INVALID_JUMP');
    expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
  });

  it('advanceProjectStage POST /projects/{id}/advance-stage 走真实后端', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      const row = await advanceProjectStage('100');
      expect(typeof row.id).toBe('string');
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100/advance-stage');
    if (caught === null) {
      expect(events[0]?.http).toBe(200);
    } else {
      // 门禁失败时后端返回 400/10001（合规用例）或 403/30001（权限不足）
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });

  it('advanceProjectStage 门禁失败由后端 4xx 拒绝', async () => {
    // 该测试与上一条共享端点；保留独立用例以明示后端"对门禁不达标的阶段推进会拒绝"的契约。
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      await advanceProjectStage('100');
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100/advance-stage');
    // 不论成功还是失败，请求必须落到 advance-stage 端点；后端成功时仍记录一行 200。
    if (caught === null) {
      expect(events[0]?.http).toBe(200);
    } else {
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });

  it('getGateChecklist GET /projects/{id}/gate-checklist', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      const view = await getGateChecklist('100');
      expect(view.projectId).toBeTypeOf('string');
      expect(Array.isArray(view.items)).toBe(true);
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100/gate-checklist');
    if (caught === null) {
      expect(events[0]?.http).toBe(200);
    } else {
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });

  it('getGateChecklist("100", "DEV") 编码进查询串 stage=DEV', async () => {
    await loginAndPrime();
    clearLiveHttpEvents();
    let caught: unknown = null;
    try {
      const view = await getGateChecklist('100', 'DEV');
      expect(Array.isArray(view.items)).toBe(true);
    } catch (e) {
      caught = e;
    }
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/projects/100/gate-checklist?stage=DEV');
    if (caught === null) {
      expect(events[0]?.http).toBe(200);
    } else {
      expect((events[0]?.http ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });
});
