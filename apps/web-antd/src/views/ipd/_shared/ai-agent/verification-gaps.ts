import type { AgentRunEvent } from '../../../../api/ipd/project-agent';

export interface VerificationGap {
  id: string;
  evidencePath: string;
  gapSummary: string;
  severity: 'BLOCK' | 'WARN';
}

/** 只读最后一次服务器检查；不从模型正文猜测缺口或定位行号。 */
export function verificationGaps(events: readonly AgentRunEvent[]): { seq: number; checks: VerificationGap[]; recheck: boolean } | null {
  const latest = [...events].reverse().find(event => event.type === 'STEP'
    && typeof event.payload === 'object' && event.payload !== null
    && (event.payload as Record<string, unknown>).kind === 'VERIFY_GAPS');
  if (!latest) return null;
  const payload = latest.payload as Record<string, unknown>;
  const checks = Array.isArray(payload.checks) ? payload.checks.flatMap(check => {
    if (!check || typeof check !== 'object') return [];
    const row = check as Record<string, unknown>;
    if (row.status !== 'FAIL' || typeof row.id !== 'string' || !row.id.trim()
      || typeof row.gapSummary !== 'string' || !row.gapSummary.trim()) return [];
    return [{ id: row.id, gapSummary: row.gapSummary,
      evidencePath: typeof row.evidencePath === 'string' ? row.evidencePath : '',
      severity: row.severity === 'WARN' ? 'WARN' as const : 'BLOCK' as const }];
  }) : [];
  return { seq: latest.seq, checks, recheck: payload.recheck === true };
}
