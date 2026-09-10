import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  archiveAiDocumentVersion,
  generateAiDocument,
  getAiDocumentDiff,
  getAiDocumentHistory,
  ipdApiErrorText,
  listAiDocumentVersions,
  parseAiDocument,
  registerAiDocument,
  rejectAiDocumentVersion,
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

const diffFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  fields: [
    { field: 'title', from: 'PRD 初稿', to: 'PRD v2', changeType: 'modified' },
    { field: 'content', from: '正文', to: '新版正文', changeType: 'modified' },
    { field: 'docType', from: null, to: 'PRD', changeType: 'added' },
  ],
  fromVersionId: '9007199254740993',
  toVersionId: '9007199254740994',
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

  it('未匹配路由（后端真契约：HTTP 404 + code=50001 资源不存在）映射为数据不存在文案，不暴露原 message；code=404 包络后端不存在（2026-09-09 锚定修正，404 死键已从共享表删除）', () => {
    expect(ipdApiErrorText(new IpdRequestError(null as unknown as string, 404, 50001, 'http'))).toContain('数据不存在');
    expect(ipdApiErrorText(new IpdRequestError('资源不存在', 404, 50001, 'http'))).not.toContain('资源不存在');
    // 未知码 404（若上游误传）落 fallback，不复活已删死键
    expect(ipdApiErrorText(new IpdRequestError('success', 200, 404, 'http'))).toBe('操作失败，请稍后重试');
  });

  // ---------- P4-2.3 四端点：A5 封装层 ----------

  it('archive 走 POST /ai-documents/{id}/versions/{vid}/archive，前端状态机校验由 UI 承担', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(response(docFixture({ status: 'ARCHIVED' }))),
    );
    vi.stubGlobal('fetch', fetcher);
    const archived = await archiveAiDocumentVersion('1', '9007199254740993');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents/1/versions/9007199254740993/archive');
    // archive 端点无请求体；requestIpd 对 undefined body 保持 undefined
    expect(fetcher.mock.calls[0]?.[1].body).toBeUndefined();
    expect(fetcher.mock.calls[0]?.[1].method).toBe('POST');
    expect(archived.status).toBe('ARCHIVED');
  });

  it('reject 携带 comment，路径与请求体正确，缺 comment 由调用方传空字符串时仍透传（前端校验先于请求）', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(response(docFixture({ status: 'REJECTED' }))),
    );
    vi.stubGlobal('fetch', fetcher);
    const rejected = await rejectAiDocumentVersion('1', '9007199254740993', { comment: '内容与产品定位不符' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents/1/versions/9007199254740993/reject');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ comment: '内容与产品定位不符' });
    expect(rejected.status).toBe('REJECTED');
  });

  it('history 走 GET /ai-documents/{id}/history（前端复用 /versions 列表同构，独立封装便于后端扩展）', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(response([
        docFixture({ versionNo: 2 }),
        docFixture({ id: '9007199254740993', versionNo: 1, parentVersionId: null }),
      ])),
    );
    vi.stubGlobal('fetch', fetcher);
    const history = await getAiDocumentHistory('1');
    // 当前实现 = listAiDocumentVersions（= GET /versions）；保留端点便于后端独立扩展
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents/1/versions');
    expect(history).toHaveLength(2);
  });

  it('diff 走 GET /ai-documents/{id}/diff?from=&to=，解析 fields + changeType 分类', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(diffFixture())));
    vi.stubGlobal('fetch', fetcher);
    const diff = await getAiDocumentDiff('1', '9007199254740993', '9007199254740994');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/ai-documents/1/diff?from=9007199254740993&to=9007199254740994');
    expect(diff.fromVersionId).toBe('9007199254740993');
    expect(diff.toVersionId).toBe('9007199254740994');
    expect(diff.fields).toHaveLength(3);
    const added = diff.fields.find((field) => field.changeType === 'added');
    expect(added?.field).toBe('docType');
    expect(added?.from).toBeNull();
    expect(added?.to).toBe('PRD');
  });

  it('diff 非纯数字版本 ID 直接拒，不发请求', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(getAiDocumentDiff('1', 'abc', '9007199254740994')).rejects.toThrow(IpdRequestError);
    await expect(getAiDocumentDiff('1', '9007199254740993', '')).rejects.toThrow(IpdRequestError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('diff 响应 fields 含非法 changeType 静默剔除，不抛错', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({
      fields: [
        { field: 'title', from: 'a', to: 'b', changeType: 'modified' },
        { field: 'bad', from: 'x', to: 'y', changeType: 'unknown' },
        { field: 'drop', from: 123, to: 'y', changeType: 'modified' },
        'not-an-object',
      ],
      fromVersionId: '1',
      toVersionId: '2',
    })));
    vi.stubGlobal('fetch', fetcher);
    const diff = await getAiDocumentDiff('1', '1', '2');
    expect(diff.fields).toHaveLength(1);
    expect(diff.fields[0]?.field).toBe('title');
  });
});
