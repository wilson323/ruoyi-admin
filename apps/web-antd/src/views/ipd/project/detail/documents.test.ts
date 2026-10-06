import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { AiDocument } from '../../../../api/ipd/ai-document';
import {
  importAiDocumentFinalVersion,
  listAiDocumentVersions,
  listAiDocumentsByProject,
  registerAiDocument,
  rejectAiDocumentVersion,
} from '../../../../api/ipd/ai-document';
import { IpdRequestError } from '../../../../api/ipd/auth';
import DocumentsTab from './documents.vue';

vi.mock('../../../../api/ipd/ai-document', () => ({
  ipdApiErrorText: (error: unknown) => error instanceof Error ? error.message : String(error),
  importAiDocumentFinalVersion: vi.fn(),
  listAiDocumentVersions: vi.fn(),
  listAiDocumentsByProject: vi.fn(),
  registerAiDocument: vi.fn(),
  rejectAiDocumentVersion: vi.fn(),
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
    routes: [{ path: '/ipd/projects/:projectId/documents', component: { template: '<div />' } }, { path: '/ipd/ai-assistant', component: { template: '<div />' } }],
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
  vi.mocked(rejectAiDocumentVersion).mockReset();
  vi.mocked(importAiDocumentFinalVersion).mockReset();
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

describe('当前版本退回修改', () => {
  it('意见提交到链头版本，路径文档编号用版本链起点', async () => {
    const older = {
      ...documentFor('101', '旧版'),
      id: '1001',
      status: 'REVIEWED',
      versionNo: 1,
    };
    const current = {
      ...documentFor('101', '当前版'),
      id: '1002',
      parentVersionId: '1001',
      status: 'GENERATED',
      title: '当前版',
      versionNo: 2,
    };
    vi.mocked(listAiDocumentVersions).mockResolvedValue([older, current]);
    vi.mocked(rejectAiDocumentVersion).mockResolvedValue({
      ...current,
      reviewComment: '事实不对',
      status: 'REJECTED',
    });
    const { wrapper } = await mountAt('101');
    await flushPromises();
    await wrapper.find('input[placeholder="输入文档 ID 查看版本链"]').setValue('1001');
    await wrapper.findAll('button').find((button) => button.text().includes('加载版本链'))!.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="document-return"]')).toHaveLength(1);
    await wrapper.find('[data-testid="document-return"]').trigger('click');
    await flushPromises();
    const area = document.body.querySelector('[data-testid="document-return-comment"]') as HTMLTextAreaElement;
    area.value = '事实不对';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const confirm = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认退回'),
    ) as HTMLButtonElement;
    expect(confirm.hasAttribute('disabled')).toBe(false);
    confirm.click();
    await flushPromises();
    expect(rejectAiDocumentVersion).toHaveBeenCalledWith('1001', '1002', { comment: '事实不对' });
    wrapper.unmount();
  });
});

describe('人工审计导入终稿', () => {
  /** 链头为 v2 GENERATED（id 1002），导入按钮只出现在链头。 */
  async function mountWithChainHead() {
    const older = { ...documentFor('101', '旧版'), id: '1001', status: 'REVIEWED', versionNo: 1 };
    const current = {
      ...documentFor('101', '当前版'), id: '1002', parentVersionId: '1001', status: 'GENERATED', versionNo: 2,
    };
    vi.mocked(listAiDocumentVersions).mockResolvedValue([older, current]);
    const { wrapper } = await mountAt('101');
    await flushPromises();
    await wrapper.find('input[placeholder="输入文档 ID 查看版本链"]').setValue('1001');
    await wrapper.findAll('button').find((button) => button.text().includes('加载版本链'))!.trigger('click');
    await flushPromises();
    return { current, wrapper };
  }

  it('导入按钮仅链头可见；选择文件后提交，以链头版本为基准追加待审核版本并重载链', async () => {
    const { current, wrapper } = await mountWithChainHead();
    const importButtons = wrapper.findAll('[data-testid="document-import-final"]');
    expect(importButtons).toHaveLength(1);
    expect(importButtons[0]?.text()).toContain('导入终稿');

    await importButtons[0]!.trigger('click');
    await flushPromises();
    const fileInput = document.body.querySelector('[data-testid="document-import-file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const confirm = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认导入'),
    ) as HTMLButtonElement;
    // 未选文件前确认钮禁用（后端要文件，前端不留空提交口）
    expect(confirm.hasAttribute('disabled')).toBe(true);

    const file = new File(['终稿正文'], 'final.docx');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    expect([...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认导入'),
    )!.hasAttribute('disabled')).toBe(false);

    vi.mocked(importAiDocumentFinalVersion).mockResolvedValue({
      ...current, id: '1003', parentVersionId: '1002', status: 'GENERATED', title: '当前版', versionNo: 3,
    });
    [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认导入'),
    )!.click();
    await flushPromises();
    // 弹窗预填链头标题，提交时原样透传（留空才回退 null）
    expect(importAiDocumentFinalVersion).toHaveBeenCalledWith('1002', {
      baseVersionId: '1002', file, title: '当前版',
    });
    // 导入成功后回读新版本链（loadChain 第二次调用指向新行）
    expect(listAiDocumentVersions).toHaveBeenLastCalledWith('1003');
    wrapper.unmount();
  });

  it('基准已被他人改版（409/50002）时不报错卡死，自动刷新版本链让用户看到最新态', async () => {
    const { wrapper } = await mountWithChainHead();
    await wrapper.find('[data-testid="document-import-final"]').trigger('click');
    await flushPromises();
    const fileInput = document.body.querySelector('[data-testid="document-import-file"]') as HTMLInputElement;
    const file = new File(['终稿'], 'final.txt');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    vi.mocked(importAiDocumentFinalVersion).mockRejectedValue(
      new IpdRequestError('状态冲突', 409, 50002, 'http'),
    );
    [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认导入'),
    )!.click();
    await flushPromises();
    expect(importAiDocumentFinalVersion).toHaveBeenCalledTimes(1);
    // 冲突后自动重读原链头（第二次 loadChain 回到 1002），不静默假装成功
    expect(listAiDocumentVersions).toHaveBeenLastCalledWith('1002');
    wrapper.unmount();
  });
});

describe('生成入口', () => {
  it('从当前项目打开既有项目智能体，不在文档页创建运行', async () => {
    const { router, wrapper } = await mountAt('101');
    await flushPromises();
    expect(wrapper.text()).not.toContain('AI 模型生成（P4-2）尚未交付');
    await wrapper.findAll('button').find((button) => button.text() === '在项目智能体生成交付物')!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/ipd/ai-assistant');
    expect(router.currentRoute.value.query.projectId).toBe('101');
    expect(registerAiDocument).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
