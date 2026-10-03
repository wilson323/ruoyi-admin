import { describe, expect, it } from 'vitest';
import { agentInterruptPause, interruptInput, interruptTextResponse, validateInterruptPayload } from './agui-interrupt';
const question = { id: 'question-1', reason: 'input_required', responseSchema: { type: 'object', properties: { country: { type: 'string', enum: ['中国', '日本'], title: '国家' }, amount: { type: 'integer', minimum: 1 } }, required: ['country', 'amount'] } };
describe('durable AG-UI interrupt model', () => {
  it('supports explicit free text questions with exact bounds and rejects invalid or extra answers', () => {
    const clarification = { id: 'facts', reason: 'tool_call', metadata: { toolName: 'request_clarification', toolInput: { kind: 'CLARIFICATION', questions: [
      { id: 'facts', prompt: '其他情况请说明', options: [] },
    ] } }, responseSchema: { type: 'object', properties: { facts: { type: 'string', title: '其他情况请说明', minLength: 1, maxLength: 4000 } }, required: ['facts'], additionalProperties: false } };
    expect(interruptInput(clarification).error).toBe('');
    expect(validateInterruptPayload(clarification, { facts: '已确认事实和来源' })).toBe('');
    expect(validateInterruptPayload(clarification, { facts: 'a'.repeat(4000) })).toBe('');
    for (const payload of [{ facts: '' }, { facts: ' \n\t ' }, { facts: 'a'.repeat(4001) }, { facts: 3 }, { unknown: '内容' }, { approved: true }, { facts: '内容', approved: true }]) {
      expect(validateInterruptPayload(clarification, payload)).not.toBe('');
    }
    expect(interruptInput({ ...clarification, responseSchema: { ...clarification.responseSchema, properties: { facts: { ...clarification.responseSchema.properties.facts, maxLength: 4001 } } } }).error).toContain('暂不支持');
  });
  it('does not accept permission approval as the answer to a clarification tool', () => {
    const clarification = { id: 'q', reason: 'tool_call', metadata: { toolName: 'request_clarification', toolInput: { kind: 'CLARIFICATION', questions: [
      { id: 'scope', prompt: '选择范围', options: [{ id: 'all', label: '全部' }, { id: 'some', label: '部分' }] },
    ] } }, responseSchema: { type: 'object', properties: { scope: { type: 'string', title: '选择范围', enum: ['all', 'some'] } }, required: ['scope'], additionalProperties: false } };
    expect(validateInterruptPayload(clarification, { approved: true })).not.toBe('');
    expect(validateInterruptPayload(clarification, { scope: 'all' })).toBe('');
    expect(validateInterruptPayload(clarification, { scope: 'all', approved: true })).toContain('问题之外');
    expect(validateInterruptPayload(clarification, { scope: '全部' })).not.toBe('');
    expect(interruptInput({ ...clarification, responseSchema: undefined }).error).toContain('暂不支持');
    expect(interruptInput({ ...clarification, metadata: { ...clarification.metadata, toolInput: {} } }).error).toContain('暂不支持');
    for (const additionalProperties of [undefined, true]) {
      const damaged = { ...clarification, responseSchema: { ...clarification.responseSchema, additionalProperties } };
      expect(interruptInput(damaged).error).toContain('暂不支持');
      expect(validateInterruptPayload(damaged, { scope: 'all' })).toContain('暂不支持');
      expect(validateInterruptPayload(damaged, { approved: true })).toContain('暂不支持');
    }
  });
  it('reads only the latest canonical waiting step without accepting mismatched interrupt ids', () => {
    const events = [{ seq: 7, type: 'STEP' as const, payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { 'question-1': question } }, createdAt: 'x' }];
    expect(agentInterruptPause(events)).toEqual({ seq: 7, interrupts: [question] });
    expect(agentInterruptPause([...events, { ...events[0]!, seq: 8, payload: { kind: 'AWAIT_USER', reason: 'CLARIFICATION', interrupts: {} } }])).toBeNull();
    expect(agentInterruptPause([{ ...events[0]!, payload: { ...events[0]!.payload, interrupts: { fake: question } } }])).toBeNull();
  });
  it('preserves schema field names and typed enum/integer values, rejecting incomplete or invalid answers', () => {
    expect(interruptInput(question).fields.map((field) => field.name)).toEqual(['country', 'amount']);
    expect(validateInterruptPayload(question, { country: '中国', amount: 2 })).toBe('');
    expect(validateInterruptPayload(question, { country: '中国' })).toContain('amount');
    expect(validateInterruptPayload(question, { country: '美国', amount: 2 })).toContain('选项');
    expect(validateInterruptPayload(question, { country: '中国', amount: 0 })).toContain('范围');
  });
  it('refuses nested, array and combinator schemas rather than inventing payloads', () => {
    for (const responseSchema of [{ type: 'array' }, { anyOf: [{ type: 'string' }] }, { type: 'object', properties: { nested: { type: 'object' } } }]) {
      expect(interruptInput({ ...question, responseSchema }).error).toContain('暂不支持');
    }
  });
  it('maps the original input only to a supported single string schema and never to tool decisions', () => {
    const input = { ...question, responseSchema: { type: 'object', properties: { scope: { type: 'string' } }, required: ['scope'] } };
    expect(interruptTextResponse({ seq: 7, interrupts: [input] }, '中国市场')).toEqual([{ interruptId: 'question-1', status: 'resolved', payload: { scope: '中国市场' } }]);
    expect(interruptTextResponse({ seq: 7, interrupts: [input, question] }, 'yes')).toBeNull();
    expect(interruptTextResponse({ seq: 7, interrupts: [{ id: 'tool-1', reason: 'tool_call' }] }, '允许')).toBeNull();
  });
  it('keeps explicit denial meaningful as a resolved boolean response', () => {
    expect(validateInterruptPayload({ id: 'tool-1', reason: 'tool_call' }, { approved: false })).toBe('');
    expect(validateInterruptPayload({ id: 'tool-1', reason: 'tool_call' }, {})).toContain('允许或拒绝');
  });
});
