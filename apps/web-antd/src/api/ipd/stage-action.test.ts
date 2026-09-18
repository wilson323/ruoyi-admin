/**
 * StageAction API 契约测试 + ossId 链路（A-3/A-4 修复验证）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addStageActionDeliverable } from './stage-action';

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => vi.unstubAllGlobals());

describe('stage-action deliverable ossId contract', () => {
  it('POST /stage-actions/{id}/deliverables with fileName+ossId', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'd-1' }));
    vi.stubGlobal('fetch', fetcher);
    await addStageActionDeliverable('sa-1', 'doc.pdf', '9001');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/stage-actions/sa-1/deliverables');
    expect(url.searchParams.get('fileName')).toBe('doc.pdf');
    // ossId 透传 string（后端 Long 反序列化）；不再 optional
    expect(url.searchParams.get('ossId')).toBe('9001');
  });
});

describe('listStageActions business-code adapter (STG-501-A)', () => {
  /**
   * 真实端到端：业务编号 → listProjects 翻译 → 后端期望雪花 id。
   * 走 fetch stub 拦截，不依赖真实后端。
   */
  it('数字字符串直传,不调 listProjects', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: 'ok', data: [], timestamp: '', traceId: '' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetcher);
    const { listStageActions } = await import('./stage-action');
    await listStageActions('2096235170527993857');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/stage-actions');
    expect(url.searchParams.get('projectId')).toBe('2096235170527993857');
  });

  it('业务编号先调 listProjects 翻译,再发请求', async () => {
    // 顺序: 先 listProjects(PRJ-2026-001) → 返回带 id 的列表 → 然后 GET /stage-actions?projectId=id
    const listProjectsResp = new Response(
      JSON.stringify({
        code: 0, message: 'ok', timestamp: '', traceId: '',
        data: [{ project: { id: '2096235170527993857', code: 'PRJ-2026-001', name: '测试' }, lastActivityAt: null, scenarioDaysRemaining: null, critical: null }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const stageActionsResp = new Response(
      JSON.stringify({ code: 0, message: 'ok', data: [], timestamp: '', traceId: '' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetcher = vi.fn().mockResolvedValueOnce(listProjectsResp).mockResolvedValueOnce(stageActionsResp);
    vi.stubGlobal('fetch', fetcher);
    // 强制清缓存(防止前一个 case 缓存了同样的 code)
    const { codeToId } = await import('./project');
    codeToId.length; // 触发模块加载
    // 用一个全新的业务编号避免缓存干扰
    const { listStageActions } = await import('./stage-action');
    await listStageActions('PRJ-TEST-001');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(firstUrl.pathname).toBe('/api/v1/projects');
    expect(firstUrl.searchParams.get('keyword')).toBe('PRJ-TEST-001');
    const secondUrl = new URL(fetcher.mock.calls[1]![0] as string, 'http://ipd.local');
    expect(secondUrl.pathname).toBe('/api/v1/stage-actions');
    expect(secondUrl.searchParams.get('projectId')).toBe('2096235170527993857');
  });

  it('codeToId 二次调用命中缓存,只发一次 listProjects', async () => {
    const listProjectsResp = new Response(
      JSON.stringify({
        code: 0, message: 'ok', timestamp: '', traceId: '',
        data: [{ project: { id: '111', code: 'PRJ-CACHED', name: '' }, lastActivityAt: null, scenarioDaysRemaining: null, critical: null }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetcher = vi.fn().mockResolvedValue(listProjectsResp);
    vi.stubGlobal('fetch', fetcher);
    const { codeToId } = await import('./project');
    const id1 = await codeToId('PRJ-CACHED');
    const id2 = await codeToId('PRJ-CACHED');
    expect(id1).toBe('111');
    expect(id2).toBe('111');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('getProject(业务编号) 自适配:走 codeToId 后再发 GET /projects/{id}', async () => {
    const listProjectsResp = new Response(
      JSON.stringify({
        code: 0, message: 'ok', timestamp: '', traceId: '',
        data: [{ project: { id: '222', code: 'PRJ-GET', name: 'x' }, lastActivityAt: null, scenarioDaysRemaining: null, critical: null }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const projectResp = new Response(
      JSON.stringify({ code: 0, message: 'ok', timestamp: '', traceId: '', data: { id: '222', code: 'PRJ-GET', name: 'x' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetcher = vi.fn().mockResolvedValueOnce(listProjectsResp).mockResolvedValueOnce(projectResp);
    vi.stubGlobal('fetch', fetcher);
    const { getProject } = await import('./project');
    const p = await getProject('PRJ-GET');
    expect(p.id).toBe('222');
    expect(p.code).toBe('PRJ-GET');
    const secondUrl = new URL(fetcher.mock.calls[1]![0] as string, 'http://ipd.local');
    expect(secondUrl.pathname).toBe('/api/v1/projects/222');
  });

  it('getProject(纯数字) 直传,不调 listProjects', async () => {
    const projectResp = new Response(
      JSON.stringify({ code: 0, message: 'ok', timestamp: '', traceId: '', data: { id: '333', code: null, name: 'y' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetcher = vi.fn().mockResolvedValue(projectResp);
    vi.stubGlobal('fetch', fetcher);
    const { getProject } = await import('./project');
    const p = await getProject('333');
    expect(p.id).toBe('333');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/projects/333');
  });
});

