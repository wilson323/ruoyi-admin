// ZK-IPD 业务规则显示文案单测：与 Prompt §一~§十一 强一致。
import { describe, expect, it } from 'vitest';

import {
  RULES_BY_PAGE,
  ZK_RULE_ALLOWANCE_CAP,
  ZK_RULE_ARCHIVED_READONLY,
  ZK_RULE_AUDIT_EXPORTABLE,
  ZK_RULE_BID_ADMIN_ASSIGN_30D,
  ZK_RULE_BID_CONDITIONS_CHANGE_NOTIFY,
  ZK_RULE_BID_EXPIRED_NOTIFY,
  ZK_RULE_BID_REJECT_NO_TRACE,
  ZK_RULE_BONUS_DISTRIBUTION,
  ZK_RULE_BONUS_POOL_FORMULA,
  ZK_RULE_DEMAND_POOL_DUAL_REVIEW,
  ZK_RULE_HANDOVER_KEEP_HISTORY,
  ZK_RULE_LONG_NO_OUTPUT_ALERT,
  ZK_RULE_SCORE_BELOW_60_STOP,
  ZK_RULE_SUPER_ADMIN_TRANSFER,
  renderRulesDescription,
} from './zk-ipd-rules';

describe('ZK-IPD 业务规则显示文案与 Prompt 强一致', () => {
  it('§二.10 归档只读：规则文案含「归档」「只读」', () => {
    expect(ZK_RULE_ARCHIVED_READONLY.rule).toContain('归档');
    expect(ZK_RULE_ARCHIVED_READONLY.rule).toContain('只读');
    expect(ZK_RULE_ARCHIVED_READONLY.chapter).toBe('§二.10');
  });

  it('§三.2.1 奖金池公式：实际回款 + 5% + S/A/B 系数三要素齐全', () => {
    expect(ZK_RULE_BONUS_POOL_FORMULA.rule).toContain('实际回款');
    expect(ZK_RULE_BONUS_POOL_FORMULA.rule).toContain('5%');
    expect(ZK_RULE_BONUS_POOL_FORMULA.rule).toContain('S/A/B');
    expect(ZK_RULE_BONUS_POOL_FORMULA.chapter).toBe('§三.2.1');
  });

  it('§三.2.4 奖金分配比例：市场 40-65% / 研发 35-60% 区间完整', () => {
    expect(ZK_RULE_BONUS_DISTRIBUTION.rule).toContain('40%');
    expect(ZK_RULE_BONUS_DISTRIBUTION.rule).toContain('65%');
    expect(ZK_RULE_BONUS_DISTRIBUTION.rule).toContain('35%');
    expect(ZK_RULE_BONUS_DISTRIBUTION.rule).toContain('60%');
    expect(ZK_RULE_BONUS_DISTRIBUTION.chapter).toBe('§三.2.4');
  });

  it('§三.1.2 津贴 2 倍封顶：L1~L5 等级 + 2 倍两要素', () => {
    expect(ZK_RULE_ALLOWANCE_CAP.rule).toContain('2 倍');
    expect(ZK_RULE_ALLOWANCE_CAP.rule).toContain('L1');
    expect(ZK_RULE_ALLOWANCE_CAP.rule).toContain('L5');
  });

  it('§三.1.4 长期无产出提醒：「仅提醒不自动停发」关键约束保留', () => {
    expect(ZK_RULE_LONG_NO_OUTPUT_ALERT.rule).toContain('仅提醒不自动停发');
    expect(ZK_RULE_LONG_NO_OUTPUT_ALERT.rule).toContain('2 个月');
  });

  it('§三.1.5 月度考核 < 60 停发：阈值 60 明确', () => {
    expect(ZK_RULE_SCORE_BELOW_60_STOP.rule).toContain('60 分');
  });

  it('§四.1.3 招标到期提醒市场 PM', () => {
    expect(ZK_RULE_BID_EXPIRED_NOTIFY.rule).toContain('市场 PM');
    expect(ZK_RULE_BID_EXPIRED_NOTIFY.rule).toContain('已过期');
  });

  it('§四.1.4 拒绝不留痕：关键约束三件套（不记录/不通知/不审计）', () => {
    expect(ZK_RULE_BID_REJECT_NO_TRACE.rule).toContain('不记录');
    expect(ZK_RULE_BID_REJECT_NO_TRACE.rule).toContain('不通知');
    expect(ZK_RULE_BID_REJECT_NO_TRACE.rule).toContain('不写审计');
  });

  it('§四.1.5 招标条件变更：通知 PENDING 应标者', () => {
    expect(ZK_RULE_BID_CONDITIONS_CHANGE_NOTIFY.rule).toContain('PENDING');
  });

  it('§四.1.6 30 日挂起超管指派', () => {
    expect(ZK_RULE_BID_ADMIN_ASSIGN_30D.rule).toContain('30 日');
    expect(ZK_RULE_BID_ADMIN_ASSIGN_30D.rule).toContain('超管');
  });

  it('§九 超管权限移交：原超管作废 + 新人提升', () => {
    expect(ZK_RULE_SUPER_ADMIN_TRANSFER.rule).toContain('原超管');
    expect(ZK_RULE_SUPER_ADMIN_TRANSFER.rule).toContain('作废失效');
    expect(ZK_RULE_SUPER_ADMIN_TRANSFER.rule).toContain('SUPER_ADMIN');
  });

  it('§六.2 项目移交保留历史', () => {
    expect(ZK_RULE_HANDOVER_KEEP_HISTORY.rule).toContain('完整保留');
    expect(ZK_RULE_HANDOVER_KEEP_HISTORY.rule).toContain('奖金台账');
  });

  it('§十.2 审计日志所有角色可导出', () => {
    expect(ZK_RULE_AUDIT_EXPORTABLE.rule).toContain('所有角色均可导出');
    expect(ZK_RULE_AUDIT_EXPORTABLE.rule).toContain('不可篡改');
  });

  it('§五.5 需求池双审', () => {
    expect(ZK_RULE_DEMAND_POOL_DUAL_REVIEW.rule).toContain('双审');
    expect(ZK_RULE_DEMAND_POOL_DUAL_REVIEW.rule).toContain('产品组长');
    expect(ZK_RULE_DEMAND_POOL_DUAL_REVIEW.rule).toContain('超级管理员');
  });
});

describe('ZK-IPD 业务规则按页面归类', () => {
  it('projectCreate 至少 3 条核心规则', () => {
    expect(RULES_BY_PAGE.projectCreate).toHaveLength(3);
    expect(RULES_BY_PAGE.projectCreate).toContain(ZK_RULE_ARCHIVED_READONLY);
    expect(RULES_BY_PAGE.projectCreate).toContain(ZK_RULE_BONUS_POOL_FORMULA);
    expect(RULES_BY_PAGE.projectCreate).toContain(ZK_RULE_ALLOWANCE_CAP);
  });

  it('bidRespond 含拒绝不留痕规则', () => {
    expect(RULES_BY_PAGE.bidRespond).toContain(ZK_RULE_BID_REJECT_NO_TRACE);
  });

  it('adminConfig 含超管移交 + 审计导出', () => {
    expect(RULES_BY_PAGE.adminConfig).toContain(ZK_RULE_SUPER_ADMIN_TRANSFER);
    expect(RULES_BY_PAGE.adminConfig).toContain(ZK_RULE_AUDIT_EXPORTABLE);
  });

  it('bidList 含 4 段招标相关规则', () => {
    expect(RULES_BY_PAGE.bidList).toContain(ZK_RULE_BID_EXPIRED_NOTIFY);
    expect(RULES_BY_PAGE.bidList).toContain(ZK_RULE_BID_CONDITIONS_CHANGE_NOTIFY);
    expect(RULES_BY_PAGE.bidList).toContain(ZK_RULE_BID_ADMIN_ASSIGN_30D);
  });

  it('workbench 含津贴风控 3 段', () => {
    expect(RULES_BY_PAGE.workbench).toContain(ZK_RULE_LONG_NO_OUTPUT_ALERT);
    expect(RULES_BY_PAGE.workbench).toContain(ZK_RULE_SCORE_BELOW_60_STOP);
    expect(RULES_BY_PAGE.workbench).toContain(ZK_RULE_ALLOWANCE_CAP);
  });
});

describe('renderRulesDescription：拼接多规则为 Alert description', () => {
  it('用换行分段、章节标注前置', () => {
    const desc = renderRulesDescription([ZK_RULE_BONUS_POOL_FORMULA, ZK_RULE_ALLOWANCE_CAP]);
    expect(desc).toContain('1.');
    expect(desc).toContain('2.');
    expect(desc).toContain('§三.2.1');
    expect(desc).toContain('§三.1.2');
    expect(desc.split('\n')).toHaveLength(2);
  });

  it('空数组返回空字符串', () => {
    expect(renderRulesDescription([])).toBe('');
  });
});
