import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiDocument } from '../../../../api/ipd/ai-document';
import {
  listAiDocumentVersions,
  rejectAiDocumentVersion,
  reviewAiDocumentVersion,
} from '../../../../api/ipd/ai-document';
import { headReviewActions } from './document-review-actions';
import DocumentVersionReview from './document-version-review.vue';

vi.mock('../../../../api/ipd/ai-document', () => ({
  listAiDocumentVersions: vi.fn(),
  rejectAiDocumentVersion: vi.fn(),
  reviewAiDocumentVersion: vi.fn(),
}));

function version(partial: Partial<AiDocument> & Pick<AiDocument, 'id' | 'status' | 'versionNo'>): AiDocument {
  return {
    content: '正文',
    contentSha256: null,
    createTime: null,
    docType: 'MRD',
    model: null,
    parentVersionId: null,
    projectId: '200',
    reviewedAt: null,
    reviewedBy: null,
    title: '竞品分析',
    tokenCompletion: null,
    tokenPrompt: null,
    ...partial,
  };
}

async function mountReview(rows: AiDocument[], projectId = '200') {
  vi.mocked(listAiDocumentVersions).mockResolvedValue(rows);
  const wrapper = mount(DocumentVersionReview, {
    attachTo: document.body,
    props: { documentId: rows[0]?.id ?? '1', projectId },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.mocked(rejectAiDocumentVersion).mockReset();
  vi.mocked(reviewAiDocumentVersion).mockReset();
});

describe('链头审核动作', () => {
  it('待审核和已退回可以审核通过；待审核和已审核可以退回', () => {
    expect(headReviewActions('GENERATED')).toEqual({ approve: true, reject: true });
    expect(headReviewActions('REJECTED')).toEqual({ approve: true, reject: false });
    expect(headReviewActions('REVIEWED')).toEqual({ approve: false, reject: true });
    expect(headReviewActions('ARCHIVED')).toEqual({ approve: false, reject: false });
  });
});

describe('当前产物版本审核', () => {
  it('待审核链头同时给出审核通过和退回修改', async () => {
    const wrapper = await mountReview([version({ id: '9001', status: 'GENERATED', versionNo: 1 })]);
    expect(wrapper.text()).toContain('待审核');
    expect(wrapper.find('[data-testid="document-review-approve"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="document-review-reject"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('退回意见提交到当前链头，路径使用版本链起点', async () => {
    const wrapper = await mountReview([
      version({ id: '1', status: 'REVIEWED', versionNo: 1 }),
      version({ id: '2', parentVersionId: '1', status: 'GENERATED', versionNo: 2 }),
    ]);
    vi.mocked(rejectAiDocumentVersion).mockResolvedValue(
      version({ id: '2', parentVersionId: '1', reviewComment: '要改范围', status: 'REJECTED', versionNo: 2 }),
    );
    await wrapper.find('[data-testid="document-review-reject"]').trigger('click');
    await flushPromises();
    const area = document.body.querySelector('[data-testid="document-review-comment"]') as HTMLTextAreaElement;
    area.value = '要改范围';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const confirm = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认退回'),
    ) as HTMLButtonElement;
    confirm.click();
    await flushPromises();
    expect(rejectAiDocumentVersion).toHaveBeenCalledWith('1', '2', { comment: '要改范围' });
    wrapper.unmount();
  });

  it('空意见不能提交退回', async () => {
    const wrapper = await mountReview([version({ id: '9001', status: 'GENERATED', versionNo: 1 })]);
    await wrapper.find('[data-testid="document-review-reject"]').trigger('click');
    await flushPromises();
    const confirm = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认退回'),
    ) as HTMLButtonElement;
    expect(confirm.hasAttribute('disabled')).toBe(true);
    confirm.click();
    await flushPromises();
    expect(rejectAiDocumentVersion).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('文档不属于当前项目时不调用审核', async () => {
    const wrapper = await mountReview(
      [version({ id: '9001', projectId: '999', status: 'GENERATED', versionNo: 1 })],
      '200',
    );
    expect(wrapper.text()).toContain('不属于当前项目');
    expect(wrapper.find('[data-testid="document-review-approve"]').exists()).toBe(false);
    expect(reviewAiDocumentVersion).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('已退回的链头可以审核通过，不再提供退回', async () => {
    const wrapper = await mountReview([
      version({ id: '9001', reviewComment: '上次意见', status: 'REJECTED', versionNo: 1 }),
    ]);
    expect(wrapper.find('[data-testid="document-review-approve"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="document-review-reject"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('上次意见');
    vi.mocked(reviewAiDocumentVersion).mockResolvedValue(
      version({ id: '9001', status: 'REVIEWED', versionNo: 1 }),
    );
    await wrapper.find('[data-testid="document-review-approve"]').trigger('click');
    await flushPromises();
    expect(reviewAiDocumentVersion).toHaveBeenCalledWith('9001', '9001');
    wrapper.unmount();
  });
});

it('同项目切文档清掉旧链，并忽略旧文档迟到响应', async () => {
  let resolveOld!: (rows: AiDocument[]) => void;
  vi.mocked(listAiDocumentVersions).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const wrapper = mount(DocumentVersionReview, { props: { documentId: '1', projectId: '200' } });
  vi.mocked(listAiDocumentVersions).mockResolvedValueOnce([version({ id: '2', title: '新文档', status: 'GENERATED', versionNo: 1 })]);
  await wrapper.setProps({ documentId: '2' });
  await flushPromises();
  resolveOld([version({ id: '1', title: '旧文档', status: 'GENERATED', versionNo: 1 })]);
  await flushPromises();
  expect(wrapper.text()).toContain('新文档');
  expect(wrapper.text()).not.toContain('旧文档');
  await wrapper.get('[data-testid="document-review-approve"]').trigger('click');
  expect(reviewAiDocumentVersion).toHaveBeenLastCalledWith('2', '2');
  wrapper.unmount();
});
