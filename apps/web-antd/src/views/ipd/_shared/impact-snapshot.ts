/**
 * 需求变更影响快照四维校验（D10 修复，2026-10-06）。
 *
 * 后端契约（RequirementChangeService.create，P2-6.2 强化 / AC-REQ-08；哨兵
 * P261AcceptanceTest、P262DualSignStageGuardTest 钉扎）：beforeSnapshot / afterSnapshot
 * 必须为合法 JSON 对象且显式覆盖四维度，键为中文「范围/成本/时限/质量」，缺失 ⇒ 10001。
 * 本模块在前端提交前做同构预校验，避免用户填完整个表单后才收到后端 400。
 */

/** 四维键（与后端 P2-6.2 契约逐字一致，勿改为英文键）。 */
export const IMPACT_DIMENSIONS = ['范围', '成本', '时限', '质量'] as const;

export interface ImpactSnapshotCheck {
  ok: boolean;
  /** 具体原因（用于表单错误提示），ok 为 true 时为空串。 */
  error: string;
}

const EXAMPLE = '{"范围":"…","成本":0,"时限":"…","质量":"…"}';

export function validateImpactSnapshot(raw: null | string, label: string): ImpactSnapshotCheck {
  const text = (raw ?? '').trim();
  if (!text) {
    return { error: `${label}不能为空（创建时必填）`, ok: false };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${label}必须是 JSON 对象，如 ${EXAMPLE}`, ok: false };
    }
    const missing = IMPACT_DIMENSIONS.filter((key) => !Object.prototype.hasOwnProperty.call(parsed, key));
    if (missing.length > 0) {
      return { error: `${label}缺少维度：${missing.join('、')}（需覆盖范围/成本/时限/质量）`, ok: false };
    }
    return { error: '', ok: true };
  } catch {
    return { error: `${label}不是合法 JSON，请检查格式，如 ${EXAMPLE}`, ok: false };
  }
}
