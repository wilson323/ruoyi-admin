/**
 * 协作圈 API 契约测试：视图/候选 GET + 加人/发动态/评论 POST 的路径与载荷。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCircleMember,
  createCircleComment,
  createCirclePost,
  listCircleCandidates,
  viewCircle,
} from './project-circle';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('project-circle API contract', () => {
  it('GET /project-circle/{id} 返回视图', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({ canManage: true, members: [], posts: [], project: {}, readOnly: false }),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = await viewCircle('100');
    expect(new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local').pathname).toBe(
      '/api/v1/project-circle/100',
    );
    expect(view.canManage).toBe(true);
  });

  it('GET /project-circle/{id}/candidates 解包 candidates', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(envelope({ candidates: [{ id: '9', name: '张三', personType: 'RD_PM' }] }));
    vi.stubGlobal('fetch', fetcher);
    const list = await listCircleCandidates('100');
    expect(new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local').pathname).toBe(
      '/api/v1/project-circle/100/candidates',
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('9');
  });

  it('POST /project-circle/{id}/members 携带 userId 与圈角色', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ circleRole: 'CONTRIBUTOR' }));
    vi.stubGlobal('fetch', fetcher);
    await addCircleMember('100', '9', 'CONTRIBUTOR');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/project-circle/100/members');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ circleRole: 'CONTRIBUTOR', userId: '9' });
  });

  it('POST /project-circle/{id}/posts 发动态', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '7' }));
    vi.stubGlobal('fetch', fetcher);
    const res = await createCirclePost('100', '本周完成概念阶段评审');
    expect(url0(fetcher)).toBe('/api/v1/project-circle/100/posts');
    expect(JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body))).toEqual({
      content: '本周完成概念阶段评审',
      objectId: null,
      objectType: null,
    });
    expect(res.id).toBe('7');
  });

  it('POST /project-circle/posts/{id}/comments 楼中楼携带 parentId', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '8' }));
    vi.stubGlobal('fetch', fetcher);
    await createCircleComment('7', '收到', '3');
    expect(url0(fetcher)).toBe('/api/v1/project-circle/posts/7/comments');
    expect(JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body))).toEqual({
      content: '收到',
      parentId: '3',
    });
  });
});

function url0(fetcher: ReturnType<typeof vi.fn>): string {
  return fetcher.mock.calls[0]![0] as string;
}
