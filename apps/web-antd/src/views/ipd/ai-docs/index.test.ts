/**
 * 页42 AI 文档助手（BR-AI-04 风险提示落位 + P4-2.3 状态机/diff 串联）：
 * - BR-AI-04：版本链中 GENERATED 状态行必须渲染「AI 生成、未经审核」角标 +
 *   「确认无误请走审核流」提示；REVIEWED/ARCHIVED/REJECTED 状态行不得渲染。
 * - 状态机：review 仅 GENERATED、archive 仅 REVIEWED、reject 仅 GENERATED。
 * - diff 按钮：仅 chain.length >= 2 时渲染，点击拉起字段级 diff Drawer。
 * - reject Modal：comment 必填 + 提交时按钮 disabled 时不发请求。
 * 后端不审（docs/前端拉入派单登记-20260907.md §3.4），这是前端 UI 校验义务。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import AiDocs from './index.vue';

const envelope = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

// 真机契约：GET /projects 行是 {project:{...}} 包裹（api/ipd/project.ts normalizeProject 解包）；
// 勿改回扁平行——扁平 fixture 会掩盖页面绕过归一化直读 record.id 的缺陷。
const projectsFixture = [
  {
    lastActivityAt: 1789147147000,
    project: { id: '100', code: 'IPD-DEMO', name: '演示项目' },
  },
];

const docFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  content: '正文',
  contentSha256: 'a'.repeat(64),
  createTime: '2026-09-05 10:00:00',
  docType: 'PRD',
  id: '1',
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

let router: Router;

beforeEach(async () => {
  setActivePinia(createPinia());
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  await router.isReady();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountWithChain(chainData: unknown[], extraFetch?: (callIndex: number, target: string) => unknown) {
  // 第一次 fetch：项目列表（GET /projects）；第二次：版本链（GET /ai-documents/:id/versions）
  // 之后可附加任意端点响应
  const fetcher = vi.fn();
  fetcher.mockResolvedValueOnce(envelope(projectsFixture));
  fetcher.mockResolvedValueOnce(envelope(chainData));
  if (extraFetch) {
    fetcher.mockImplementation(async (target: RequestInfo | URL) => {
      const callIndex = fetcher.mock.calls.length - 1;
      const url = typeof target === 'string' ? target : target.toString();
      const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
      return envelope(extraFetch(callIndex, path));
    });
  }
  vi.stubGlobal('fetch', fetcher);
  const wrapper = mount(AiDocs, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  // 等项目列表加载 + 默认 onMounted 跑完
  await flushPromises();
  // 触发 loadChain：模拟用户点击「加载版本链」
  const inputs = wrapper.findAll('input');
  // 找到 placeholder 含「输入文档 ID」的输入框（版本链 Input）
  const docIdInput = inputs.find((node) => (node.attributes('placeholder') ?? '').includes('文档 ID'));
  expect(docIdInput, '版本链 ID 输入框应存在').toBeTruthy();
  await docIdInput!.setValue('1');
  // 找到「加载版本链」按钮
  const loadButton = wrapper.findAll('button').find((node) => node.text().includes('加载版本链'));
  expect(loadButton, '加载版本链按钮应存在').toBeTruthy();
  await loadButton!.trigger('click');
  await flushPromises();
  return { fetcher, wrapper };
}

describe('BR-AI-04：AI 输出展示位置风险提示落位', () => {
  it('GENERATED 状态行渲染「AI 生成、未经审核」角标 + 「确认无误请走审核流」提示', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'GENERATED' }),
    ]);
    const html = wrapper.html();
    expect(html, 'GENERATED 行必须出现「AI 生成、未经审核」角标').toContain('AI 生成、未经审核');
    expect(html, 'GENERATED 行必须出现「确认无误请走审核流」提示').toContain('确认无误请走审核流');
    // 警告 Alert 的 message slot 是 prompt 文案
    expect(html, '风险提示必须标为 warning').toContain('ant-alert-warning');
    wrapper.unmount();
  });

  it('REVIEWED 状态行不渲染 BR-AI-04 角标 / 提示', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'REVIEWED', reviewedAt: '2026-09-05 12:00:00', reviewedBy: '42' }),
    ]);
    const html = wrapper.html();
    expect(html, 'REVIEWED 行不得出现「AI 生成、未经审核」角标').not.toContain('AI 生成、未经审核');
    expect(html, 'REVIEWED 行不得出现「确认无误请走审核流」提示').not.toContain('确认无误请走审核流');
    // 审核通过按钮也不再渲染
    expect(wrapper.findAll('button').filter((b) => b.text().includes('审核通过')).length).toBe(0);
    wrapper.unmount();
  });

  it('多版本链混合时，仅 GENERATED 行渲染风险提示，REVIEWED 行不渲染', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'REVIEWED', reviewedAt: '2026-09-05 11:00:00', reviewedBy: '42' }),
      docFixture({ id: '2', versionNo: 2, status: 'GENERATED', parentVersionId: '1' }),
    ]);
    const html = wrapper.html();
    // 提示存在（v2 渲染）
    expect(html).toContain('AI 生成、未经审核');
    expect(html).toContain('确认无误请走审核流');
    // v1 REVIEWED 不应有审核通过按钮
    const items = wrapper.findAll('li');
    expect(items.length).toBe(2);
    const reviewedItemHtml = items[0]!.html();
    const generatedItemHtml = items[1]!.html();
    expect(reviewedItemHtml, 'v1 REVIEWED 行不得包含 BR-AI-04 提示').not.toContain('AI 生成、未经审核');
    expect(generatedItemHtml, 'v2 GENERATED 行必须包含 BR-AI-04 提示').toContain('AI 生成、未经审核');
    expect(generatedItemHtml, 'v2 GENERATED 行必须包含「确认无误请走审核流」').toContain('确认无误请走审核流');
    // 仅 v2 渲染审核通过按钮
    const reviewButtons = wrapper.findAll('button').filter((b) => b.text().includes('审核通过'));
    expect(reviewButtons.length).toBe(1);
    wrapper.unmount();
  });

  it('ARCHIVED 状态行不渲染 BR-AI-04 提示', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'ARCHIVED' }),
    ]);
    const html = wrapper.html();
    expect(html).not.toContain('AI 生成、未经审核');
    expect(html).not.toContain('确认无误请走审核流');
    wrapper.unmount();
  });
});

describe('P4-2.3 状态机：review/archive/reject 仅在合法状态渲染', () => {
  it('GENERATED 行同时渲染「审核通过」+「审核拒绝」两个按钮；REVIEWED 行只渲染「归档」', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'GENERATED' }),
      docFixture({ id: '2', versionNo: 2, status: 'REVIEWED', reviewedAt: '2026-09-05 12:00:00', reviewedBy: '42', parentVersionId: '1' }),
    ]);
    const items = wrapper.findAll('li');
    expect(items.length).toBe(2);
    const generatedHtml = items[0]!.html();
    const reviewedHtml = items[1]!.html();
    // GENERATED 行：审核通过 + 审核拒绝 都渲染
    expect(generatedHtml).toContain('审核通过');
    expect(generatedHtml).toContain('审核拒绝');
    // 归档按钮不该在 GENERATED 行渲染（状态机校验）
    expect(generatedHtml).not.toContain('归档');
    // REVIEWED 行：仅归档
    expect(reviewedHtml).toContain('归档');
    expect(reviewedHtml).not.toContain('审核通过');
    expect(reviewedHtml).not.toContain('审核拒绝');
    wrapper.unmount();
  });

  it('REJECTED 行无任何操作按钮，渲染只读说明', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'REJECTED' }),
    ]);
    // 仅检查版本链 <li> 内的按钮（顶部 Alert 文案含「审核拒绝/归档」会污染全页匹配）
    const item = wrapper.findAll('li')[0]!;
    const buttons = item.findAll('button').map((b) => b.text().trim());
    expect(buttons, 'REJECTED 行不渲染审核通过按钮').not.toContain('审核通过');
    expect(buttons, 'REJECTED 行不渲染审核拒绝按钮').not.toContain('审核拒绝');
    expect(buttons, 'REJECTED 行不渲染归档按钮').not.toContain('归档');
    // 拒绝后就不可再走 review/archive 的只读说明
    expect(item.text()).toContain('不可再走 review/archive');
    wrapper.unmount();
  });

  it('ARCHIVED 行无任何操作按钮', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'ARCHIVED' }),
    ]);
    // 仅检查版本链 <li> 内的按钮（顶部 Alert 文案含「审核拒绝/归档」会污染全页匹配）
    const item = wrapper.findAll('li')[0]!;
    const buttons = item.findAll('button').map((b) => b.text().trim());
    expect(buttons, 'ARCHIVED 行不渲染审核通过按钮').not.toContain('审核通过');
    expect(buttons, 'ARCHIVED 行不渲染审核拒绝按钮').not.toContain('审核拒绝');
    expect(buttons, 'ARCHIVED 行不渲染归档按钮').not.toContain('归档');
    wrapper.unmount();
  });
});

describe('P4-2.3 reject Modal：comment 必填 + 双层校验', () => {
  it('点击「审核拒绝」打开 Modal，「确认拒绝」按钮在 comment 为空时 disabled', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'GENERATED' }),
    ]);
    const rejectButton = wrapper.findAll('button').find((b) => b.text().includes('审核拒绝'));
    expect(rejectButton, 'GENERATED 行必须渲染「审核拒绝」按钮').toBeTruthy();
    await rejectButton!.trigger('click');
    await flushPromises();
    const modal = document.body.querySelector('.ant-modal');
    expect(modal, 'reject Modal 必须渲染').toBeTruthy();
    // OK 按钮初始 disabled（comment 空）
    const okButton = [...document.body.querySelectorAll('.ant-modal .ant-btn-primary')].find(
      (b) => (b.textContent ?? '').includes('确认拒绝'),
    );
    expect(okButton, '确认拒绝按钮必须渲染').toBeTruthy();
    // AntDV Modal 的 disabled 通过原生 disabled 属性表达（不用 ant-btn-disabled class）
    expect(okButton!.hasAttribute('disabled'), 'comment 空时按钮必须 disabled').toBe(true);
    // 提示文字
    expect(modal!.textContent).toContain('拒绝原因');
    wrapper.unmount();
  });

  it('输入有效 comment 后点击确认，POST reject 端点带正确路径与请求体', async () => {
    const { fetcher, wrapper } = await mountWithChain(
      [docFixture({ id: '1', versionNo: 1, status: 'GENERATED' })],
      (callIndex, _target) => {
        // callIndex 0/1 = projects/versions；>= 2 = reject 调用
        if (callIndex >= 2) {
          return { status: 'REJECTED', id: '1' };
        }
        return null;
      },
    );
    const rejectButton = wrapper.findAll('button').find((b) => b.text().includes('审核拒绝'));
    await rejectButton!.trigger('click');
    await flushPromises();
    const modal = document.body.querySelector('.ant-modal')!;
    const textarea = modal.querySelector('textarea.ant-input') as HTMLTextAreaElement;
    expect(textarea, 'reject Modal 必须有 TextArea').toBeTruthy();
    // AntDV TextArea：模拟 v-model input 事件
    textarea.value = '内容与产品定位不符，需大改';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    // 找到确认按钮
    const okButton = [...modal.querySelectorAll('.ant-btn-primary')].find((b) =>
      (b.textContent ?? '').includes('确认拒绝'),
    )!;
    expect(okButton, '确认拒绝按钮必须存在').toBeTruthy();
    // comment 填好后按钮应 enable
    expect(!okButton.hasAttribute('disabled'), 'comment 填好后按钮必须 enable').toBe(true);
    (okButton as HTMLButtonElement).click();
    await flushPromises();
    await vi.waitFor(() => {
      const rejectCall = fetcher.mock.calls.find(([target]) =>
        String(target).includes('/api/v1/ai-documents/1/versions/1/reject'),
      );
      expect(rejectCall, 'reject 端点必须被调用').toBeTruthy();
      expect(JSON.parse(String(rejectCall![1]?.body))).toEqual({ comment: '内容与产品定位不符，需大改' });
    });
    wrapper.unmount();
  });
});

describe('P4-2.3 diff 视图：字段级 diff 按钮 + Drawer 渲染', () => {
  it('chain 长度 < 2 时不渲染「与上一版对比」按钮', async () => {
    const { wrapper } = await mountWithChain([
      docFixture({ id: '1', versionNo: 1, status: 'GENERATED' }),
    ]);
    const buttons = wrapper.findAll('button').map((b) => b.text());
    expect(buttons.some((text) => text.includes('与上一版对比'))).toBe(false);
    wrapper.unmount();
  });

  it('chain 长度 >= 2 时渲染「与上一版对比」按钮，点击后拉起 diff Drawer', async () => {
    const { wrapper } = await mountWithChain(
      [
        docFixture({ id: '1', versionNo: 1, status: 'REVIEWED', reviewedAt: '2026-09-05 11:00:00', reviewedBy: '42' }),
        docFixture({ id: '2', versionNo: 2, status: 'GENERATED', parentVersionId: '1', contentSha256: 'b'.repeat(64), title: 'PRD v2', content: '新版正文' }),
      ],
      (callIndex, _target) => {
        // callIndex 0/1 = projects/versions；>= 2 = diff 调用
        if (callIndex >= 2) {
          return {
            fields: [
              { field: 'title', from: 'PRD 初稿', to: 'PRD v2', changeType: 'modified' },
              { field: 'content', from: '正文', to: '新版正文', changeType: 'modified' },
              { field: 'docType', from: null, to: 'PRD', changeType: 'added' },
            ],
            fromVersionId: '1',
            toVersionId: '2',
          };
        }
        return null;
      },
    );
    const diffButton = wrapper.findAll('button').find((b) => b.text().includes('与上一版对比'));
    expect(diffButton, 'diff 按钮必须渲染').toBeTruthy();
    await diffButton!.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      const drawer = document.body.querySelector('.ant-drawer');
      expect(drawer, 'diff Drawer 必须渲染').toBeTruthy();
      const drawerText = drawer?.textContent ?? '';
      expect(drawerText).toContain('title');
      expect(drawerText).toContain('content');
      expect(drawerText).toContain('docType');
      expect(drawerText).toContain('v1');
      expect(drawerText).toContain('v2');
    });
    wrapper.unmount();
  });
});

/**
 * 回归 2026-09-10：AI 文档助手项目列表加载失败（/projects 包络解析错位）。
 * 旧实现自造 parseProjects 读顶层 record.id，遇到真机 ProjectListItemView
 * 包络 {project:{...}, lastActivityAt} 解析必错 → 页面恒显「项目列表加载失败」。
 * 修复后走 api/ipd/project.ts#listProjectItems（normalizeProject 已处理包络
 * 解包，单一事实源）。本组测试锁定 fixture 形态与解析路径，防止再度漂移。
 * 反思报告：docs/反思-ai-docs-bug-20260911.md
 */
describe('项目列表加载（回归 2026-09-10：/projects 返回 ProjectListItemView 包络）', () => {
  it('包络形状 {project:{id,code,name}, lastActivityAt} 正常解析，不出现「项目列表加载失败」', async () => {
    const fetcher = vi.fn();
    fetcher.mockResolvedValueOnce(envelope(projectsFixture));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(AiDocs, {
      global: { plugins: [router] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.html(), '包络结构必须解析成功，不得出现加载失败提示').not.toContain('项目列表加载失败');
    wrapper.unmount();
  });

  it('fixture 形态锁定为包络结构：防止后续开发者「清理」成裸平铺', () => {
    // 真机 GET /projects 返回 ProjectListItemView 包络
    // {project:{...}, lastActivityAt, scenarioDaysRemaining, critical}——
    // fixture 必须复现此形态，单测才能拦住「页面绕过归一化直读 record.id」的回归。
    expect(Array.isArray(projectsFixture), 'fixture 应是数组').toBe(true);
    expect(projectsFixture.length, 'fixture 至少 1 项').toBeGreaterThan(0);
    const first = projectsFixture[0] as Record<string, unknown>;
    expect(first, 'fixture 行必须有 project 子对象（包络形态）').toHaveProperty('project');
    expect(first, 'fixture 行必须有 lastActivityAt 字段').toHaveProperty('lastActivityAt');
    const project = first.project as Record<string, unknown>;
    expect(project, 'project 子对象必须有 id/code/name 三个字段').toMatchObject({
      code: expect.any(String),
      id: expect.any(String),
      name: expect.any(String),
    });
  });
});
