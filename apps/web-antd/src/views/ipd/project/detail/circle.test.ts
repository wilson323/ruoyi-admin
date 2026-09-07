// 协作圈 Tab 组件渲染契约（看板卡 c5254e23）：
// 1. 视图数据全渲染：成员圈角色 / 动态作者与内容 / 评论
// 2. 空态：无成员无动态文案
// 3. 错误态：后端 500 透出错误文案 + 重试
// 4. 只读态（ARCHIVED）：readOnly 横幅 + 写入口隐藏
// 5. 管理人：canManage 时展示「添加协作人」入口

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CirclePanel from './circle.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { projectId: '100' } }),
}));

const envelope = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      code: 0,
      data,
      message: 'success',
      timestamp: '2026-09-06T00:00:00Z',
      traceId: 'fixture',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const viewFixture = (over: Record<string, unknown> = {}) => ({
  canManage: true,
  members: [
    {
      addedAt: '2026-09-01 10:00:00',
      circleRole: 'FOLLOWER',
      level: null,
      name: '张三',
      personType: 'RD_PM',
      userId: '9',
    },
  ],
  posts: [
    {
      authorId: '8',
      authorName: '李四',
      commentCount: 1,
      comments: [
        {
          authorId: '9',
          authorName: '张三',
          content: '收到',
          createdAt: '2026-09-02 09:00:00',
          id: '3',
          parentId: null,
        },
      ],
      content: '概念阶段评审通过',
      createdAt: '2026-09-02 08:00:00',
      id: '7',
      objectId: null,
      objectType: null,
    },
  ],
  project: { code: 'P001', name: '智能水杯' },
  readOnly: false,
  ...over,
});

async function mountPanel(viewData: unknown, expectText: string) {
  const fetcher = vi.fn().mockResolvedValue(envelope(viewData));
  vi.stubGlobal('fetch', fetcher);
  const wrapper = mount(CirclePanel, {
    global: { plugins: [createPinia()] },
  });
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain(expectText);
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('circle panel render contract', () => {
  it('渲染成员、动态与评论', async () => {
    const wrapper = await mountPanel(viewFixture(), '张三');
    const text = wrapper.text();
    expect(text).toContain('李四');
    expect(text).toContain('概念阶段评审通过');
    expect(text).toContain('收到');
    expect(text).toContain('关注者');
  });

  it('空态文案', async () => {
    const wrapper = await mountPanel(viewFixture({ members: [], posts: [] }), '暂无协作成员');
    expect(wrapper.text()).toContain('暂无协作成员');
    expect(wrapper.text()).toContain('暂无动态');
  });

  it('后端 500 透出错误并给重试', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 90001, message: '服务器内部错误' }), { status: 500 }),
    );
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(CirclePanel, { global: { plugins: [createPinia()] } });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('重试');
    });
  });

  it('只读项目隐藏写入口并展示横幅', async () => {
    const wrapper = await mountPanel(viewFixture({ readOnly: true }), '只读模式');
    expect(wrapper.text()).toContain('只读模式');
    expect(wrapper.text()).not.toContain('发布动态');
    expect(wrapper.text()).not.toContain('添加协作人');
  });

  it('canManage=false 隐藏添加协作人', async () => {
    const wrapper = await mountPanel(viewFixture({ canManage: false }), '李四');
    expect(wrapper.text()).not.toContain('添加协作人');
  });
});
