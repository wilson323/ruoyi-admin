import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  generateAiDocument,
  ipdApiErrorText,
  listAiDocumentVersions,
  parseAiDocument,
  registerAiDocument,
  reviewAiDocumentVersion,
  reviseAiDocument,
} from './ai-document';
import { IpdRequestError } from './auth';

const response = (data: unknown, status = 200, code = 0) =>
  new Response(JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const docFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  content: '正文内容',
  contentSha256: 'a'.repeat(64),
  createTime: '2026-09-05 10:00:00',
  docType: 'PRD',
  id: '9007199254740993',
  model: 'deepseek-chat',
  parentVersionId: null,
  projectId: '100',
  reviewedAt: null,
  reviewedBy: null,
  status: 'GENERATED',
  title: 'PRD 初稿',
  tokenCompletion: 50,
  tokenPrompt: 100,
  versionNo: 1,
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI 文档版本链接口', () => {
  it('登记 v1 走 POST /api/v1/ai-documents，选填空值不进入请求体，ID 保持字符串', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(docFixture()));
    vi.stubGlobal('fetch', fetcher);
    const result = await registerAiDocument({
      content: '正文内容',
      docType: null,
      model: null,
      projectId: '100',
      title: 'PRD 初稿',
      tokenCompletion: null,
      tokenPrompt: null,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      content: '正文内容',
      projectId: '100',
      title: 'PRD 初稿',
    });
    expect(result.id).toBe('9007199254740993');
    expect(result.versionNo).toBe(1);
  });

  it('人工改版携带 baseVersionId 基准，审核与版本链路径正确', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response(docFixture({ versionNo: 2, parentVersionId: '9007199254740993' }))),
      );
    vi.stubGlobal('fetch', fetcher);
    await reviseAiDocument('9007199254740993', { baseVersionId: '9007199254740993', content: '新版内容', title: null });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents/9007199254740993/revise');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      baseVersionId: '9007199254740993',
      content: '新版内容',
    });

    fetcher.mockImplementation(() => Promise.resolve(response(docFixture({ id: '2', versionNo: 2, status: 'REVIEWED' }))));
    await reviewAiDocumentVersion('1', '2');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/v1/ai-documents/1/versions/2/review');

    fetcher.mockImplementation(() => Promise.resolve(response([docFixture(), docFixture({ id: '2', versionNo: 2 })])));
    const chain = await listAiDocumentVersions('1');
    expect(fetcher.mock.calls[2]?.[0]).toBe('/api/v1/ai-documents/1/versions');
    expect(chain.map((doc) => doc.versionNo)).toEqual([1, 2]);
  });

  it('AI 生成走 POST /api/v1/ai-documents/generate，docType 空不进请求体，返回契约化 v1', async () => {
    // 每次调用新建 Response：body 流只能读一次，mockResolvedValue 复用同一 Response 会致第二次调用 transport 失败
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(docFixture())));
    vi.stubGlobal('fetch', fetcher);
    const result = await generateAiDocument({
      docType: 'PRD',
      projectId: '100',
      prompt: '原始资料：用户反馈整理',
      title: 'PRD 初稿',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents/generate');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      docType: 'PRD',
      projectId: '100',
      prompt: '原始资料：用户反馈整理',
      title: 'PRD 初稿',
    });
    expect(result.id).toBe('9007199254740993');
    expect(result.versionNo).toBe(1);
    expect(result.status).toBe('GENERATED');

    await generateAiDocument({ projectId: '100', prompt: '资料', title: '标题' });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({
      projectId: '100',
      prompt: '资料',
      title: '标题',
    });
  });

  it('parse 拒绝数字 ID、缺失字段与非对象数据，不做静默修补', () => {
    expect(() => parseAiDocument(docFixture({ id: 123 }))).toThrow(IpdRequestError);
    expect(() => parseAiDocument(docFixture({ status: undefined }))).toThrow(IpdRequestError);
    expect(() => parseAiDocument(null)).toThrow(IpdRequestError);
    expect(() => parseAiDocument([docFixture()])).toThrow(IpdRequestError);
  });

  it('错误码映射为中文文案，未知码回退 fallback（不再透传 error.message，避免暴露后端字符串）', () => {
    expect(ipdApiErrorText(new IpdRequestError('x', 409, 50002, 'http'))).toContain('状态冲突');
    expect(ipdApiErrorText(new IpdRequestError('x', 413, 40013, 'http'))).toContain('AI 预算超出限制');
    // 2026-09-06 重构：未知码不再回退到 error.message，统一走 options.fallback。
    // 与 bid/project 域策略一致；理由：避免向用户暴露后端原始字符串。
    expect(ipdApiErrorText(new IpdRequestError('自定义文案', 400, 99999, 'http'))).toBe('操作失败，请稍后重试');
    expect(ipdApiErrorText(new IpdRequestError('自定义文案', 400, 99999, 'http'), '页内 fallback')).toBe('页内 fallback');
    expect(ipdApiErrorText(new IpdRequestError('无法连接服务，请检查网络后重试', 0, 0, 'transport'))).toContain('无法连接服务');
  });

  it('未匹配路由（HTTP 200 + code=404 + message=null）映射为「接口不存在」文案，不暴露原 message', () => {
    expect(ipdApiErrorText(new IpdRequestError(null as unknown as string, 200, 404, 'http'))).toContain('接口不存在');
    expect(ipdApiErrorText(new IpdRequestError('success', 200, 404, 'http'))).toContain('接口不存在');
  });
});
