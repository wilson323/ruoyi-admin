import { describe, expect, it } from 'vitest';
import type { AgentRunEvent } from '../../../../api/ipd/project-agent';
import { verificationGaps } from './verification-gaps';
const event = (seq: number, payload: unknown): AgentRunEvent => ({ seq, type: 'STEP', payload, createdAt: '' });
describe('verification gap evidence', () => {
  it('uses the latest server check and preserves addressable evidence without inventing line numbers', () => {
    expect(verificationGaps([event(1, { kind: 'VERIFY_GAPS', checks: [{ id: 'old', status: 'FAIL', gapSummary: '旧缺口' }] }),
      event(2, { kind: 'VERIFY_GAPS', recheck: true, checks: [
        { id: 'price', status: 'FAIL', severity: 'BLOCK', evidencePath: 'artifact:body', gapSummary: '价格需要来源' },
        { id: 'ok', status: 'PASS', gapSummary: '已满足' }, null,
      ] })])).toEqual({ seq: 2, recheck: true, checks: [{ id: 'price', severity: 'BLOCK', evidencePath: 'artifact:body', gapSummary: '价格需要来源' }] });
  });
  it('clears old failures after a newer pass and never treats model text as checks', () => {
    expect(verificationGaps([event(1, { kind: 'VERIFY_GAPS', checks: [{ id: 'old', status: 'FAIL', gapSummary: '旧缺口' }] }),
      event(2, { kind: 'VERIFY_GAPS', verdict: 'PASS', checks: [] })])?.checks).toEqual([]);
    expect(verificationGaps([event(3, 'VERIFY_GAPS')])).toBeNull();
  });
});
