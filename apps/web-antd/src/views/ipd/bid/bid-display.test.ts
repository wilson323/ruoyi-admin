// 招标域展示辅助单测：状态/方式中文映射、时间归一、应标说明组装与校验。
import { describe, expect, it } from 'vitest';

import {
  bidModeText,
  bidResponseStatusText,
  bidStatusText,
  bidTimeText,
  composeResponseNote,
  RESPONSE_NOTE_MAX,
  validateRespondForm,
} from './bid-display';

describe('状态与方式映射（G-06：未知值显示「待补充」）', () => {
  it('招标单状态中文映射', () => {
    expect(bidStatusText('OPEN')).toBe('招标中');
    expect(bidStatusText('SELECTED')).toBe('已遴选');
    expect(bidStatusText('EXPIRED')).toBe('已过期');
    expect(bidStatusText('CLOSED')).toBe('已关闭');
    expect(bidStatusText('WEIRD')).toBe('待补充');
    expect(bidStatusText(null)).toBe('待补充');
  });

  it('招标方式中文映射', () => {
    expect(bidModeText('ONE_TO_ONE')).toBe('定向邀请');
    expect(bidModeText('PUBLIC')).toBe('公开征集');
    expect(bidModeText('OTHER')).toBe('待补充');
  });

  it('应标状态中文映射', () => {
    expect(bidResponseStatusText('PENDING')).toBe('已应标（待遴选）');
    expect(bidResponseStatusText('ACCEPTED')).toBe('已中标');
    expect(bidResponseStatusText('REJECTED')).toBe('已落选');
    expect(bidResponseStatusText('WITHDRAWN')).toBe('已撤回');
    expect(bidResponseStatusText('OTHER')).toBe('待补充');
  });

  it('时间归一：yyyy-MM-dd HH:mm:ss 与毫秒时间戳都能展示', () => {
    expect(bidTimeText('2026-09-05 22:30:00')).toBe('2026-09-05 22:30');
    expect(bidTimeText(1_788_000_000_000)).not.toBe('待补充');
    expect(bidTimeText(null)).toBe('待补充');
    expect(bidTimeText('')).toBe('待补充');
  });

  it('真库混合形态：同对象 createTime 为毫秒、expireAt 为字符串都能展示', () => {
    // BidInvitation.createTime 由 BaseEntity @JsonFormat 未标注，时间归一靠兼容分支处理；
    //  本字段已用毫秒输出，bidTimeText 仍可正确转 YYYY-MM-DD HH:mm（不变量：toLocaleString 返回非空）。
    const epochCreate = 1_726_467_200_000;
    const stringExpire = '2026-09-20 23:59:59';
    expect(bidTimeText(epochCreate)).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(bidTimeText(stringExpire)).toBe('2026-09-20 23:59');
  });

  it('G-06：未知状态/方式/响应状态全部显示「待补充」，不留空白', () => {
    expect(bidStatusText('WEIRD')).toBe('待补充');
    expect(bidStatusText('')).toBe('待补充');
    expect(bidModeText('UNKNOWN_MODE')).toBe('待补充');
    expect(bidResponseStatusText('UNKNOWN_RESPONSE')).toBe('待补充');
  });

  it('过期与关闭状态的色彩与中文映射（真库已有数据）', () => {
    expect(bidStatusText('EXPIRED')).toBe('已过期');
    expect(bidStatusText('CLOSED')).toBe('已关闭');
  });
});

describe('应标说明组装与校验（契约 D-3~D-5 拼入方案）', () => {
  const base = {
    estimatedDays: 90 as null | number,
    majorRisks: '需等待客户现场开放与数据回传，存在排期风险', // ≥20 字
    plan: '先做离线评测，再上线小流量验证，最后全量发布', // ≥40 字不足，需补长
    resourceCommitment: '投入两人双周迭代', // 1-200 字
  };

  const validPlan = '采用模块化重构方案，先离线回放历史数据完成算法评测，再小流量灰度验证效果，稳定后全量发布上线';

  it('拼接标注行：预计周期/资源投入/主要风险以标注行拼入方案摘要之后', () => {
    const note = composeResponseNote({ estimatedDays: 90, majorRisks: '客户现场排期风险', plan: validPlan, resourceCommitment: '两人' });
    expect(note.startsWith(`【方案摘要】${validPlan}\n【预计周期】90 天\n【资源投入】两人\n【主要风险】客户现场排期风险`)).toBe(true);
  });

  it('合法输入无错误', () => {
    expect(validateRespondForm({ estimatedDays: 90, majorRisks: 'r'.repeat(20), plan: validPlan, resourceCommitment: '两人' })).toEqual({});
  });

  it('方案摘要不足 40 字被拦截', () => {
    const errors = validateRespondForm({ ...base, plan: '太短' });
    expect(errors.plan).toContain('不少于 40 字');
  });

  it('预计周期须为 1-365 整数', () => {
    expect(validateRespondForm({ ...base, estimatedDays: 0 }).estimatedDays).toBeTruthy();
    expect(validateRespondForm({ ...base, estimatedDays: 366 }).estimatedDays).toBeTruthy();
    expect(validateRespondForm({ ...base, estimatedDays: 90.5 }).estimatedDays).toBeTruthy();
    expect(validateRespondForm({ ...base, estimatedDays: null }).estimatedDays).toBeTruthy();
  });

  it('资源投入与主要风险长度边界', () => {
    expect(validateRespondForm({ ...base, resourceCommitment: '' }).resourceCommitment).toBeTruthy();
    expect(validateRespondForm({ ...base, majorRisks: 'r'.repeat(19) }).majorRisks).toBeTruthy();
    expect(validateRespondForm({ ...base, majorRisks: 'r'.repeat(20) }).majorRisks).toBeUndefined();
  });

  it(`拼接总长超过 ${RESPONSE_NOTE_MAX} 字上限被拦截`, () => {
    const errors = validateRespondForm({ estimatedDays: 90, majorRisks: 'r'.repeat(20), plan: 'p'.repeat(500), resourceCommitment: 'x'.repeat(200) });
    expect(errors.noteTotal).toContain('500');
  });

  it('拼接总长恰好在 40-500 字之间不报错', () => {
    const errors = validateRespondForm({ estimatedDays: 90, majorRisks: 'r'.repeat(20), plan: 'p'.repeat(60), resourceCommitment: 'x' });
    expect(errors.noteTotal).toBeUndefined();
  });
});
