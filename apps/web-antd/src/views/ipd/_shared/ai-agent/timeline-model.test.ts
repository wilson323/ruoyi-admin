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

  it('replaces all prior text with the authoritative final message while retaining evidence', () => {
    const events = [
      ev(1, 'TEXT_DELTA', { text: '中间回复' }),
      ev(2, 'SOURCE', { title: '原始资料', ref: 'doc-1' }),
      ev(3, 'TEXT_DELTA', { text: '继续生成' }),
      ev(4, 'TEXT_DELTA', { text: '最终正文', replace: true }),
    ];
    const items = buildTimelineItems(events);
    expect(items.map((item) => item.kind)).toEqual(['source', 'text']);
    expect(timelineTranscript(events)).toBe('最终正文');
    expect(items[0]).toMatchObject({ reference: 'doc-1' });
    expect(timelineTranscript([
      ...events, ev(5, 'TEXT_DELTA', { text: '', replace: true }),
    ])).toBe('');
  });

  it('keeps execution ownership metadata out of the product timeline', () => {
    expect(buildTimelineItems([ev(1, 'STEP', { kind: 'EXECUTION_OWNER', epoch: 1 })])).toEqual([]);
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
    expect(intentStepMarks(planEvents, 2)).toEqual(['待核实', '待核实']);
    expect(intentStepMarks([...planEvents, ev(3, 'RUN_FINISHED', { status: 'SUCCEEDED' })], 2)).toEqual([
      '待核实',
      '待核实',
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
  it('单行检索成功不能证明六个技能步骤完成', () => {
    const events = [
      ev(1, 'STEP', { kind: 'INTENT', steps: ['范围', '四维', '价格', '竞品', '报告', '自检'] }),
      ev(2, 'TOOL_CALL', { toolName: 'project_knowledge_search', toolCallId: 'a' }),
      ev(3, 'TOOL_RESULT', { toolCallId: 'a', state: 'SUCCESS' }),
      ev(4, 'TEXT_DELTA', { text: '研发费用率12.83%' }),
      ev(5, 'RUN_FINISHED', { status: 'SUCCEEDED' }),
    ];
    expect(intentStepMarks(events, 6)).toEqual(Array(6).fill('待核实'));
    expect(intentStepMarks(events, 0)).toEqual([]);
  });

  it('把部分查到、没有查成和没有命中分开，失败不因 hits 被说成没命中', () => {
    const [partial, failed, noHit, hit] = buildTimelineItems([
      ev(1, 'SOURCE', { retrievalStatus: 'PARTIAL', hits: 0, preview: '阶段=调用' }),
      ev(2, 'SOURCE', { retrievalStatus: 'FAILED', hits: [{ id: 'old' }], preview: '连接失败' }),
      ev(3, 'SOURCE', { retrievalStatus: 'SUCCESS', hits: 0 }),
      ev(4, 'SOURCE', { retrievalStatus: 'SUCCESS', hits: [{ id: '1' }] }),
    ]);
    expect(partial).toMatchObject({ retrieval: 'partial', outcomeText: '部分查到', reasonText: '' });
    expect(failed).toMatchObject({ retrieval: 'failed', outcomeText: '没有查成', reasonText: '' });
    expect(noHit).toMatchObject({ retrieval: 'no-hit', outcomeText: '没有命中' });
    expect(hit).toMatchObject({ retrieval: 'hit', outcomeText: '已查到', reasonText: '' });
    expect(partial).not.toMatchObject({ outcomeText: '没有命中' });
    expect(failed).not.toMatchObject({ outcomeText: '没有命中' });
  });

  it('只展示事件里已有的原因码和合格出处，不从 preview 编原因', () => {
    const [known, unknown, dropped] = buildTimelineItems([
      ev(1, 'SOURCE', {
        retrievalStatus: 'FAILED',
        reasonCode: 'TIMEOUT',
        preview: '阶段=握手 原因=超时',
        sourceEvidence: [
          {
            sourceType: 'PROJECT_DOCUMENT',
            documentId: '2106061816428781569',
            sourceName: '竞品修订稿',
            reviewStatus: 'REVIEWED',
          },
          {
            sourceType: 'KNOWLEDGE_FRAGMENT',
            documentId: 'doc-1',
            knowledgeId: 'k-1',
            fragmentId: 'f-1',
            sourceName: '产品手册',
            reviewStatus: 'NOT_PROJECT_DOCUMENT',
          },
        ],
      }),
      ev(2, 'SOURCE', { retrievalStatus: 'FAILED', reasonCode: 'MADE_UP', preview: '阶段=调用' }),
      ev(3, 'SOURCE', {
        retrievalStatus: 'SUCCESS',
        sourceEvidence: [{
          sourceType: 'KNOWLEDGE_FRAGMENT',
          documentId: 'doc-1',
          knowledgeId: 'k-1',
          sourceName: '缺片段',
          reviewStatus: 'REVIEWED',
        }],
      }),
    ]);
    expect(known).toMatchObject({
      reasonText: '查询超时',
      evidence: [
        { kindLabel: '项目已审核文档', sourceName: '竞品修订稿' },
        { kindLabel: '产品知识库', sourceName: '产品手册' },
      ],
    });
    expect(unknown).toMatchObject({ retrieval: 'failed', reasonText: '' });
    expect(dropped).toMatchObject({ evidence: [], retrieval: 'hit' });
  });

  it('查询能力缺失只翻译已知原因，不改变无权或未知来源边界', () => {
    const [failed, unauthorized, unknown] = buildTimelineItems([
      ev(1, 'SOURCE', {
        retrievalStatus: 'FAILED', reasonCode: 'TOOLS_CAPABILITY_MISSING',
        mcpSdkFrames: ['io.modelcontextprotocol.client.McpAsyncClient#listToolsInternal:653'],
      }),
      ev(2, 'SOURCE', { retrievalStatus: 'UNAUTHORIZED', reasonCode: 'TOOLS_CAPABILITY_MISSING' }),
      ev(3, 'SOURCE', { retrievalStatus: 'UNKNOWN', reasonCode: 'TOOLS_CAPABILITY_MISSING' }),
    ]);
    expect(failed).toMatchObject({ retrieval: 'failed', outcomeText: '没有查成', reasonText: '知识库服务暂未提供查询能力' });
    expect(JSON.stringify(failed)).not.toMatch(/TOOLS_CAPABILITY_MISSING|McpAsyncClient|listToolsInternal/);
    expect(unauthorized).toMatchObject({ retrieval: 'unauthorized', outcomeText: '无权查看', reasonText: '' });
    expect(unknown).toMatchObject({ retrieval: 'unknown', outcomeText: '', reasonText: '' });
  });

  it('没有检索状态时不编没有查成', () => {
    const [item] = buildTimelineItems([ev(1, 'SOURCE', { title: '市场报告' })]);
    expect(item).toMatchObject({ retrieval: 'unknown', outcomeText: '', reasonText: '', evidence: [] });
  });

  it('无权查看不能被命中数或原因码改成失败、空命中或成功', () => {
    const [item] = buildTimelineItems([ev(1, 'SOURCE', {
      retrievalStatus: 'UNAUTHORIZED', hits: 1, reasonCode: 'TIMEOUT',
      query: '私密问题', preview: '私密错误', citationText: '私密正文',
    })]);
    expect(item).toMatchObject({ retrieval: 'unauthorized', outcomeText: '无权查看', reasonText: '' });
    expect(JSON.stringify(item)).not.toMatch(/私密问题|私密错误|私密正文/);
  });

  it('原型成员不是已知原因码，缺审核合同的知识出处不能展示', () => {
    for (const reasonCode of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const [item] = buildTimelineItems([ev(1, 'SOURCE', { retrievalStatus: 'FAILED', reasonCode })]);
      expect(item).toMatchObject({ reasonText: '', retrieval: 'failed' });
    }
    const identity = { sourceType: 'KNOWLEDGE_FRAGMENT', documentId: 'd', knowledgeId: 'k', fragmentId: 'f', sourceName: '产品手册' };
    const [item] = buildTimelineItems([ev(1, 'SOURCE', { retrievalStatus: 'SUCCESS', sourceEvidence: [
      identity, { ...identity, reviewStatus: 'UNKNOWN' }, { ...identity, reviewStatus: 'REVIEWED' },
      { ...identity, reviewStatus: 'NOT_PROJECT_DOCUMENT' },
    ] })]);
    expect(item).toMatchObject({ evidence: [{ kindLabel: '产品知识库', sourceName: '产品手册' }] });
  });

});
