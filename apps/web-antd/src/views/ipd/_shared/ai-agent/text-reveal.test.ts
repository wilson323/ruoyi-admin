import { describe, expect, it } from 'vitest';

import { nextRevealedMessage, nextRevealedText } from './text-reveal';

describe('nextRevealedText', () => {
  it('只揭示已收到文本的前缀，不补造后续字符', () => {
    expect(nextRevealedText('', '一二三四五六七八', 3)).toBe('一二三');
    expect(nextRevealedText('一二三', '一二三四五六七八', 3)).toBe('一二三四五六');
    expect(nextRevealedText('一二三四五六七八', '一二三四五六七八', 3)).toBe('一二三四五六七八');
    expect(nextRevealedText('别的开头', '一二三', 3)).toBe('一二三'.slice(0, 3));
  });
});

describe('nextRevealedMessage', () => {
  it('先揭示思考，思考未完时不把回答提前倒进可见区', () => {
    const full = { reasoning: '先核对范围', answer: '结论如下' };
    const first = nextRevealedMessage({ reasoning: '', answer: '' }, full, 4);
    expect(first).toEqual({ reasoning: '先核对范', answer: '' });
    const done = nextRevealedMessage({ reasoning: '先核对范围', answer: '结论' }, full, 8);
    expect(done.answer).toBe('结论如下');
  });
});
