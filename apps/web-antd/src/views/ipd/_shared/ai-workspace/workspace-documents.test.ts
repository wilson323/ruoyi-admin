import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listAiDocumentsByProject,
  listAiDocumentVersions,
  type AiDocument,
} from '../../../../api/ipd/ai-document';
import { getProject } from '../../../../api/ipd/project';
import WorkspaceDocuments from './workspace-documents.vue';

vi.mock('../../../../api/ipd/ai-document', () => ({
  listAiDocumentsByProject: vi.fn(),
  listAiDocumentVersions: vi.fn(),
}));
vi.mock('../../../../api/ipd/project', () => ({ getProject: vi.fn() }));

function document(id: string, projectId: string, versionNo: number, content: string): AiDocument {
  return {
    content, contentSha256: null, createTime: null, docType: 'PRD', id, model: null,
    parentVersionId: versionNo === 1 ? null : '101', projectId, reviewedAt: null,
    reviewedBy: null, status: 'GENERATED', title: `文档 ${projectId}`, tokenCompletion: null,
    tokenPrompt: null, versionNo,
  };
}

beforeEach(() => {
  vi.mocked(getProject).mockReset();
  vi.mocked(listAiDocumentsByProject).mockReset();
  vi.mocked(listAiDocumentVersions).mockReset();
  vi.mocked(getProject).mockImplementation(async (projectId) => ({ id: projectId }) as never);
});

describe('WorkspaceDocuments', () => {
  it('先校验项目访问，再自动读根版本和最新版本；正文作为文本显示', async () => {
    vi.mocked(listAiDocumentsByProject).mockResolvedValue([document('101', '1001', 1, '初稿')]);
    vi.mocked(listAiDocumentVersions).mockResolvedValue([
      document('101', '1001', 1, '初稿'),
      document('102', '1001', 2, '<script>window.bad=1</script>'),
    ]);
    const wrapper = mount(WorkspaceDocuments, { props: { projectId: '1001' } });
    await flushPromises();
    expect(getProject).toHaveBeenCalledWith('1001');
    expect(listAiDocumentsByProject).toHaveBeenCalledWith('1001');
    expect(listAiDocumentVersions).toHaveBeenCalledWith('101');
    expect(wrapper.get('[data-testid="ipd-ai-document-preview"]').text()).toContain('版本 2');
    expect(wrapper.get('.doc-content').text()).toContain('<script>window.bad=1</script>');
    expect(wrapper.find('script').exists()).toBe(false);
  });

  it('项目访问失败时拒绝读取文档', async () => {
    vi.mocked(getProject).mockRejectedValue(new Error('项目不可见'));
    const wrapper = mount(WorkspaceDocuments, { props: { projectId: '1001' } });
    await flushPromises();
    expect(listAiDocumentsByProject).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="ipd-ai-document-preview"]').exists()).toBe(false);
  });

  it('版本读取失败仍保留文档列表，并允许重试', async () => {
    vi.mocked(listAiDocumentsByProject).mockResolvedValue([
      document('101', '1001', 1, '第一份'),
      document('201', '1001', 1, '第二份'),
    ]);
    vi.mocked(listAiDocumentVersions)
      .mockRejectedValueOnce(new Error('版本暂不可用'))
      .mockResolvedValueOnce([document('102', '1001', 2, '重试成功')]);
    const wrapper = mount(WorkspaceDocuments, { props: { projectId: '1001' } });
    await flushPromises();
    expect(wrapper.findAll('.doc-option')).toHaveLength(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper.get('.doc-retry').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="ipd-ai-document-preview"]').text()).toContain('重试成功');
  });

  it('首份版本请求未返回时也展示列表，可改选另一份文档', async () => {
    vi.mocked(listAiDocumentsByProject).mockResolvedValue([
      document('101', '1001', 1, '第一份'),
      document('201', '1001', 1, '第二份'),
    ]);
    let resolveFirst!: (value: AiDocument[]) => void;
    vi.mocked(listAiDocumentVersions)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([document('202', '1001', 2, '第二份最新')]);
    const wrapper = mount(WorkspaceDocuments, { props: { projectId: '1001' } });
    await flushPromises();
    expect(wrapper.findAll('.doc-option')).toHaveLength(2);
    await wrapper.get('[data-testid="ipd-ai-document-201"]').trigger('click');
    await flushPromises();
    resolveFirst([document('102', '1001', 2, '第一份迟到版本')]);
    await flushPromises();
    expect(wrapper.text()).toContain('第二份最新');
    expect(wrapper.text()).not.toContain('第一份迟到版本');
  });

  it('切项目先清内容，丢弃旧项目的迟到文档列表', async () => {
    let resolveOld!: (value: AiDocument[]) => void;
    vi.mocked(listAiDocumentsByProject)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([document('201', '2002', 1, '新项目初稿')]);
    vi.mocked(listAiDocumentVersions).mockResolvedValue([document('202', '2002', 2, '新项目最新版')]);
    const wrapper = mount(WorkspaceDocuments, { props: { projectId: '1001' } });
    await flushPromises();
    await wrapper.setProps({ projectId: '2002' });
    await flushPromises();
    resolveOld([document('101', '1001', 1, '旧项目文档')]);
    await flushPromises();
    expect(wrapper.text()).toContain('新项目最新版');
    expect(wrapper.text()).not.toContain('旧项目文档');
  });

});
