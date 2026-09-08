/**
 * IPD 业务错误码 → 中文文案 集中表（前端单一权威源）。
 *
 * <p>起源：2026-09-06 反思-前端代码漂移根因分析，发现 bid-error.ts / project-error.ts /
 * ai-document.ts / portal.ts 4 份分散的 code→text 映射。
 *
 * <p>根因（5 层）& 修法：
 * <ol>
 *   <li>缺架构师角色 → 本文件即"前端 IPD 共享层"的中心</li>
 *   <li>仓物理隔离 → 后端 ApiV1ErrorCode 数字码与本表弱类型联动，必须人工同步</li>
 *   <li>内部复用铁律缺失 → 写"新增错误码只能加本表"，hook + 自检脚本守护</li>
 *   <li>质量门不含一致性 → 治理轮 / CI 必须跑 scripts/check-ipd-frontend-drift.sh</li>
 *   <li>谁后写谁占主导 → 后写者必须先 grep 本表，命中则改本表，不另起新文件</li>
 * </ol>
 *
 * <p>使用方式（页面级）：
 * <pre>
 * import { ipdErrorText, withCodeTextOverrides } from '../_shared/ipd-error-text';
 *
 * // 通用：
 * ipdErrorText(error, { fallback: '招标失败' });
 *
 * // 页面级覆写：同一码在应标页与遴选页含义不同
 * withCodeTextOverrides({ 30001: '该招标已截止' })(error, { fallback: '操作失败' });
 * </pre>
 *
 * <p>新增错误码流程：
 * <ol>
 *   <li>后端 ApiV1ErrorCode 加新码 → 同步本表加 key + 文案</li>
 *   <li>页面级覆写：调用 withCodeTextOverrides({code: '页面专属文案'})</li>
 *   <li>严禁：在 views/ipd/<domain>/<domain>-error.ts 或 api/ipd/*.ts 内自建新表</li>
 * </ol>
 */
import { IpdRequestError } from '../../../api/ipd/auth';

/** 错误码 → 默认中文文案（跨域通用）。 */
export const IPD_COMMON_CODE_TEXTS: Record<number, string> = {
  10001: '输入信息不符合要求，请检查后重试',
  20001: '登录已失效，请重新登录',
  20002: '账号已冻结，仅保留移交相关权限',
  30001: '您没有执行此操作的权限',
  40001: '阶段门禁未通过，请完成阻断性动作后重试',
  40002: '关联条件已变更，请确认新条件后重试',
  40003: '超项未备案，请先完成超项备案',
  40004: '市场PM 与研发PM 不能由同一人担任，请重新选择',
  40005: '项目禁止直接删除，请发起删除申请并完成两级审核',
  40011: '请求过于频繁，请稍后再试',
  50001: '数据不存在或已被删除，请刷新后重试',
  50002: '状态已变更（可能其他人已编辑），请刷新后查看',
  /** 真库探针发现：无效 ID 与 NPE 一并落到 90001（HTTP 500），统一兜底文案 */
  90001: '数据不存在或服务暂时不可用，请稍后重试',
};

/** 域专属默认覆写（未在页面级 withCodeTextOverrides 覆盖时使用）。 */
const IPD_DOMAIN_DEFAULTS: Record<string, Record<number, string>> = {
  bid: {
    30001: '您没有执行此操作的权限',
    40002: '招募条件已变更，请确认新条件后重试',
    /** bid 域 50002 语义专属：招募/遴选/关闭/过期是 bid 生命周期术语 */
    50002: '状态已变更（可能已遴选、已关闭或已过期），请刷新后查看',
  },
  project: {
    30001: '您没有此项目的操作权限',
    40001: '阶段门禁未通过，请先完成前置动作或等待双签完成',
    40002: '双签未完成，请等待对方签署后再提交',
  },
  portal: {
    30001: '操作超出当前游客允许范围',
    20001: '登录状态已失效，请刷新页面后重试',
    40010: '查询码格式不正确，请核对后重新输入',
    40011: '请求过于频繁，请稍后再试',
    40012: '附件数量或大小超出限制',
    40013: 'AI 预算超出限制',
    40401: '该产品已下架，请改选其他产品或「其他/未找到」',
    50001: '未查询到对应的需求，请核对查询码',
    50002: '当前状态不支持该操作，请稍后重试',
  },
  ai_document: {
    /** 与通用表不同语义：账号级别被冻结而非单点权限 */
    30001: '账号当前不可执行此操作，请联系管理员',
    20003: '首次登录需先修改密码后再执行此操作',
    40003: '当前存在超项未备案，暂不可执行此操作',
    40004: '角色固定不可跨，当前账号不能执行此操作',
    40012: '附件数量或大小超出限制',
    40013: 'AI 预算超出限制，请联系管理员调整配额',
    /** 通用表 50002 文案是"状态已变更"，AI 文档域更侧重"版本冲突"语义 */
    50002: '状态冲突：该记录已被其他成员处理，请刷新后重试',
    /** HTTP 404：未匹配路由或资源已删除（与业务 40401 区分） */
    404: '请求的接口不存在或资源已删除，请确认后重试',
  },
};

export interface IpdErrorOptions {
  /** 未知错误时的兜底文案 */
  fallback?: string;
  /** 按 code 覆盖的页面级文案（最高优先级） */
  codeTexts?: Record<number, string>;
  /** 域名前缀：用于查找 IPD_DOMAIN_DEFAULTS */
  domain?: 'ai_document' | 'bid' | 'portal' | 'project';
}

/** 主入口：错误对象 → 中文文案。 */
export function ipdErrorText(error: unknown, options: IpdErrorOptions = {}): string {
  if (error instanceof IpdRequestError) {
    if (error.kind === 'transport') return '无法连接服务，请检查网络后重试';
    // 2026-09-08：15s 超时中止单独归类——后端可能已在处理，与真断网分开报，避免误导用户排查网络。
    if (error.kind === 'timeout') return '请求超时，请稍后重试';
    if (error.kind === 'cancelled') return '登录状态已变化，请重新操作';
    // 2026-09-06 第六批判例补：形状校验类（protocol）错误自带专属用户文案，不得降级为通用 fallback
    if (error.kind === 'protocol') return error.message;
    if (error.kind === 'http') {
      const pageText = options.codeTexts?.[error.code];
      if (pageText) return pageText;
      const domainText = options.domain ? IPD_DOMAIN_DEFAULTS[options.domain]?.[error.code] : undefined;
      if (domainText) return domainText;
      const commonText = IPD_COMMON_CODE_TEXTS[error.code];
      if (commonText) return commonText;
    }
  }
  return options.fallback ?? '操作失败，请稍后重试';
}

/** 工厂：返回绑定 codeTexts 的 ipdErrorText 变体（页面级覆写）。
 *
 *  opts 可继续追加 codeTexts（最高优先级覆盖绑定值），同时可覆盖 domain/fallback。
 *  类型用交叉而非 Omit，是因为 Omit<IpdErrorOptions,'codeTexts'> 不含 codeTexts 字段
 *  会导致 opts.codeTexts 读取报 TS2339。
 */
export function withCodeTextOverrides(
  codeTexts: Record<number, string>,
  options: Partial<Omit<IpdErrorOptions, 'codeTexts'>> = {},
): (error: unknown, opts?: Partial<IpdErrorOptions>) => string {
  return (error, opts) =>
    ipdErrorText(error, {
      ...options,
      ...(opts || {}),
      codeTexts: { ...codeTexts, ...(opts?.codeTexts || {}) },
    });
}

/** 是否为断网/传输层异常（用于页面区分"网络异常"与"业务拒绝"两种失败形态）。
 *  注意：超时中止（kind='timeout'）不算断网——它有自己的文案与语义，页面重试提示应区分。 */
export function isTransportError(error: unknown): boolean {
  return error instanceof IpdRequestError && error.kind === 'transport';
}
