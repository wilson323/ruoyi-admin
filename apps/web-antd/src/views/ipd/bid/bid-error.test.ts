// 招标域错误码 → 中文文案映射单测（ApiV1ErrorCode.java 真值）。
import { describe, expect, it } from 'vitest';

import { IpdRequestError } from '../../../api/ipd/auth';
import { bidErrorText, isTransportError } from './bid-error';

const httpError = (code: number, status: number) => new IpdRequestError('服务响应', status, code, 'http');

describe('bidErrorText', () => {
  it('断网（transport）优先提示网络问题', () => {
    expect(bidErrorText(new IpdRequestError('x', 0, 0, 'transport'))).toBe('无法连接服务，请检查网络后重试');
  });

  it('会话切换（cancelled）提示重新操作', () => {
    expect(bidErrorText(new IpdRequestError('x', 0, 0, 'cancelled'))).toBe('登录状态已变化，请重新操作');
  });

  it('按登记错误码映射中文文案', () => {
    expect(bidErrorText(httpError(10001, 400))).toBe('输入信息不符合要求，请检查后重试');
    expect(bidErrorText(httpError(30001, 403))).toBe('您没有执行此操作的权限');
    expect(bidErrorText(httpError(50001, 404))).toBe('数据不存在或已被删除，请刷新后重试');
    expect(bidErrorText(httpError(50002, 409))).toBe('状态已变更（可能已遴选、已关闭或已过期），请刷新后查看');
    expect(bidErrorText(httpError(40002, 409))).toBe('招募条件已变更，请确认新条件后重试');
  });

  it('真库 90001（无效 ID 或 NPE 兜底）映射为统一中文文案', () => {
    expect(bidErrorText(httpError(90001, 500))).toBe('数据不存在或服务暂时不可用，请稍后重试');
  });

  it('页面级 codeTexts 覆盖通用文案（应标页/遴选页 30001 语义不同）', () => {
    const text = bidErrorText(httpError(30001, 403), { codeTexts: { 30001: '仅招标发起人可执行遴选' } });
    expect(text).toBe('仅招标发起人可执行遴选');
  });

  it('未知错误码与未知异常回退到兜底文案（不透出服务端内部信息）', () => {
    expect(bidErrorText(httpError(99999, 500), { fallback: '加载失败' })).toBe('加载失败');
    expect(bidErrorText(new Error('数据库堆栈'), { fallback: '操作失败' })).toBe('操作失败');
    expect(bidErrorText(undefined)).toBe('操作失败，请稍后重试');
  });
});

describe('isTransportError', () => {
  it('区分断网与业务拒绝', () => {
    expect(isTransportError(new IpdRequestError('x', 0, 0, 'transport'))).toBe(true);
    expect(isTransportError(httpError(50002, 409))).toBe(false);
    expect(isTransportError(new Error('x'))).toBe(false);
  });
});
