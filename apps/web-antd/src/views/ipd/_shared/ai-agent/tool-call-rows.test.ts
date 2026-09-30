import { describe, expect, it } from 'vitest';

import { buildTimelineItems } from './timeline-model';
import { foldTimelineRows } from './tool-call-rows';
import type { AgentRunEvent } from '../../../../api/ipd/project-agent';

function ev(seq: number, type: AgentRunEvent['type'], payload: unknown = {}): AgentRunEvent {
  return { seq, type, payload, createdAt: 'x' };
}

describe('foldTimelineRows', () => {
  it('把同名调用与结果收成一张完成卡', () => {
    const items = buildTimelineItems([
      ev(1, 'TOOL_CALL', { toolName: 'search_web', arguments: { query: '需求' } }),
      ev(2, 'TOOL_RESULT', { toolName: 'search_web', output: '找到 2 条' }),
      ev(3, 'TEXT_DELTA', { text: '结论' }),
    ]);
    const rows = foldTimelineRows(items, false);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: 'tool',
      card: {
        name: 'search_web',
        state: 'completed',
        output: '找到 2 条',
      },
    });
    expect(rows[1]?.kind).toBe('plain');
  });

  it('失败结果展开为错误态，轮询中的未返回调用为执行中', () => {
    const failed = foldTimelineRows(
      buildTimelineItems([
        ev(1, 'TOOL_CALL', { name: 'api_request', input: { url: 'https://example.com' } }),
        ev(2, 'TOOL_RESULT', { name: 'api_request', success: false, summary: '超时' }),
      ]),
      false,
    );
    expect(failed[0]).toMatchObject({
      kind: 'tool',
      card: { state: 'error', error: '超时' },
    });

    const running = foldTimelineRows(
      buildTimelineItems([ev(1, 'TOOL_CALL', { toolName: 'create_file' })]),
      true,
    );
    expect(running[0]).toMatchObject({ kind: 'tool', card: { state: 'running', name: 'create_file' } });
  });
});
