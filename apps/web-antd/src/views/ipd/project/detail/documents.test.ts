import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { AiDocument } from '../../../../api/ipd/ai-document';
import {
  listAiDocumentVersions,
  listAiDocumentsByProject,
  registerAiDocument,
} from '../../../../api/ipd/ai-document';
import DocumentsTab from './documents.vue';

vi.mock('../../../../api/ipd/ai-document', () => ({
  ipdApiErrorText: (error: unknown) => error instanceof Error ? error.message : String(error),
  listAiDocumentVersions: vi.fn(),
  listAiDocumentsByProject: vi.fn(),
  registerAiDocument: vi.fn(),
  reviewAiDocumentVersion: vi.fn(),
  reviseAiDocument: vi.fn(),
}));

function documentFor(projectId: string, title: string): AiDocument {
  return {
    content: `${title}的正文`, contentSha256: null, createTime: null, docType: 'PRD',
    id: projectId === '101' ? '1001' : '2001', model: null, parentVersionId: null,
    projectId, reviewedAt: null, reviewedBy: null, status: 'GENERATED', title,
    tokenCompletion: null, tokenPrompt: null, versionNo: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function mountAt(projectId: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/ipd/projects/:projectId/documents', component: { template: '<div />' } }],
  });
  await router.push(`/ipd/projects/${projectId}/documents`);
  await router.isReady();
  const wrapper = mount(DocumentsTab, { attachTo: document.body, global: { plugins: [router] } });
  return { router, wrapper };
}

beforeEach(() => {
  vi.mocked(listAiDocumentsByProject).mockReset();
  vi.mocked(listAiDocumentVersions).mockReset();
  vi.mocked(registerAiDocument).mockReset();
  vi.mocked(listAiDocumentsByProject).mockResolvedValue([]);
  vi.mocked(listAiDocumentVersions).mockResolvedValue([]);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('项目文档页同实例切项目隔离', () => {
  it('切项目立即清理旧文档、版本链与登记草稿，并加载新项目', async () => {
    vi.mocked(listAiDocumentsByProject).mockImplementation(async (pid) =>
      [documentFor(String(pid), String(pid) === '101' ? '旧项目文档' : '新项目文档')]);
    vi.mocked(listAiDocumentVersions).mockResolvedValue([documentFor('101', '旧项目版本')]);
    const { router, wrapper } = await mountAt('101');
    await flushPromises();
    expect(wrapper.text()).toContain('旧项目文档');

    await wrapper.find('input[placeholder="输入文档 ID 查看版本链"]').setValue('1001');
    await wrapper.findAll('button').find((button) => button.text().includes('加载版本链'))!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('旧项目版本');
    await wrapper.find('input[placeholder="请输入文档标题"]').setValue('旧项目草稿');

    await router.push('/ipd/projects/202/documents');
    await flushPromises();
    expect(wrapper.text()).toContain('新项目文档');
    expect(wrapper.text()).not.toContain('旧项目文档');
    expect(wrapper.text()).not.toContain('旧项目版本');
    expect((wrapper.find('input[placeholder="请输入文档标题"]').element as HTMLInputElement).value).toBe('');
    expect((wrapper.find('input[placeholder="输入文档 ID 查看版本链"]').element as HTMLInputElement).value).toBe('');
    expect(listAiDocumentsByProject).toHaveBeenCalledWith('202');
    wrapper.unmount();
  });

  it('迟到的旧项目列表与版本链响应不能覆盖新项目', async () => {
    const oldList = deferred<AiDocument[]>();
    const oldChain = deferred<AiDocument[]>();
    vi.mocked(listAiDocumentsByProject).mockImplementation((pid) =>
      pid === '101' ? oldList.promise : Promise.resolve([documentFor('202', '新项目文档')]));
    vi.mocked(listAiDocumentVersions).mockReturnValue(oldChain.promise);
    const { router, wrapper } = await mountAt('101');
    await router.push('/ipd/projects/202/documents');
    await flushPromises();
    oldList.resolve([documentFor('101', '迟到旧项目文档')]);
    await flushPromises();
    expect(wrapper.text()).toContain('新项目文档');
    expect(wrapper.text()).not.toContain('迟到旧项目文档');
    wrapper.unmount();

    vi.mocked(listAiDocumentsByProject).mockResolvedValue([]);
    const mounted = await mountAt('101');
    await flushPromises();
    await mounted.wrapper.find('input[placeholder="输入文档 ID 查看版本链"]').setValue('1001');
    await mounted.wrapper.findAll('button').find((button) => button.text().includes('加载版本链'))!.trigger('click');
    await mounted.router.push('/ipd/projects/202/documents');
    oldChain.resolve([documentFor('101', '迟到旧项目版本')]);
    await flushPromises();
    expect(mounted.wrapper.text()).not.toContain('迟到旧项目版本');
    mounted.wrapper.unmount();
  });

  it('旧项目登记完成后不向新项目显示结果或发起旧文档回读', async () => {
    const pending = deferred<AiDocument>();
    vi.mocked(registerAiDocument).mockReturnValue(pending.promise);
    const { router, wrapper } = await mountAt('101');
    await flushPromises();
    await wrapper.find('input[placeholder="请输入文档标题"]').setValue('旧项目草稿');
    await wrapper.find('textarea[placeholder="粘贴 AI 原始输出内容"]').setValue('旧项目正文');
    await wrapper.findAll('button').find((button) => button.text().includes('登记 AI 输出'))!.trigger('click');
    expect(registerAiDocument).toHaveBeenCalledWith(expect.objectContaining({ projectId: '101' }));
    await router.push('/ipd/projects/202/documents');
    pending.resolve(documentFor('101', '迟到登记结果'));
    await flushPromises();
    expect(wrapper.text()).not.toContain('迟到登记结果');
    expect(listAiDocumentsByProject).toHaveBeenCalledWith('202');
    wrapper.unmount();
  });
});
