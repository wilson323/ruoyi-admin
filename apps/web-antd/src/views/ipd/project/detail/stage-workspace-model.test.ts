import { describe, expect, it } from 'vitest';

import type { StageAction } from '../../../../api/ipd/stage-action';
import { aiTaskStatusText, execModeText } from '../../_shared/ipd-enums';
import {
  buildStageWorkspace,
  type StageWorkspaceInput,
} from './stage-workspace-model';

function action(partial: Partial<StageAction> & Pick<StageAction, 'id' | 'actionCode'>): StageAction {
  return {
    actionName: partial.actionCode,
    depth: 'LIGHT',
    projectId: '1',
    status: 'NOT_STARTED',
    ...partial,
  };
}

function input(partial: Partial<StageWorkspaceInput> = {}): StageWorkspaceInput {
  return {
    actions: [],
    catalogLoaded: true,
    checklistItems: [],
    checklistLoaded: false,
    checklistStage: null,
    currentChecklistItems: [],
    currentChecklistLoaded: false,
    currentChecklistStage: null,
    currentStageCode: 'CONCEPT',
    currentStageId: 's1',
    currentSubStageCode: null,
    documents: [],
    documentsLoaded: true,
    runs: [],
    runsLoaded: true,
    stageCode: 'CONCEPT',
    stageId: 's1',
    subStageLoaded: true,
    subStages: [],
    tasks: [],
    tasksLoaded: true,
    todos: [],
    todosLoaded: true,
    ...partial,
  };
}

describe('buildStageWorkspace', () => {
  it('没有可列动作时，目的和必需成果用白话说明还没有单独说明', () => {
    const view = buildStageWorkspace(input({
      checklistItems: [],
      checklistLoaded: true,
      checklistStage: 'CONCEPT',
      currentChecklistItems: [],
      currentChecklistLoaded: true,
      currentChecklistStage: 'CONCEPT',
    }));
    expect(view.purpose).toBe('这一阶段要完成的事，系统还没有单独说明');
    expect(view.requiredOutcomes).toBe('这一阶段还没有单独的成果说明');
    expect(`${view.purpose} ${view.requiredOutcomes}`).not.toMatch(/接口|字段|API/);
    expect(view.nowStage).toBe('概念阶段，小阶段尚未开始');
    expect(view.aiDoingNow).toBe('没有进行中的 AI 任务或运行');
    expect(view.awaitingReview).toBe('没有待审核成果');
    expect(view.passConditions).toBe('没有门禁项');
    expect(view.gaps).toBe('没有未满足的门禁项或未完成的阻断动作');
    expect(view.blockingAdvance).toBe('没有未满足的门禁项或未完成的阻断动作');
  });

  it('只引用已有动作、任务、运行、文档和门禁，不编造销量或国家', () => {
    const view = buildStageWorkspace(input({
      actions: [
        action({
          id: 'a1',
          actionCode: 'C02',
          actionName: '竞品分析',
          isBlocking: '1',
          status: 'IN_PROGRESS',
        }),
      ],
      checklistItems: [{
        code: 'G1',
        name: '概念门禁',
        ok: false,
        reason: '待产线负责人批准',
        stage: 'CONCEPT',
        status: 'DONE',
      }],
      checklistLoaded: true,
      checklistStage: 'CONCEPT',
      currentChecklistItems: [{
        code: 'G1',
        name: '概念门禁',
        ok: false,
        reason: '待产线负责人批准',
        stage: 'CONCEPT',
        status: 'DONE',
      }],
      currentChecklistLoaded: true,
      currentChecklistStage: 'CONCEPT',
      currentSubStageCode: 'CONCEPT-01',
      documents: [{ id: '2105689938606444545', status: 'GENERATED', title: 'C02 产物' }],
      runs: [{ actionCode: 'C02', artifactTitles: [], status: 'RUNNING' }],
      subStages: [{
        actions: [{ actionCode: 'C02', actionName: '竞品分析', skillNames: [], sortOrder: 1, subStageCode: 'CONCEPT-01' }],
        code: 'CONCEPT-01',
        gateCode: null,
        id: '801',
        isGate: '0',
        name: '机会识别',
        ownerRole: 'PM',
        skillHint: '不要当成阶段目的',
        sortOrder: 1,
        stageCode: 'CONCEPT',
      }],
      tasks: [{
        actionCode: 'C02',
        errorMsg: null,
        execMode: 'AI_GENERATE',
        id: 't1',
        projectId: '1',
        resultSummary: null,
        stageActionId: 'a1',
        status: 'RUNNING',
        triggerType: null,
      }],
      todos: [{
        actionCode: 'C02',
        status: 'IN_PROGRESS',
        taskType: 'stage_sign',
        title: '竞品分析待办',
      }],
    }));
    expect(view.nowStage).toBe('概念阶段，小阶段 机会识别');
    expect(view.aiDoingNow).toContain(`竞品分析：${aiTaskStatusText('RUNNING')}`);
    expect(view.aiDoingNow).toContain('竞品分析：运行中');
    expect(view.awaitingReview).toBe('C02 产物：待审核');
    expect(view.blockingAdvance).toContain('概念门禁：待产线负责人批准');
    expect(view.blockingAdvance).toContain('竞品分析：还没完成');
    expect(view.aiWork).toContain(`竞品分析：${execModeText('AI_GENERATE')}`);
    expect(view.myDuty).toContain('责任角色 PM');
    expect(view.myDuty).toContain('竞品分析待办');
    expect(view.passConditions).toBe('概念门禁：待产线负责人批准');
    expect(view.gaps).toContain('概念门禁：待产线负责人批准');
    expect(view.purpose).toBe('完成本阶段列出的工作后，才能考虑进入下一阶段');
    expect(view.requiredOutcomes).toBe('要完成：竞品分析');
    expect(`${view.purpose} ${view.requiredOutcomes}`).not.toMatch(/接口|字段|API/);
    expect(view.purpose).not.toContain('不要当成阶段目的');
    expect(view.subStages[0]?.name).toBe('机会识别');
    expect(JSON.stringify(view)).not.toMatch(/销量|国家|认证编号/);
  });

  it('目录未加载时，写明缺的是哪份列表', () => {
    const view = buildStageWorkspace(input({
      actions: [action({ id: 'a1', actionCode: 'C02', actionName: '竞品分析' })],
      catalogLoaded: false,
      checklistLoaded: false,
      currentChecklistLoaded: false,
      documentsLoaded: false,
      runsLoaded: false,
      stageCode: 'PLAN',
      stageId: null,
      subStageLoaded: false,
      tasksLoaded: false,
      todosLoaded: false,
    }));
    expect(view.aiDoingNow).toBe('AI 任务和运行列表都没加载');
    expect(view.aiWork).toBe('小阶段目录没加载，不能汇总这一阶段');
    expect(view.awaitingReview).toBe('文档列表没加载，不能判断哪些成果待审核');
    expect(view.myDuty).toBe('小阶段目录没加载，不能汇总这一阶段');
    expect(view.passConditions).toBe('这一阶段的门禁清单没加载');
    expect(view.gaps).toBe('这一阶段的门禁和动作都没加载');
    expect(view.blockingAdvance).toBe('当前阶段门禁清单没加载');
    expect(view.nowStage).toBe('概念阶段');
    expect(view.subStages).toEqual([]);
    expect(view.purpose).toBe('这一阶段要完成的事，系统还没有单独说明');
    expect(view.requiredOutcomes).toBe('这一阶段还没有单独的成果说明');
    expect(view.requiredOutcomes).not.toContain('竞品分析');
  });

  it('浏览其他阶段不改当前阶段，另一阶段的门禁不写进通过条件', () => {
    const view = buildStageWorkspace(input({
      checklistItems: [{
        code: 'G1',
        name: '概念门禁',
        ok: false,
        reason: '待产线负责人批准',
        stage: 'CONCEPT',
        status: 'DONE',
      }],
      checklistLoaded: true,
      checklistStage: 'CONCEPT',
      currentChecklistItems: [{
        code: 'G1',
        name: '概念门禁',
        ok: false,
        reason: '待产线负责人批准',
        stage: 'CONCEPT',
        status: 'DONE',
      }],
      currentChecklistLoaded: true,
      currentChecklistStage: 'CONCEPT',
      stageCode: 'PLAN',
      stageId: 's2',
      subStages: [{
        actions: [],
        code: 'PLAN-01',
        gateCode: null,
        id: '901',
        isGate: '0',
        name: '计划拆解',
        ownerRole: 'MARKET_PM',
        skillHint: null,
        sortOrder: 1,
        stageCode: 'PLAN',
      }],
    }));
    expect(view.nowStage).toBe('概念阶段，小阶段尚未开始');
    expect(view.passConditions).toBe('这一阶段的门禁清单没加载');
    expect(view.gaps).toBe('没有未完成的阻断动作');
    expect(view.gaps).not.toContain('概念门禁');
    expect(view.blockingAdvance).toBe('概念门禁：待产线负责人批准');
    expect(view.myDuty).toBe('责任角色 市场PM');
    expect(view.purpose).toBe('这一阶段要完成的事，系统还没有单独说明');
    expect(view.requiredOutcomes).toBe('这一阶段还没有单独的成果说明');
  });

  it('阻碍推进把内部状态和来源说成白话，同一动作只留一句', () => {
    const source = '未完成 status=NOT_STARTED；来源=超管配置 gate.a_level_block_codes';
    const view = buildStageWorkspace(input({
      actions: [
        action({
          id: 'a1',
          actionCode: 'C01',
          actionName: 'Charter立项评审会',
          isBlocking: '1',
          stageId: 's1',
          status: 'NOT_STARTED',
        }),
        action({
          id: 'a2',
          actionCode: 'C08',
          actionName: '生物特征数据合规审查',
          isBlocking: '1',
          stageId: 's1',
          status: 'IN_PROGRESS',
        }),
        action({
          id: 'a3',
          actionCode: 'C09',
          actionName: '已提交待批',
          isBlocking: '1',
          stageId: 's1',
          status: 'DONE',
        }),
      ],
      checklistItems: [
        {
          code: 'C01',
          name: 'Charter立项评审会',
          ok: false,
          reason: source,
          stage: 'CONCEPT',
          status: 'NOT_STARTED',
        },
      ],
      checklistLoaded: true,
      checklistStage: 'CONCEPT',
      currentChecklistItems: [
        {
          code: 'C01',
          name: 'Charter立项评审会',
          ok: false,
          reason: source,
          stage: 'CONCEPT',
          status: 'NOT_STARTED',
        },
        {
          code: 'C08',
          name: '生物特征数据合规审查',
          ok: false,
          reason: '未完成 status=IN_PROGRESS；来源=超管配置 gate.a_level_block_codes',
          stage: 'CONCEPT',
          status: 'IN_PROGRESS',
        },
        {
          code: 'C09',
          name: '已提交待批',
          ok: false,
          reason: '已提交，待产线负责人批准；来源=超管配置 gate.a_level_block_codes',
          stage: 'CONCEPT',
          status: 'DONE',
        },
        {
          code: 'C10',
          name: '尚未建立的必做项',
          ok: false,
          reason: '必做未实例化；来源=超管配置 gate.a_level_block_codes',
          stage: 'CONCEPT',
          status: null,
        },
      ],
      currentChecklistLoaded: true,
      currentChecklistStage: 'CONCEPT',
      subStages: [{
        actions: [
          { actionCode: 'C01', actionName: 'Charter立项评审会', skillNames: [], sortOrder: 1, subStageCode: 'CONCEPT-01' },
          { actionCode: 'C08', actionName: '生物特征数据合规审查', skillNames: [], sortOrder: 2, subStageCode: 'CONCEPT-01' },
          { actionCode: 'C09', actionName: '已提交待批', skillNames: [], sortOrder: 3, subStageCode: 'CONCEPT-01' },
        ],
        code: 'CONCEPT-01',
        gateCode: null,
        id: '801',
        isGate: '0',
        name: '机会识别',
        ownerRole: 'PM',
        skillHint: null,
        sortOrder: 1,
        stageCode: 'CONCEPT',
      }],
    }));
    expect(view.blockingAdvance).toBe(
      'Charter立项评审会：还没开始；生物特征数据合规审查：还没完成；已提交待批：已提交，待产线负责人批准；尚未建立的必做项：还没开始',
    );
    expect(view.blockingAdvance.match(/Charter立项评审会/g)).toHaveLength(1);
    expect(view.blockingAdvance.match(/生物特征数据合规审查/g)).toHaveLength(1);
    expect(view.blockingAdvance).not.toMatch(/status=|NOT_STARTED|IN_PROGRESS|gate\.a_level_block_codes|超管配置|未开始/);
    expect(view.purpose).toBe('完成本阶段列出的工作后，才能考虑进入下一阶段');
    expect(view.requiredOutcomes).toBe('要完成：Charter立项评审会、生物特征数据合规审查、已提交待批');
    expect(`${view.purpose} ${view.requiredOutcomes}`).not.toMatch(/接口|字段|API/);
    expect(view.passConditions).toBe('Charter立项评审会：还没开始');
    expect(view.gaps).toContain('Charter立项评审会：还没开始');
    expect(view.gaps).not.toContain(source);
    expect(`${view.passConditions} ${view.gaps}`).not.toMatch(/status=|gate\.a_level_block_codes|超管配置/);
  });
});
