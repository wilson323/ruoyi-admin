import { describe, expect, it } from 'vitest';
import { agentInterruptPause, interruptInput, interruptTextResponse, validateInterruptPayload } from './agui-interrupt';
const question = { id: 'question-1', reason: 'input_required', responseSchema: { type: 'object', properties: { country: { type: 'string', enum: ['中国', '日本'], title: '国家' }, amount: { type: 'integer', minimum: 1 } }, required: ['country', 'amount'] } };
describe('durable AG-UI interrupt model', () => {
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
