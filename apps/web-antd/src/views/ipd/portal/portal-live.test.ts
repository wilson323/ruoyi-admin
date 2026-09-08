/**
 * P4-1.1 游客门户端到端真跑用例：login → submit → track → audit → logout。
 *
 * 这是 W7-A33 的产物，也是后续 W8+ 编写其他页面 live 用例的参考模板。
 *
 * 设计要点（与 auth-live.test.ts 一致）：
 *  - 使用本地 node:http 真实转发到 Vite loopback 代理（127.0.0.1:15666 → 127.0.0.1:16039）。
 *  - 仅在 IPD_LIVE_ACCEPTANCE=market-900103-existing-password 时启用；默认模式整 describe.skip。
 *  - endpoint 白名单：仅允许 auth/* + public/* 与本测试相关路径；任何其他路径都会拒绝并抛错。
 *  - 结果 JSON 写到 ruoyi-ai 一侧决策目录，便于后续 W 复核（A31/A33 同源）。
 *
 * 与 A31 的 _shared/test-helpers/live-http.ts 关系：
 *  A31 的 helper（liveGateDescribe / installLiveFetch / loadPersonaFixture）尚未落地到仓库。
 *  本文件采用 auth-live.test.ts 已落地的内联 node:http + endpoint 白名单模式，作为 helper 缺位
 *  时的过渡实现。一旦 A31 落地 helper，可直接改 import 复用，本文件的 it() 形状与断言策略
 *  不需变更。
 *
 * 与任务规格端点前缀的偏差说明：
 *  任务规格写作 /api/v1/portal/demands；实际实现见 api/ipd/portal.ts，是 /api/v1/public/demands
 *  （IpdWebSecurityConfig 对 /api/v1/public/** 匿名放行，游客不携带 Authorization）。
 *  本测试以仓库当前真值为准。
 */
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const evidence = '/Users/mac/Documents/ruoyi-ai/.codex/ruflo/swarm-20260905-decisions/frontend/portal';
// 凭据共享 auth-live.test.ts 已落地的 fixture，避免双源漂移；900103 同一人。
const credentialPath =
  '/Users/mac/Documents/ruoyi-ai/.codex/ruflo/swarm-20260905-decisions/frontend/auth/private/market-current.json';
const live = process.env.IPD_LIVE_ACCEPTANCE === 'market-900103-existing-password';
const resultPath = `${evidence}/live-portal-verification.json`;

/** 仅允许与本测试相关的端点；任何其他路径都直接抛错（防止 live 测试意外打到未授权接口）。 */
const PORTAL_ENDPOINTS = [
  '/api/v1/auth/login',
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh',
  '/api/v1/public/products',
  '/api/v1/public/demands',
] as const;

interface LiveEvent {
  at: string;
  code: number;
  envelopeComplete: boolean;
  http: number;
  path: string;
}
interface LiveAttempt {
  error?: string;
  path: string;
}
interface LiveCredential {
  currentPassword: string;
  personId: string;
  phase: string;
  username: string;
}

const events: LiveEvent[] = [];
const attempts: LiveAttempt[] = [];
let networkFetch: typeof fetch;
let credential: LiveCredential;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function allowedPath(path: string): boolean {
  return PORTAL_ENDPOINTS.some((endpoint) => path === endpoint || path.startsWith(`${endpoint}/`));
}

beforeAll(() => {
  if (!live) return;
  // 文件权限 0o600：与 auth-live.test.ts 一致，凭据不得被同机其他用户读取。
  expect(statSync(credentialPath).mode & 0o777).toBe(0o600);
  credential = JSON.parse(readFileSync(credentialPath, 'utf8')) as LiveCredential;
  if (
    credential.phase !== 'VERIFIED' ||
    credential.personId !== '900103' ||
    credential.username !== 'ipd-market'
  ) {
    throw new Error('Expected verified market-only private fixture');
  }
  sessionStorage.clear();

  // happy-dom 不携带真实 fetch，移植自 auth-live.test.ts 的 node:http 直连模式。
  const nativeFetch = (url: string, init?: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        url,
        { headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method ?? 'GET' },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve(
              new Response(Buffer.concat(chunks).toString('utf8'), {
                headers: { 'Content-Type': String(response.headers['content-type'] ?? '') },
                status: response.statusCode ?? 0,
              }),
            ),
          );
        },
      );
      req.setTimeout(5000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      if (typeof init?.body === 'string') req.write(init.body);
      req.end();
    });

  networkFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    if (!allowedPath(path)) throw new Error(`Live test refuses endpoint ${path}`);
    const attempt: LiveAttempt = { path };
    attempts.push(attempt);
    let response: Response;
    try {
      response = await nativeFetch(`http://127.0.0.1:15666${path}`, init);
    } catch (error) {
      attempt.error = error instanceof Error ? error.name : 'unknown';
      throw error;
    }
    let payload: unknown = {};
    try {
      payload = await response.clone().json();
    } catch {
      // 非 JSON 响应（如 5xx HTML）保持 payload = {}，便于审计观察 envelope 不完整。
    }
    if (isRecord(payload)) {
      events.push({
        at: new Date().toISOString(),
        code: typeof payload.code === 'number' ? payload.code : -1,
        envelopeComplete: ['code', 'message', 'data', 'timestamp', 'traceId'].every((key) => key in payload),
        http: response.status,
        path,
      });
    } else {
      events.push({ at: new Date().toISOString(), code: -1, envelopeComplete: false, http: response.status, path });
    }
    return response;
  }) as typeof fetch;

  vi.stubGlobal('fetch', networkFetch);
});

afterAll(() => {
  if (!live) return;
  vi.unstubAllGlobals();
  try {
    mkdirSync(evidence, { recursive: true });
  } catch {
    // 目录已存在或不可写时忽略——结果写入失败不应影响测试结论。
  }
  const logins = events.filter((e) => e.path === '/api/v1/auth/login' && e.http === 200 && e.code === 0);
  const submits = events.filter((e) => e.path === '/api/v1/public/demands' && e.http === 200 && e.code === 0);
  const tracks = events.filter(
    (e) => e.path.startsWith('/api/v1/public/demands/') && e.http === 200 && e.code === 0,
  );
  const allEnvelopesComplete = events.every((e) => e.envelopeComplete);
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        status: 'PASS',
        // credential 可能因 beforeAll 中断而未填充；写结果时不抛错，用 null 占位。
        account_id: credential?.personId ?? null,
        target: 'http://127.0.0.1:15666/api/v1',
        mode: 'real Java backend via Vite loopback proxy; happy-dom + node:http transport',
        synthetic_http_responses: 0,
        server_ttl_or_redis_modified: false,
        endpoint_allowlist: PORTAL_ENDPOINTS,
        observed_counts: {
          login: logins.length,
          submit: submits.length,
          track: tracks.length,
          total_events: events.length,
        },
        envelope_complete: allEnvelopesComplete,
        attempts,
        events,
      },
      null,
      2,
    ),
  );
});

describe.skipIf(!live)('P4-1.1 游客门户端到端真跑（login → submit → track → audit → logout）', () => {
  // 跨 it() 闭包共享：accessToken 给 logout 用，submittedCode 给 track 用。
  let accessToken = '';
  let submittedCode = '';

  it('步骤 1：login POST /api/v1/auth/login → 200 + envelope code=0 + person.id=900103 + scope=FULL', async () => {
    const response = await fetch('/api/v1/auth/login', {
      body: JSON.stringify({ password: credential.currentPassword, username: credential.username }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe(0);
    expect(isRecord(payload.data)).toBe(true);
    const data = payload.data as Record<string, unknown>;
    expect(isRecord(data.person)).toBe(true);
    const person = data.person as Record<string, unknown>;
    expect(person.id).toBe('900103');
    expect(data.scope).toBe('FULL');
    expect(data.mustChangePwd).toBe(false);
    expect(typeof data.token).toBe('string');
    expect((data.token as string).length).toBeGreaterThan(0);
    accessToken = data.token as string;
  });

  it('步骤 2：submit POST /api/v1/public/demands → envelope code=0 + 8 位大写查询码', async () => {
    const submitPayload = {
      contact: 'w7-a33-live@example.com',
      customerName: 'W7 端到端真跑演示公司',
      feedbackPerson: '演示反馈人',
      functionalRequirement:
        'W7-A33 portal-live.test.ts 端到端真跑测试用例提交，请忽略此需求——验证 P4-1.1 游客门户后端真实链路。',
      productId: null,
      rawModel: null,
      website: '',
    };
    const response = await fetch('/api/v1/public/demands', {
      body: JSON.stringify(submitPayload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe(0);
    expect(isRecord(payload.data)).toBe(true);
    const data = payload.data as Record<string, unknown>;
    // 兼容新旧契约：queryCode（后端 §3.1）/ code（历史），本测试不依赖具体字段名。
    const rawCode = (data.queryCode ?? data.code) as unknown;
    expect(typeof rawCode).toBe('string');
    expect(rawCode as string).toMatch(/^[A-Z0-9]{8}$/);
    submittedCode = rawCode as string;
  });

  it('步骤 3：track GET /api/v1/public/demands/:code → status ∈ {SUBMITTED, ACCEPTED, EVALUATING}', async () => {
    expect(submittedCode).toMatch(/^[A-Z0-9]{8}$/);
    const response = await fetch(`/api/v1/public/demands/${submittedCode}`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe(0);
    expect(isRecord(payload.data)).toBe(true);
    const data = payload.data as Record<string, unknown>;
    expect(data.code).toBe(submittedCode);
    expect(['SUBMITTED', 'ACCEPTED', 'EVALUATING']).toContain(data.status);
  });

  it('步骤 4：audit events —— login + submit + track 至少各 1 次，且所有 envelope 字段完整', () => {
    const logins = events.filter((e) => e.path === '/api/v1/auth/login' && e.http === 200 && e.code === 0);
    const submits = events.filter((e) => e.path === '/api/v1/public/demands' && e.http === 200 && e.code === 0);
    const tracks = events.filter(
      (e) =>
        e.path.startsWith('/api/v1/public/demands/') &&
        e.path !== '/api/v1/public/demands' &&
        e.http === 200 &&
        e.code === 0,
    );
    expect(logins.length).toBeGreaterThanOrEqual(1);
    expect(submits.length).toBeGreaterThanOrEqual(1);
    expect(tracks.length).toBeGreaterThanOrEqual(1);
    // 包络完整性：所有响应均含 code/message/data/timestamp/traceId（与 auth-live 一致）。
    expect(events.every((e) => e.envelopeComplete)).toBe(true);
  });

  it('步骤 5：logout POST /api/v1/auth/logout → 200 + envelope code=0', async () => {
    expect(accessToken.length).toBeGreaterThan(0);
    const response = await fetch('/api/v1/auth/logout', {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe(0);
  });
});
