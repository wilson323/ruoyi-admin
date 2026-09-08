// IPD 通用展示枚举单测：角色 / 阶段 / 状态 / 优先级 / 严重度。
import { describe, expect, it } from 'vitest';

import {
  ACTION_STATUS_TEXT,
  ALGO_TEXT,
  BID_MODE_TEXT,
  BID_RESPONSE_STATUS_TEXT,
  BID_STATUS_TEXT,
  CATCHUP_TEXT,
  COEF_CHANGE_STATUS_TEXT,
  DECISION_LABEL,
  DELETION_STATUS_TEXT,
  DEMAND_STATUS_TONE,
  DEPTH_COLOR,
  DEPTH_TEXT,
  LEVEL_TEXT,
  PERSON_TYPE_TEXT_FROM_ROLE,
  PRIORITY_TEXT,
  PRIORITY_TONE,
  PRODUCT_STATUS_TEXT,
  ROLE_TEXT,
  SEVERITY_TEXT,
  SEVERITY_TONE,
  SOURCE_TEXT,
  STAGE_TONE,
  TEMPLATE_TEXT,
  WORKBENCH_TASK_STATUS_TEXT,
  WORKBENCH_TASK_TYPE_TEXT,
  actionStatusLabel,
  bidResponseStatusLabel,
  bidStatusLabel,
  bonusStateLabel,
  bonusStateTone,
  changeStateLabel,
  changeStateTone,
  demandStateLabel,
  deletionStateLabel,
  gateStateLabel,
  personTypeText,
  priorityText,
  priorityTone,
  projectStateLabel,
  projectStateTone,
  roleText,
  severityText,
  severityTone,
  taskTypeText,
} from './ipd-enums';

describe('ROLE_TEXT 内部 5 角色', () => {
  it('所有 5 角色映射存在', () => {
    expect(ROLE_TEXT.GROUP_LEADER).toBe('产品组长');
    expect(ROLE_TEXT.MARKET_PM).toBe('市场PM');
    expect(ROLE_TEXT.RD_PM).toBe('研发PM');
    expect(ROLE_TEXT.SUPER_ADMIN).toBe('超级管理员');
    expect(ROLE_TEXT.INTERNAL).toBe('内部成员');
  });

  it('roleText 未知值返回 fallback', () => {
    expect(roleText('WEIRD')).toBe('未知角色');
    expect(roleText(null)).toBe('未知角色');
    expect(roleText('WEIRD', '兜底')).toBe('兜底');
  });

  it('personTypeText 仅含项目级 4 角色（不含 INTERNAL）', () => {
    expect(personTypeText('GROUP_LEADER')).toBe('产品组长');
    expect(personTypeText('SUPER_ADMIN')).toBe('超级管理员');
    expect(personTypeText('INTERNAL')).toBe('待补充');
    expect(Object.keys(PERSON_TYPE_TEXT_FROM_ROLE).sort()).toEqual(
      ['GROUP_LEADER', 'MARKET_PM', 'RD_PM', 'SUPER_ADMIN'].sort(),
    );
  });
});

describe('STAGE_TONE 六阶段配色', () => {
  it('6 阶段齐全', () => {
    expect(Object.keys(STAGE_TONE).sort()).toEqual(
      ['CONCEPT', 'DEV', 'LAUNCH', 'LIFECYCLE', 'PLAN', 'VALID'].sort(),
    );
  });
});

describe('PRIORITY_TEXT 优先级 3 档', () => {
  it('高/中/低', () => {
    expect(PRIORITY_TEXT.HIGH).toBe('高');
    expect(PRIORITY_TEXT.NORMAL).toBe('中');
    expect(PRIORITY_TEXT.LOW).toBe('低');
    expect(priorityText('UNKNOWN')).toBe('待补充');
    expect(priorityTone('HIGH')).toBe('error');
    expect(PRIORITY_TONE.NORMAL).toBe('processing');
  });
});

describe('SEVERITY_TEXT 严重度 3 档', () => {
  it('严重/主要/轻微', () => {
    expect(SEVERITY_TEXT.CRITICAL).toBe('严重');
    expect(SEVERITY_TEXT.MAJOR).toBe('主要');
    expect(SEVERITY_TEXT.MINOR).toBe('轻微');
    expect(severityText('UNKNOWN')).toBe('待补充');
    expect(severityTone('MAJOR')).toBe('orange');
    expect(SEVERITY_TONE.CRITICAL).toBe('red');
  });
});

describe('业务状态机 label/tone 转发', () => {
  it('project 状态转发到状态机', () => {
    expect(projectStateLabel('ACTIVE')).toBe('进行中');
    expect(projectStateLabel('ARCHIVED')).toBe('已归档');
    expect(projectStateTone('SUSPENDED')).toBe('warning');
  });

  it('bonus 状态转发', () => {
    expect(bonusStateLabel('DISTRIBUTED')).toBe('已分配');
    expect(bonusStateTone('DRAFT')).toBe('default');
  });

  it('change / gate / demand / deletion 状态转发', () => {
    expect(changeStateLabel('PENDING_SIGN')).toBe('待双签');
    expect(changeStateTone('APPROVED')).toBe('success');
    expect(gateStateLabel('PASSED')).toBe('已通过');
    expect(demandStateLabel('EVALUATING')).toBe('分析中');
    expect(deletionStateLabel('LEADER_APPROVED')).toBe('组长已审');
  });

  it('bid / bid-response / action 状态机转发（A28 新增）', () => {
    expect(bidStatusLabel('OPEN')).toBe('招标中');
    expect(bidResponseStatusLabel('ACCEPTED')).toBe('已中标');
    expect(actionStatusLabel('DELAYED')).toBe('已逾期');
  });
});

describe('A28 新增显示映射表 SSOT', () => {
  it('招标单状态中文与 SSOT 一致', () => {
    expect(BID_STATUS_TEXT.OPEN).toBe('招标中');
    expect(BID_STATUS_TEXT.SELECTED).toBe('已遴选');
    expect(BID_STATUS_TEXT.EXPIRED).toBe('已过期');
    expect(BID_STATUS_TEXT.CLOSED).toBe('已关闭');
  });

  it('招标方式与应标状态中文 SSOT', () => {
    expect(BID_MODE_TEXT.PUBLIC).toBe('公开征集');
    expect(BID_MODE_TEXT.ONE_TO_ONE).toBe('定向邀请');
    expect(BID_RESPONSE_STATUS_TEXT.PENDING).toBe('已应标（待遴选）');
    expect(BID_RESPONSE_STATUS_TEXT.WITHDRAWN).toBe('已撤回');
  });

  it('项目级别/模板/来源/补齐中文 SSOT', () => {
    expect(LEVEL_TEXT.S).toBe('S 级（战略）');
    expect(LEVEL_TEXT.A).toBe('A 级（标准）');
    expect(LEVEL_TEXT.B).toBe('B 级（差异化下调）');
    expect(TEMPLATE_TEXT.HARDWARE).toBe('硬件');
    expect(TEMPLATE_TEXT.SOFTWARE).toBe('软件');
    expect(TEMPLATE_TEXT.SOLUTION).toBe('解决方案');
    expect(SOURCE_TEXT.NEW).toBe('新建');
    expect(SOURCE_TEXT.LEGACY).toBe('存量导入');
    expect(CATCHUP_TEXT.IN_PROGRESS).toBe('补齐中');
    expect(CATCHUP_TEXT.COMPLETE).toBe('已补齐');
  });

  it('动作深度 + 阶段动作状态 SSOT', () => {
    expect(DEPTH_TEXT.DEEP).toBe('深管动作');
    expect(DEPTH_TEXT.LIGHT).toBe('轻管动作');
    expect(DEPTH_COLOR.DEEP).toBe('processing');
    expect(ACTION_STATUS_TEXT.NOT_STARTED).toBe('未开始');
    expect(ACTION_STATUS_TEXT.DONE).toBe('已完成');
    expect(ACTION_STATUS_TEXT.NA).toBe('不适用');
  });

  it('算法分类 + 产品状态 SSOT', () => {
    expect(ALGO_TEXT.FACE).toBe('人脸');
    expect(ALGO_TEXT.MULTI).toBe('多模态');
    expect(PRODUCT_STATUS_TEXT.ACTIVE).toBe('启用');
    expect(PRODUCT_STATUS_TEXT.IN_RD).toBe('研发中');
    expect(PRODUCT_STATUS_TEXT.ON_SALE).toBe('在售');
  });

  it('工作台任务状态 + 决策标签 SSOT', () => {
    expect(WORKBENCH_TASK_STATUS_TEXT.NOT_STARTED).toBe('未开始');
    expect(WORKBENCH_TASK_STATUS_TEXT.IN_PROGRESS).toBe('进行中');
    expect(WORKBENCH_TASK_STATUS_TEXT.DELAYED).toBe('已延期');
    expect(DECISION_LABEL.APPROVE).toBe('通过');
    expect(DECISION_LABEL.REJECT).toBe('驳回');
  });

  it('系数变更审批状态 SSOT', () => {
    expect(COEF_CHANGE_STATUS_TEXT.PENDING_LEADER).toBe('待产品组长确认');
    expect(COEF_CHANGE_STATUS_TEXT.PENDING_SECOND).toBe('待对方确认');
    expect(COEF_CHANGE_STATUS_TEXT.CONFIRMED).toBe('已确认生效');
    expect(COEF_CHANGE_STATUS_TEXT.REJECTED).toBe('已驳回');
  });

  it('需求状态色调 SSOT（原型色系）', () => {
    expect(DEMAND_STATUS_TONE.SUBMITTED).toBe('amber');
    expect(DEMAND_STATUS_TONE.ACCEPTED).toBe('blue');
    expect(DEMAND_STATUS_TONE.SCHEDULED).toBe('green');
  });

  it('删除申请状态中文 SSOT（与状态机 6 态不同，按此 5 态展示）', () => {
    expect(DELETION_STATUS_TEXT.LEADER_REVIEW).toBe('组长初审中');
    expect(DELETION_STATUS_TEXT.ADMIN_REVIEW).toBe('超管终审中');
    expect(DELETION_STATUS_TEXT.DELETED).toBe('已删除（归档）');
    expect(DELETION_STATUS_TEXT.REJECTED).toBe('已驳回');
    expect(DELETION_STATUS_TEXT.WITHDRAWN).toBe('已撤回');
  });
});

describe('WORKBENCH_TASK_TYPE_TEXT 工作台任务类型 17 类', () => {
  it('17 类 taskType 齐全（spec batch-01 页03:165）', () => {
    expect(Object.keys(WORKBENCH_TASK_TYPE_TEXT).sort()).toEqual(
      [
        'bonus_lock',
        'capacity_approval',
        'change_implementation',
        'change_verify',
        'closeout',
        'contribution_confirm',
        'deletion_review',
        'handover',
        'key_gate',
        'key_gate_arbitration',
        'kpi_fill',
        'rd_replacement',
        'receipt_review',
        'retirement_review',
        'stage_sign',
        'strategic_change',
        'waiver_review',
      ].sort(),
    );
  });

  it('关键 key 中文映射正确', () => {
    expect(WORKBENCH_TASK_TYPE_TEXT.stage_sign).toBe('阶段签署');
    expect(WORKBENCH_TASK_TYPE_TEXT.key_gate).toBe('关键 Gate 评审');
    expect(WORKBENCH_TASK_TYPE_TEXT.key_gate_arbitration).toBe('Gate 仲裁');
    expect(WORKBENCH_TASK_TYPE_TEXT.deletion_review).toBe('删除审批');
    expect(WORKBENCH_TASK_TYPE_TEXT.waiver_review).toBe('豁免审批');
    expect(WORKBENCH_TASK_TYPE_TEXT.handover).toBe('项目移交');
    expect(WORKBENCH_TASK_TYPE_TEXT.rd_replacement).toBe('研发替补');
    expect(WORKBENCH_TASK_TYPE_TEXT.contribution_confirm).toBe('贡献确认');
    expect(WORKBENCH_TASK_TYPE_TEXT.receipt_review).toBe('回执审核');
    expect(WORKBENCH_TASK_TYPE_TEXT.retirement_review).toBe('退役评审');
    expect(WORKBENCH_TASK_TYPE_TEXT.strategic_change).toBe('战略变更');
    expect(WORKBENCH_TASK_TYPE_TEXT.capacity_approval).toBe('产能审批');
    expect(WORKBENCH_TASK_TYPE_TEXT.kpi_fill).toBe('KPI 填写');
    expect(WORKBENCH_TASK_TYPE_TEXT.change_implementation).toBe('变更实施');
    expect(WORKBENCH_TASK_TYPE_TEXT.change_verify).toBe('变更验收');
    expect(WORKBENCH_TASK_TYPE_TEXT.bonus_lock).toBe('奖金锁定');
    expect(WORKBENCH_TASK_TYPE_TEXT.closeout).toBe('项目收尾');
  });

  it('taskTypeText 已知值返回中文', () => {
    expect(taskTypeText('stage_sign')).toBe('阶段签署');
    expect(taskTypeText('closeout')).toBe('项目收尾');
    expect(taskTypeText('key_gate_arbitration')).toBe('Gate 仲裁');
    expect(taskTypeText('kpi_fill')).toBe('KPI 填写');
  });

  it('taskTypeText 未知值原样返回（passthrough fallback）', () => {
    expect(taskTypeText('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
    expect(taskTypeText('legacy_type')).toBe('legacy_type');
    expect(taskTypeText('')).toBe('');
  });
});

