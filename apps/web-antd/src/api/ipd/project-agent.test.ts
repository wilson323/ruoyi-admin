/**
 * 项目智能体 API 契约（单测层，fetch 替身；不是联调证据）。
 *
 * 钉死：路径不重复拼 /api/v1、HTTP 方法、code=0 包络解包、非 0 包络抛错、
 * 字符串 ID 原样透传（不转数值）、幂等键原样透传、状态/事件辅助函数穷尽。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../store/ipd-auth';
import { IpdRequestError } from './auth';
import {
  agentRunStatusMeta,
  applyAgentRunArtifact,
  downloadAgentRunArtifact,
  cancelAgentRun,
  reverifyAgentRun,
  listAgentRunSkillReviews,
  reviewAgentRunSkill,
  resumeAgentRun,
  createProjectAgentRun,
  fetchAgentRun,
  fetchAgentRunEvents,
  fetchProjectAgentCapabilities,
  listProjectAgentRuns,
  isAgentRunCancellable,
  isAgentRunTerminal,
  saveAiFeedback,
  type AgentRunStatus,
} from './project-agent';

/** 构造 code=0 成功包络。 */
const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-29T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

/** 构造业务失败包络。 */
const failure = (status: number, code: number, message: string) =>
  new Response(JSON.stringify({ code, message, data: null, traceId: 'trace-x' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** 取第 n 次 fetch 调用的 url 与 init。 */
function call(fetcher: ReturnType<typeof vi.fn>, n = 0): [string, RequestInit & { body?: unknown }] {
  return fetcher.mock.calls[n] as [string, RequestInit & { body?: unknown }];
}

/** 把请求体统一还原成对象（requestIpd 可能序列化为 JSON 字符串）。 */
function bodyOf(init: RequestInit & { body?: unknown }): unknown {
  return typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  useIpdAuthStore().token = 'test-session';
});
afterEach(() => vi.unstubAllGlobals());

describe('project agent API contract', () => {
  it('reads and reviews a skill candidate on the original run with string sequence and digest', async () => {
    const item = { candidateSeq: '9007199254740993', skillName: 'source-check', sha256: 'abc', status: 'PENDING', files: [], scanSummary: '安全检查已执行' };
    const fetcher = vi.fn().mockResolvedValueOnce(envelope([item])).mockResolvedValueOnce(envelope({ ...item, status: 'PUBLISHED' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await listAgentRunSkillReviews('run-8')).toEqual([item]);
    expect(call(fetcher)[0]).toContain('/api/v1/agent-runs/run-8/skill-reviews');
    await reviewAgentRunSkill('run-8', item.candidateSeq, { approved: true, sha256: 'abc', comment: '已查看' });
    const [url, init] = call(fetcher, 1);
    expect(url).toContain('/agent-runs/run-8/skill-reviews/9007199254740993/review');
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual({ approved: true, sha256: 'abc', comment: '已查看' });
  });

  it('rechecks the same string run through the existing code0 contract', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(envelope({ runId: '9007199254740993', status: 'VERIFYING' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await reverifyAgentRun('9007199254740993')).toEqual({ runId: '9007199254740993', status: 'VERIFYING' });
    const [url, init] = call(fetcher);
    expect(url).toContain('/api/v1/agent-runs/9007199254740993/reverify');
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual({});
  });
  it('downloads exact string version bytes with Person authorization, never treating error JSON as a file', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 255]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    })).mockResolvedValueOnce(failure(403, 30001, '无权访问该项目'))
      .mockResolvedValueOnce(envelope({ fake: 'attachment' }));
    vi.stubGlobal('fetch', fetcher);
    const blob = await downloadAgentRunArtifact('9007199254740993', '0019007199254740995');
    expect(call(fetcher)[0]).toBe('/api/v1/agent-runs/9007199254740993/artifacts/versions/0019007199254740995/download');
    expect(call(fetcher)[1].headers).toMatchObject({ Authorization: 'Bearer test-session' });
    expect(blob).toBeInstanceOf(Blob);
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([0, 1, 255]);
    await expect(downloadAgentRunArtifact('9007199254740993', '0019007199254740995')).rejects.toMatchObject({ status: 403 });
    await expect(downloadAgentRunArtifact('9007199254740993', '0019007199254740995')).rejects.toThrow('附件响应格式异常');
  });

  it('GET agent-capabilities under the project path and unwraps the envelope', async () => {
    const data = {
      packs: [
        {
          code: 'ipd.market',
          version: '1.0.0',
          name: '市场分析包',
          description: '',
          stages: ['CONCEPT'],
          actionCodes: ['A-01'],
          available: false,
          unavailableReason: '管理员未启用该能力包',
          skills: [],
          tools: [],
        },
      ],
      models: [{ id: '9007199254740993', name: 'm', available: true, reason: null }],
    };
    const fetcher = vi.fn().mockResolvedValue(envelope(data));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchProjectAgentCapabilities('1834567890123456789');
    const [url, init] = call(fetcher);
    expect(url).toBe('/api/v1/projects/1834567890123456789/agent-capabilities');
    expect(init.method ?? 'GET').toBe('GET');
    expect(result.packs[0]!.unavailableReason).toBe('管理员未启用该能力包');
    // 超过 Number 安全范围的 ID 必须原样保留为字符串
    expect(result.models[0]!.id).toBe('9007199254740993');
  });

  it('POST agent-runs with the body verbatim, including the caller idempotency key', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ runId: 'run-1', status: 'PENDING' }));
    vi.stubGlobal('fetch', fetcher);
    const input = {
      capabilityPackCode: 'ipd.market',
      capabilityPackVersion: '1.0.0',
      modelConfigId: '0012',
      skillNames: ['swot'],
      toolIds: ['007'],
      actionCode: 'A-01',
      message: '生成竞品分析',
      idempotencyKey: '5f0c7a4e-1c1b-4b8e-9d2e-3c1f6a0b9e11',
    };
    const receipt = await createProjectAgentRun('p-1', input);
    const [url, init] = call(fetcher);
    expect(url).toBe('/api/v1/projects/p-1/agent-runs');
    expect(init.method).toBe('POST');
    // 前导零的字符串 ID 不得被转成数值
    expect(bodyOf(init)).toEqual(input);
    expect(receipt).toEqual({ runId: 'run-1', status: 'PENDING' });
  });

  it('GET project agent-runs keeps query params and does not coerce the project id', async () => {
    const row = {
      runId: '9007199254740993',
      status: 'SUCCEEDED',
      actionCode: 'C02',
      capabilityPackCode: 'ipd.market',
      capabilityPackVersion: '1.0.0',
      createdAt: '2026-09-30T00:00:00Z',
      finishedAt: null,
      inputChars: 12,
      artifactTitles: ['竞品报告'],
      artifactExcerpt: '摘录',
    };
    const fetcher = vi.fn().mockResolvedValue(envelope([row]));
    vi.stubGlobal('fetch', fetcher);
    const result = await listProjectAgentRuns('9007199254740993', {
      q: 'C02',
      status: 'SUCCEEDED',
      actionCode: 'C02',
      cursor: '9007199254740991',
      limit: 20,
    });
    expect(call(fetcher)[0]).toBe(
      '/api/v1/projects/9007199254740993/agent-runs?q=C02&status=SUCCEEDED&actionCode=C02&cursor=9007199254740991&limit=20',
    );
    expect(result[0]!.runId).toBe('9007199254740993');
    expect(typeof result[0]!.runId).toBe('string');
    expect(result[0]).not.toHaveProperty('inputDigest');
  });

  it('GET agent-runs/{runId} returns detail with string IDs untouched', async () => {
    const detail = {
      runId: 'run-1',
      projectId: '0001',
      agentId: 'ag-1',
      status: 'SUCCEEDED',
      actionCode: null,
      configSnapshot: {
        capabilityPackCode: 'ipd.market',
        capabilityPackVersion: '1.0.0',
        modelConfigId: '12',
        skills: [{ name: 'swot', sha256: 'abc' }],
        toolIds: ['t1'],
      },
      errorCode: null,
      createdAt: '2026-09-29T00:00:00Z',
      finishedAt: '2026-09-29T00:01:00Z',
    };
    const fetcher = vi.fn().mockResolvedValue(envelope(detail));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchAgentRun('run-1');
    expect(call(fetcher)[0]).toBe('/api/v1/agent-runs/run-1');
    expect(result.projectId).toBe('0001');
  });

  it('GET events passes afterSeq as a query parameter (including 0)', async () => {
    // Response 体只能读一次，每次调用返回新实例
    const fetcher = vi.fn().mockImplementation(async () => envelope({ events: [], nextSeq: 0, terminal: false }));
    vi.stubGlobal('fetch', fetcher);
    await fetchAgentRunEvents('run-1', 0);
    await fetchAgentRunEvents('run-1', 17);
    expect(call(fetcher, 0)[0]).toBe('/api/v1/agent-runs/run-1/events?afterSeq=0');
    expect(call(fetcher, 1)[0]).toBe('/api/v1/agent-runs/run-1/events?afterSeq=17');
  });

  it('POST cancel without a body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ runId: 'run-1', status: 'CANCEL_REQUESTED' }));
    vi.stubGlobal('fetch', fetcher);
    const receipt = await cancelAgentRun('run-1');
    const [url, init] = call(fetcher);
    expect(url).toBe('/api/v1/agent-runs/run-1/cancel');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(receipt.status).toBe('CANCEL_REQUESTED');
  });

  it('POST apply under agent-runs/{runId}/artifacts/{artifactId}/apply with string IDs', async () => {
    const view = {
      runId: 'run-1', artifactId: '9007199254740993', versionId: '2096266884247736321',
      versionNo: 1, documentId: '3096266884247736321', documentStatus: 'GENERATED', indexStatus: 'NOT_INDEXED',
    };
    const fetcher = vi.fn().mockResolvedValue(envelope(view));
    vi.stubGlobal('fetch', fetcher);
    const result = await applyAgentRunArtifact('run-1', '9007199254740993');
    const [url, init] = call(fetcher);
    expect(url).toBe('/api/v1/agent-runs/run-1/artifacts/9007199254740993/apply');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(result.artifactId).toBe('9007199254740993');
    expect(result.documentId).toBe('3096266884247736321');
    expect(result.indexStatus).toBe('NOT_INDEXED');
  });

  it('PUT ai-feedback with targetType/targetId in the path', async () => {
    const view = {
      targetType: 'RUN_MESSAGE',
      targetId: 'run-1',
      rating: 'DOWN',
      reason: '引用错误',
      updatedAt: 'x',
    };
    const fetcher = vi.fn().mockResolvedValue(envelope(view));
    vi.stubGlobal('fetch', fetcher);
    const result = await saveAiFeedback('RUN_MESSAGE', 'run-1', { rating: 'DOWN', reason: '引用错误' });
    const [url, init] = call(fetcher);
    expect(url).toBe('/api/v1/ai-feedback/RUN_MESSAGE/run-1');
    expect(init.method).toBe('PUT');
    expect(bodyOf(init)).toEqual({ rating: 'DOWN', reason: '引用错误' });
    expect(result).toEqual(view);
  });

  it('URL-encodes path segments instead of trusting raw IDs', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ events: [], nextSeq: 0, terminal: true }));
    vi.stubGlobal('fetch', fetcher);
    await fetchAgentRunEvents('a/b?c', 0);
    expect(call(fetcher)[0]).toBe('/api/v1/agent-runs/a%2Fb%3Fc/events?afterSeq=0');
  });

  it('rejects with IpdRequestError carrying the backend message on a non-zero envelope', async () => {
    const fetcher = vi.fn().mockResolvedValue(failure(403, 30001, '项目智能体功能未开启'));
    vi.stubGlobal('fetch', fetcher);
    const error = await fetchProjectAgentCapabilities('p-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpdRequestError);
    expect((error as IpdRequestError).code).toBe(30001);
    expect((error as IpdRequestError).envelopeMessage).toBe('项目智能体功能未开启');
  });
});

describe('agent run status helpers', () => {
  const all: AgentRunStatus[] = [
    'PENDING',
    'RUNNING',
    'WAITING_APPROVAL',
    'CANCEL_REQUESTED',
    'VERIFYING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ];

  it('marks exactly SUCCEEDED/FAILED/CANCELLED as terminal', () => {
    expect(all.filter((s) => isAgentRunTerminal(s))).toEqual(['SUCCEEDED', 'FAILED', 'CANCELLED']);
  });

  it('only allows cancelling non-terminal runs that are not already cancelling', () => {
    expect(all.filter((s) => isAgentRunCancellable(s))).toEqual([
      'PENDING',
      'RUNNING',
      'WAITING_APPROVAL',
      'VERIFYING',
    ]);
  });

  it('gives every status a Chinese label', () => {
    for (const status of all) {
      expect(agentRunStatusMeta(status).label).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('throws on an unknown status that bypassed the type system', () => {
    expect(() => isAgentRunTerminal('BOGUS' as AgentRunStatus)).toThrow('未处理的枚举值');
  });
});


describe('official interrupt resume contract', () => {
  it('posts original pause seq and AG-UI resumes to the original string run id', async () => {
    const runId = '9007199254740993';
    const input = { expectedPauseSeq: 7, aguiInput: { threadId: runId, runId, messages: [], tools: [], context: [], state: {}, forwardedProps: {}, resume: [{ interruptId: 'approval-1', status: 'resolved' as const, payload: { approved: false } }] } };
    const fetcher = vi.fn().mockResolvedValue(envelope({ runId, status: 'RUNNING' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await resumeAgentRun(runId, input)).toEqual({ runId, status: 'RUNNING' });
    const [url, init] = call(fetcher);
    expect(url).toBe(`/api/v1/agent-runs/${runId}/resume`);
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
