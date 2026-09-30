import { describe, expect, it } from 'vitest';

import type { ApplyAgentArtifactReceipt } from '../../../../api/ipd/project-agent';
import { archiveResultText } from './artifact-archive';

function receipt(patch: Partial<ApplyAgentArtifactReceipt> = {}): ApplyAgentArtifactReceipt {
  return {
    artifactId: 'art-9',
    documentId: '3096266884247736321',
    documentStatus: 'GENERATED',
    indexStatus: 'NOT_INDEXED',
    runId: 'run-1',
    versionId: '2096266884247736321',
    versionNo: 1,
    ...patch,
  };
}

describe('archiveResultText', () => {
  it('states the document was filed and the knowledge base is not indexed yet', () => {
    expect(archiveResultText(receipt())).toBe(
      '已回填项目文档 #3096266884247736321，状态：待审核。知识库未入库，待审核后才索引',
    );
    expect(archiveResultText(receipt())).not.toContain('GENERATED');
    expect(archiveResultText(receipt())).not.toContain('已生成');
    expect(archiveResultText(receipt())).not.toContain('READY');
  });

  it('uses the backend display label and still says 待审核 for GENERATED', () => {
    expect(archiveResultText(receipt({ documentStatusLabel: '待审核' }))).toContain('状态：待审核');
  });

  it('prints a non-pending index status as returned', () => {
    expect(archiveResultText(receipt({ indexStatus: 'READY' }))).toContain('知识库索引：READY');
  });

  it('returns empty when the document id is missing', () => {
    expect(archiveResultText(receipt({ documentId: null }))).toBe('');
  });
});
