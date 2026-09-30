import { describe, expect, it } from 'vitest';

import { shouldRetryIpdWebSocket } from '#/utils/ipd-ws-close';

describe('shouldRetryIpdWebSocket', () => {
  it('1007（会话被顶替或票无效）不再重连', () => {
    expect(shouldRetryIpdWebSocket(1007)).toBe(false);
  });

  it('1006（连接异常断开）仍重连', () => {
    expect(shouldRetryIpdWebSocket(1006)).toBe(true);
  });

  it('1000（正常关闭）仍交给调用方决定，谓词本身不拦截', () => {
    expect(shouldRetryIpdWebSocket(1000)).toBe(true);
  });
});
