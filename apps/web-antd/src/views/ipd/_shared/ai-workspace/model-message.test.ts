import { describe, expect, it } from 'vitest';

import { modelMessageParts } from './model-message';

describe('modelMessageParts', () => {
  it('保留普通回答', () => {
    expect(modelMessageParts('需求验证是确认实现满足需求。')).toEqual({
      answer: '需求验证是确认实现满足需求。',
      reasoning: '',
      reasoningOpen: false,
    });
  });

  it('将已结束的推理段与答案分开且保留原文', () => {
    expect(modelMessageParts('<think>先核对需求。\n再判断。</think>\n\n结论。')).toEqual({
      answer: '结论。',
      reasoning: '先核对需求。\n再判断。',
      reasoningOpen: false,
    });
  });

  it('流式未结束时不把推理正文当成回答', () => {
    expect(modelMessageParts('<think>还在分析')).toEqual({
      answer: '',
      reasoning: '还在分析',
      reasoningOpen: true,
    });
  });

  it('连续思考段全部离开回答，未闭合的后一段也不当正文', () => {
    const content = '<think>我来先检索资料。</think>\n<think>三个主题都未检索到';
    const parts = modelMessageParts(content);
    expect(parts.answer).toBe('');
    expect(parts.answer).not.toContain('<think>');
    expect(parts.reasoning).toContain('我来先检索资料。');
    expect(parts.reasoning).toContain('三个主题都未检索到');
    expect(parts.reasoningOpen).toBe(true);
  });
});
