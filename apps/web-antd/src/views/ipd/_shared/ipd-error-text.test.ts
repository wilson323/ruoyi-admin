// IPD 业务错误码 → 中文文案 单测：单一权威源 IPD_COMMON_CODE_TEXTS / 域默认表 / fallback / 工厂。
import { describe, expect, it } from 'vitest';

import { IpdRequestError } from '../../../api/ipd/auth';

import {
  IPD_COMMON_CODE_TEXTS,
  ipdErrorText,
  isTransportError,
  withCodeTextOverrides,
} from './ipd-error-text';

const httpErr = (code: number, message = 'x') =>
  new IpdRequestError(message, 400, code, 'http');

describe('IPD_COMMON_CODE_TEXTS 通用码文案（前端单一权威源）', () => {
  it('通用码 10001/20001/20002/30001 文案精确匹配', () => {
    expect(IPD_COMMON_CODE_TEXTS[10001]).toBe('输入信息不符合要求，请检查后重试');
    expect(IPD_COMMON_CODE_TEXTS[20001]).toBe('登录已失效，请重新登录');
    expect(IPD_COMMON_CODE_TEXTS[20002]).toBe('账号已冻结，仅保留移交相关权限');
    expect(IPD_COMMON_CODE_TEXTS[30001]).toBe('您没有执行此操作的权限');
  });

  it('40001-40005 门禁/双签/超项/角色/删除审核文案精确匹配', () => {
    expect(IPD_COMMON_CODE_TEXTS[40001]).toBe('阶段门禁未通过，请完成阻断性动作后重试');
    expect(IPD_COMMON_CODE_TEXTS[40002]).toBe('关联条件已变更，请确认新条件后重试');
    expect(IPD_COMMON_CODE_TEXTS[40003]).toBe('超项未备案，请先完成超项备案');
    expect(IPD_COMMON_CODE_TEXTS[40004]).toBe('市场PM 与研发PM 不能由同一人担任，请重新选择');
    expect(IPD_COMMON_CODE_TEXTS[40005]).toBe('项目禁止直接删除，请发起删除申请并完成两级审核');
  });

  it('40011/50001/50002/90001 文案精确匹配', () => {
    expect(IPD_COMMON_CODE_TEXTS[40011]).toBe('请求过于频繁，请稍后再试');
    expect(IPD_COMMON_CODE_TEXTS[50001]).toBe('数据不存在或已被删除，请刷新后重试');
    expect(IPD_COMMON_CODE_TEXTS[50002]).toBe('状态已变更（可能其他人已编辑），请刷新后查看');
    expect(IPD_COMMON_CODE_TEXTS[90001]).toBe('数据不存在或服务暂时不可用，请稍后重试');
  });
});

describe('ipdErrorText http 错误码查询', () => {
  it('http + 已知码返回 IPD_COMMON_CODE_TEXTS 文案', () => {
    expect(ipdErrorText(httpErr(10001))).toBe('输入信息不符合要求，请检查后重试');
    expect(ipdErrorText(httpErr(20001))).toBe('登录已失效，请重新登录');
    expect(ipdErrorText(httpErr(30001))).toBe('您没有执行此操作的权限');
    expect(ipdErrorText(httpErr(90001))).toBe('数据不存在或服务暂时不可用，请稍后重试');
  });

  it('http + 未知码回退 fallback 或通用兜底「操作失败，请稍后重试」', () => {
    expect(ipdErrorText(httpErr(99999))).toBe('操作失败，请稍后重试');
    expect(ipdErrorText(httpErr(99999), { fallback: '页内失败' })).toBe('页内失败');
  });

  it('http + code=0 不在通用表，回退 fallback 或通用兜底', () => {
    expect(ipdErrorText(httpErr(0))).toBe('操作失败，请稍后重试');
    expect(ipdErrorText(httpErr(0), { fallback: '兜底' })).toBe('兜底');
  });
});

describe('ipdErrorText 错误类型分派', () => {
  it('transport 类错误返回「无法连接服务」文案', () => {
    const err = new IpdRequestError('其他', 0, 0, 'transport');
    expect(ipdErrorText(err)).toBe('无法连接服务，请检查网络后重试');
  });

  it('timeout 类错误返回「请求超时」文案（2026-09-08：超时不再误报断网）', () => {
    const err = new IpdRequestError('其他', 0, 0, 'timeout');
    expect(ipdErrorText(err)).toBe('请求超时，请稍后重试');
  });

  it('cancelled 类错误返回「登录状态已变化」文案', () => {
    const err = new IpdRequestError('其他', 0, 0, 'cancelled');
    expect(ipdErrorText(err)).toBe('登录状态已变化，请重新操作');
  });

  it('protocol 类错误透传 error.message（形状校验类不降级到通用 fallback）', () => {
    const err = new IpdRequestError('协议格式异常');
    expect(ipdErrorText(err)).toBe('协议格式异常');
  });

  it('非 IpdRequestError（任意 unknown）一律回退 fallback 或默认兜底', () => {
    expect(ipdErrorText(null)).toBe('操作失败，请稍后重试');
    expect(ipdErrorText(undefined)).toBe('操作失败，请稍后重试');
    expect(ipdErrorText(new Error('普通错误'))).toBe('操作失败，请稍后重试');
    expect(ipdErrorText('字符串错误', { fallback: '我的兜底' })).toBe('我的兜底');
    expect(ipdErrorText(null, { fallback: '我的兜底' })).toBe('我的兜底');
  });

  it('null / undefined / 数字 / 对象 / 数组 全部不抛错', () => {
    expect(() => ipdErrorText(null)).not.toThrow();
    expect(() => ipdErrorText(undefined)).not.toThrow();
    expect(() => ipdErrorText(0)).not.toThrow();
    expect(() => ipdErrorText({})).not.toThrow();
    expect(() => ipdErrorText([])).not.toThrow();
  });
});

describe('IPD_DOMAIN_DEFAULTS 域默认覆写', () => {
  it('bid 域 30001 / 40002 / 50002 用 bid 默认文案', () => {
    expect(ipdErrorText(httpErr(30001), { domain: 'bid' })).toBe('您没有执行此操作的权限');
    expect(ipdErrorText(httpErr(40002), { domain: 'bid' })).toBe('招募条件已变更，请确认新条件后重试');
    expect(ipdErrorText(httpErr(50002), { domain: 'bid' })).toBe(
      '状态已变更（可能已遴选、已关闭或已过期），请刷新后查看',
    );
  });

  it('project 域 30001 / 40001 / 40002 用 project 默认文案', () => {
    expect(ipdErrorText(httpErr(30001), { domain: 'project' })).toBe('您没有此项目的操作权限');
    expect(ipdErrorText(httpErr(40001), { domain: 'project' })).toBe('阶段门禁未通过，请先完成前置动作或等待双签完成');
    expect(ipdErrorText(httpErr(40002), { domain: 'project' })).toBe('双签未完成，请等待对方签署后再提交');
  });

  it('portal 域 40401 / 40010 / 40012 / 40013 用 portal 默认文案', () => {
    expect(ipdErrorText(httpErr(40401), { domain: 'portal' })).toBe('该产品已下架，请改选其他产品或「其他/未找到」');
    expect(ipdErrorText(httpErr(40010), { domain: 'portal' })).toBe('查询码格式不正确，请核对后重新输入');
    expect(ipdErrorText(httpErr(40012), { domain: 'portal' })).toBe('附件数量或大小超出限制');
    expect(ipdErrorText(httpErr(40013), { domain: 'portal' })).toBe('AI 预算超出限制');
  });

  it('ai_document 域 20003 / 40004 / 50002 / 404 用专属文案', () => {
    expect(ipdErrorText(httpErr(20003), { domain: 'ai_document' })).toBe('首次登录需先修改密码后再执行此操作');
    expect(ipdErrorText(httpErr(40004), { domain: 'ai_document' })).toBe('角色固定不可跨，当前账号不能执行此操作');
    expect(ipdErrorText(httpErr(50002), { domain: 'ai_document' })).toBe('状态冲突：该记录已被其他成员处理，请刷新后重试');
    expect(ipdErrorText(httpErr(404), { domain: 'ai_document' })).toBe('请求的接口不存在或资源已删除，请确认后重试');
  });

  it('域默认仅覆盖该域声明的码，其他码走通用表', () => {
    expect(ipdErrorText(httpErr(20002), { domain: 'portal' })).toBe(IPD_COMMON_CODE_TEXTS[20002]);
    expect(ipdErrorText(httpErr(90001), { domain: 'bid' })).toBe(IPD_COMMON_CODE_TEXTS[90001]);
  });
});

describe('页面级 codeTexts 优先级高于域默认与通用表', () => {
  it('codeTexts 覆盖 IPD_COMMON_CODE_TEXTS', () => {
    expect(ipdErrorText(httpErr(30001), { codeTexts: { 30001: '页面专属文案' } })).toBe('页面专属文案');
  });

  it('codeTexts 覆盖域默认', () => {
    expect(
      ipdErrorText(httpErr(30001), {
        domain: 'project',
        codeTexts: { 30001: '页面专属' },
      }),
    ).toBe('页面专属');
  });

  it('codeTexts 未匹配的码仍走域默认 / 通用表', () => {
    expect(
      ipdErrorText(httpErr(30001), {
        domain: 'project',
        codeTexts: { 99999: '不相关' },
      }),
    ).toBe('您没有此项目的操作权限');
    expect(
      ipdErrorText(httpErr(30001), { codeTexts: { 99999: '不相关' } }),
    ).toBe(IPD_COMMON_CODE_TEXTS[30001]);
  });
});

describe('withCodeTextOverrides 工厂', () => {
  it('绑定 codeTexts 后调用不再传 codeTexts 也生效', () => {
    const fn = withCodeTextOverrides({ 30001: '绑定的文案' });
    expect(fn(httpErr(30001))).toBe('绑定的文案');
  });

  it('opts.codeTexts 可继续覆盖绑定的 codeTexts', () => {
    const fn = withCodeTextOverrides({ 30001: '绑定' });
    expect(fn(httpErr(30001), { codeTexts: { 30001: '调用时覆盖' } })).toBe('调用时覆盖');
  });

  it('opts 可追加 fallback / domain', () => {
    const fn = withCodeTextOverrides({ 30001: '绑定' });
    expect(fn(httpErr(99999), { fallback: '调用时 fallback' })).toBe('调用时 fallback');
    expect(
      fn(new IpdRequestError('x', 400, 40002, 'http'), {
        domain: 'project',
      }),
    ).toBe('双签未完成，请等待对方签署后再提交');
  });
});

describe('isTransportError 网络异常识别', () => {
  it('transport 类返回 true', () => {
    expect(isTransportError(new IpdRequestError('x', 0, 0, 'transport'))).toBe(true);
  });

  it('http / protocol / timeout / cancelled 返回 false', () => {
    expect(isTransportError(new IpdRequestError('x', 400, 10001, 'http'))).toBe(false);
    expect(isTransportError(new IpdRequestError('x'))).toBe(false);
    expect(isTransportError(new IpdRequestError('x', 0, 0, 'timeout'))).toBe(false);
    expect(isTransportError(new IpdRequestError('x', 0, 0, 'cancelled'))).toBe(false);
  });

  it('非 IpdRequestError 返回 false', () => {
    expect(isTransportError(null)).toBe(false);
    expect(isTransportError(undefined)).toBe(false);
    expect(isTransportError(new Error('普通'))).toBe(false);
    expect(isTransportError({ kind: 'transport' })).toBe(false);
  });
});

describe('CJK 字符守门（防止 ASCII 漂移）', () => {
  it('IPD_COMMON_CODE_TEXTS 所有非空值都至少含一个 CJK 字符', () => {
    const cjk = /[一-鿿]/;
    for (const [code, text] of Object.entries(IPD_COMMON_CODE_TEXTS)) {
      expect(text, `通用码 ${code} 文案非空`).not.toBe('');
      expect(text, `通用码 ${code} 文案需含 CJK`).toMatch(cjk);
    }
  });

  it('ipdErrorText 通用兜底文案含 CJK', () => {
    expect(ipdErrorText(httpErr(99999))).toMatch(/[一-鿿]/);
    expect(ipdErrorText(null)).toMatch(/[一-鿿]/);
  });
});

describe('与 auth.ts 的一致性 / 矛盾点（仅观察不修）', () => {
  it('10001 在通用表与 auth.ts BUSINESS_CODE_MESSAGES 文本一致', () => {
    expect(IPD_COMMON_CODE_TEXTS[10001]).toBe('输入信息不符合要求，请检查后重试');
  });

  it('矛盾-1：auth.ts IPD_LOGIN_CREDENTIAL_ERROR「用户名或密码错误」经本函数对 10001/40001 不可达', () => {
    // 登录坏凭据的特殊文案（'用户名或密码错误'）由 requestIpd 在 status=401 + path=/auth/login + code=10001 时
    // 直接改写 error.message 为 IPD_LOGIN_CREDENTIAL_TEXT 后 throw；ipdErrorText 走 http 分支查表，
    // 因此对 code=10001 一律返回通用表文案，不会返回登录凭据文案。两者职能不重叠——登录页读 error.message，
    // 其它页面经本函数——但若有人误以为 ipdErrorText(err).includes('用户名或密码错误') 是登录识别信号则会失配。
    expect(ipdErrorText(httpErr(10001))).not.toBe('用户名或密码错误');
    expect(ipdErrorText(httpErr(40001))).not.toBe('用户名或密码错误');
  });

  it('矛盾-2：通用表 vs auth.ts BUSINESS_CODE_MESSAGES 文本差异（仅观察不修）', () => {
    // 20002 / 30001 / 40001 / 40002 / 40003 / 40004 / 40005 / 50001 / 50002 / 90001
    expect(IPD_COMMON_CODE_TEXTS[30001]).not.toBe('权限不足，请联系管理员');
    expect(IPD_COMMON_CODE_TEXTS[90001]).not.toBe('系统内部错误，请稍后重试');
    expect(IPD_COMMON_CODE_TEXTS[50002]).not.toBe('当前状态不支持此操作');
    expect(IPD_COMMON_CODE_TEXTS[20002]).not.toBe('账号待移交冻结中，仅保留移交相关权限');
  });

  it('矛盾-3：通用表缺少 auth.ts 中已声明的若干码（由域默认或页面级 codeTexts 覆盖）', () => {
    // auth.ts BUSINESS_CODE_MESSAGES 声明：10001,20001,20002,20003,30001,40001-40006,40010-40013,40401,50001,50002,90001
    // ipd-error-text.ts 通用表仅声明：10001,20001,20002,30001,40001-40005,40011,50001,50002,90001
    // 未在通用表：20003 / 40006 / 40010 / 40012 / 40013 / 40401
    expect(IPD_COMMON_CODE_TEXTS[20003]).toBeUndefined();
    expect(IPD_COMMON_CODE_TEXTS[40006]).toBeUndefined();
    expect(IPD_COMMON_CODE_TEXTS[40010]).toBeUndefined();
    expect(IPD_COMMON_CODE_TEXTS[40012]).toBeUndefined();
    expect(IPD_COMMON_CODE_TEXTS[40013]).toBeUndefined();
    expect(IPD_COMMON_CODE_TEXTS[40401]).toBeUndefined();
  });
});
