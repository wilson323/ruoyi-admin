/**
 * 时间线折叠纯函数：只由真实事件驱动，不补造步骤；文本增量合并；链接协议白名单；产物持久 ID 判定。
 */
import { describe, expect, it } from 'vitest';

import type { AgentRunEvent } from '../../../../api/ipd/project-agent';
import {
  buildTimelineItems,
  intentFromEvents,
  intentStepMarks,
  timelineTranscript,
  TIMELINE_SUMMARY_MAX,
} from './timeline-model';

/** 构造事件。 */
function ev(seq: number, type: AgentRunEvent['type'], payload: unknown = {}): AgentRunEvent {
  return { seq, type, payload, createdAt: `2026-09-29T00:00:0${seq % 10}Z` };
}

describe('buildTimelineItems', () => {
  it('returns no items for no events (no fabricated "thinking" steps)', () => {
    expect(buildTimelineItems([])).toEqual([]);
  });

  it('maps each contract event type to exactly one item kind', () => {
    const items = buildTimelineItems([
      ev(1, 'RUN_STARTED'),
      ev(2, 'STEP', { title: '检索资料', detail: '按阶段过滤' }),
      ev(3, 'TOOL_CALL', { toolName: 'kb.search', arguments: { q: '竞品' } }),
      ev(4, 'TOOL_RESULT', { toolName: 'kb.search', summary: '命中 3 条' }),
      ev(5, 'SOURCE', { title: '市场报告', url: 'https://example.com/r' }),
      ev(6, 'TEXT_DELTA', { text: '结论：' }),
      ev(7, 'ARTIFACT', {
        artifactId: 'art-1',
        title: '竞品分析',
        artifactType: 'DOC',
        content: '正文预览片段',
      }),
      ev(8, 'ERROR', { code: 'TOOL_TIMEOUT', message: '工具超时' }),
      ev(9, 'RUN_FINISHED', { status: 'FAILED' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      'run-started',
      'step',
      'tool-call',
      'tool-result',
      'source',
      'text',
      'artifact',
      'error',
      'run-finished',
    ]);
    expect(items[1]).toMatchObject({ title: '检索资料', detail: '按阶段过滤' });
    expect(items[2]).toMatchObject({ toolName: 'kb.search', summary: '{"q":"竞品"}' });
    expect(items[6]).toMatchObject({
      artifactId: 'art-1',
      title: '竞品分析',
      preview: '正文预览片段',
    });
    expect(items[7]).toMatchObject({ code: 'TOOL_TIMEOUT', message: '工具超时' });
    expect(items[8]).toMatchObject({ status: 'FAILED' });
  });

  it('merges consecutive TEXT_DELTA events and starts a new block after an interruption', () => {
    const items = buildTimelineItems([
      ev(1, 'TEXT_DELTA', { delta: '你' }),
      ev(2, 'TEXT_DELTA', '好'),
      ev(3, 'STEP', { name: '引用来源' }),
      ev(4, 'TEXT_DELTA', { content: '！' }),
    ]);
    expect(items.map((i) => (i.kind === 'text' ? i.text : i.kind))).toEqual(['你好', 'step', '！']);
    expect(items[0]!.key).toBe('seq-1');
  });

  it('only allows http(s) source links', () => {
    const [bad, good] = buildTimelineItems([
      ev(1, 'SOURCE', { title: 'x', url: 'javascript:alert(1)' }),
      ev(2, 'SOURCE', { title: 'y', url: 'http://intranet/doc' }),
    ]);
    expect(bad).toMatchObject({ kind: 'source', url: null });
    expect(good).toMatchObject({ kind: 'source', url: 'http://intranet/doc' });
  });

  it('marks an artifact as feedback-capable only with a non-empty string artifactId', () => {
    const items = buildTimelineItems([
      ev(1, 'ARTIFACT', { artifactId: 42, title: '数值 ID' }),
      ev(2, 'ARTIFACT', { artifactId: '  ', title: '空白 ID' }),
      ev(3, 'ARTIFACT', { title: '无 ID' }),
    ]);
    expect(items.map((i) => (i.kind === 'artifact' ? i.artifactId : 'x'))).toEqual([null, null, null]);
  });

  it('extracts artifact preview from common content fields and leaves it empty otherwise', () => {
    const items = buildTimelineItems([
      ev(1, 'ARTIFACT', { artifactId: 'a1', preview: '预览 A' }),
      ev(2, 'ARTIFACT', { artifactId: 'a2', summary: '摘要 B' }),
      ev(3, 'ARTIFACT', { artifactId: 'a3', title: '仅标题', contentHash: 'abc' }),
    ]);
    expect(items.map((i) => (i.kind === 'artifact' ? i.preview : 'x'))).toEqual(['预览 A', '摘要 B', '']);
  });

  it('flags failed tool results and truncates long summaries', () => {
    const long = 'a'.repeat(TIMELINE_SUMMARY_MAX + 20);
    const [failed, truncated] = buildTimelineItems([
      ev(1, 'TOOL_RESULT', { toolId: 't1', success: false }),
      ev(2, 'TOOL_RESULT', { toolId: 't2', output: long }),
    ]);
    expect(failed).toMatchObject({ failed: true, toolName: 't1' });
    expect(truncated).toMatchObject({ failed: false });
    expect(truncated!.kind === 'tool-result' && truncated!.summary.length).toBe(TIMELINE_SUMMARY_MAX + 1);
  });

  it('does not invent a finished status when the payload lacks a valid one', () => {
    const [item] = buildTimelineItems([ev(1, 'RUN_FINISHED', { status: 'DONE' })]);
    expect(item).toMatchObject({ kind: 'run-finished', status: null });
  });

  it('keeps INTENT fields as booleans and string arrays, and keeps a string versionId', () => {
    const items = buildTimelineItems([
      ev(1, 'STEP', {
        kind: 'INTENT',
        title: '意图判断',
        detail: '范围还没定，先澄清，不进入执行。',
        needsPlan: false,
        needsClarification: true,
        questions: ['范围还没定'],
        steps: ['核对功能'],
      }),
      ev(2, 'STEP', {
        kind: 'INTENT',
        needsPlan: 'yes',
        needsClarification: 1,
        questions: '不是数组',
        steps: ['ok', 2],
      }),
      ev(3, 'STEP', { kind: 'SKILL_LOADED', name: 'swot', version: '1' }),
      ev(4, 'ARTIFACT', { artifactId: 'art-1', versionId: '2096266884247736321', title: '报告' }),
      ev(5, 'ARTIFACT', { artifactId: 'art-2', versionId: '   ', title: '旧事件' }),
      ev(6, 'ARTIFACT', { artifactId: 'art-3', versionId: 42, title: '数字版本' }),
    ]);
    expect(items[0]).toMatchObject({
      kind: 'intent',
      title: '意图判断',
      detail: '范围还没定，先澄清，不进入执行。',
      needsPlan: false,
      needsClarification: true,
      questions: ['范围还没定'],
      steps: ['核对功能'],
    });
    expect(items[1]).toMatchObject({
      kind: 'intent',
      needsPlan: false,
      needsClarification: false,
      questions: [],
      steps: [],
    });
    expect(items[2]).toMatchObject({ kind: 'step', title: 'swot' });
    expect(items[3]).toMatchObject({ kind: 'artifact', artifactId: 'art-1', versionId: '2096266884247736321' });
    expect(items[4]).toMatchObject({ kind: 'artifact', versionId: null });
    expect(items[5]).toMatchObject({ kind: 'artifact', versionId: null });
    expect(intentFromEvents(items.length === 0 ? [] : [
      ev(1, 'STEP', {
        kind: 'INTENT',
        questions: ['范围还没定'],
        steps: ['核对功能'],
        needsPlan: true,
        needsClarification: false,
      }),
    ])).toMatchObject({ questions: ['范围还没定'], steps: ['核对功能'], needsPlan: true });
    expect(intentFromEvents([])).toBeNull();
    const planEvents = [
      ev(1, 'STEP', { kind: 'INTENT', needsPlan: true, steps: ['核对功能', '核对价格'] }),
      ev(2, 'TEXT_DELTA', { text: '正文' }),
    ];
    expect(intentStepMarks(planEvents, 2)).toEqual(['待执行', '执行中']);
    expect(intentStepMarks([...planEvents, ev(3, 'RUN_FINISHED', { status: 'SUCCEEDED' })], 2)).toEqual([
      '已完成',
      '已完成',
    ]);
  });

  it('skips event types outside the contract instead of crashing', () => {
    const items = buildTimelineItems([
      ev(1, 'STEP', { title: 'a' }),
      { seq: 2, type: 'HEARTBEAT' as AgentRunEvent['type'], payload: {}, createdAt: 'x' },
    ]);
    expect(items).toHaveLength(1);
  });

  it('timelineTranscript only joins TEXT_DELTA, never STEP skill or intent detail', () => {
    const transcript = timelineTranscript([
      ev(1, 'STEP', {
        kind: 'SKILL_LOADED',
        name: 'c02-competitor',
        detail: '按 C02 竞品分析 skill 的执行规约，先对四类事实源做并行检索',
      }),
      ev(2, 'STEP', {
        kind: 'INTENT',
        title: '意图判断',
        detail: '可以直接回答，不单独列计划。',
        needsPlan: false,
        needsClarification: false,
      }),
      ev(3, 'TEXT_DELTA', { text: '<think>只保留模型正文</think>答复一句' }),
    ]);
    expect(transcript).toBe('<think>只保留模型正文</think>答复一句');
    expect(transcript).not.toContain('C02 竞品分析');
    expect(transcript).not.toContain('可以直接回答');
    expect(transcript).not.toContain('执行规约');
  });
});
