/**
 * 项目流程页的阶段视图：只汇总已经加载的阶段、动作、运行、待办和门禁。
 * 阶段目的、必需成果没有单独说明。有这一阶段已取到的未完成动作时，
 * 目的用一句白话概括这些动作还要做完，成果只列出这些动作名。
 * 没有可列的动作时，写明系统还没有单独说明。
 * 不把 skillHint 或模型推测写成目的、认证、销量或国家。
 */
import type { GateChecklistItem } from '../../../../api/ipd/project';
import { agentRunStatusMeta } from '../../../../api/ipd/project-agent';
import type { AiAgentTaskView, StageAction } from '../../../../api/ipd/stage-action';
import type { SubStage } from '../../../../api/ipd/stage-sub-stages';
import { documentStatusLabel } from '../../_shared/ai-agent/document-review-actions';
import {
  ACTION_EXEC_MODE,
  aiTaskStatusText,
  execModeText,
  ROLE_TEXT,
  taskTypeText,
} from '../../_shared/ipd-enums';
import { actionStatusText, stageText } from '../project-display';

const PURPOSE_FROM_OPEN_ACTIONS = '完成本阶段列出的工作后，才能考虑进入下一阶段';
const PURPOSE_UNSTATED = '这一阶段要完成的事，系统还没有单独说明';
const OUTCOMES_UNSTATED = '这一阶段还没有单独的成果说明';
const NO_CURRENT_STAGE = '项目详情没有当前阶段';
const AI_LISTS_MISSING = 'AI 任务和运行列表都没加载';
const AI_TASKS_MISSING = 'AI 任务列表没加载';
const AI_RUNS_MISSING = '项目智能体运行列表没加载';
const DOCUMENTS_MISSING = '文档列表没加载，不能判断哪些成果待审核';
const CURRENT_GATE_MISSING = '当前阶段门禁清单没加载';
const CURRENT_ACTIONS_UNSCOPED = '当前阶段没有可对照的动作目录，不能判断阻断动作';
const VIEW_CATALOG_MISSING = '小阶段目录没加载，不能汇总这一阶段';
const VIEW_GATE_MISSING = '这一阶段的门禁清单没加载';
const VIEW_FACTS_MISSING = '这一阶段的门禁和动作都没加载';
const TODOS_MISSING = '待办列表没加载';
const NO_REASON = '没有说明';

const ACTIVE_RUN = new Set(['CANCEL_REQUESTED', 'PENDING', 'RUNNING', 'WAITING_APPROVAL']);
const ACTIVE_TASK = new Set(['PENDING', 'RUNNING']);

export interface StageWorkspaceDocument {
  id: string;
  status: string;
  title: string;
}

export interface StageWorkspaceRun {
  actionCode: null | string;
  artifactTitles: string[];
  status: string;
}

export interface StageWorkspaceTodo {
  actionCode: null | string;
  status: string;
  taskType: string;
  title: null | string;
}

export interface StageWorkspaceInput {
  catalogLoaded: boolean;
  checklistItems: GateChecklistItem[];
  checklistLoaded: boolean;
  checklistStage: null | string;
  currentChecklistItems: GateChecklistItem[];
  currentChecklistLoaded: boolean;
  currentChecklistStage: null | string;
  currentStageCode: null | string;
  currentStageId: null | string;
  currentSubStageCode: null | string;
  documents: StageWorkspaceDocument[];
  documentsLoaded: boolean;
  runs: StageWorkspaceRun[];
  runsLoaded: boolean;
  stageCode: null | string;
  stageId: null | string;
  subStageLoaded: boolean;
  subStages: SubStage[];
  tasks: AiAgentTaskView[];
  tasksLoaded: boolean;
  todos: StageWorkspaceTodo[];
  todosLoaded: boolean;
  actions: StageAction[];
}

export interface StageSubStageRow {
  actions: Array<{ code: string; name: string }>;
  code: string;
  name: string;
}

export interface StageWorkspaceView {
  aiDoingNow: string;
  aiWork: string;
  awaitingReview: string;
  blockingAdvance: string;
  gaps: string;
  myDuty: string;
  nowStage: string;
  passConditions: string;
  purpose: string;
  requiredOutcomes: string;
  subStages: StageSubStageRow[];
}

interface StageSlice {
  codes: Set<string>;
  scoped: boolean;
  stageActions: StageAction[];
  subStages: StageSubStageRow[];
}

function rowsFor(input: StageWorkspaceInput, stageCode: string): StageSubStageRow[] {
  if (!input.catalogLoaded) return [];
  return input.subStages
    .filter((stage) => stage.stageCode === stageCode)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stage) => ({
      code: stage.code,
      name: stage.name,
      actions: [...stage.actions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((action) => ({ code: action.actionCode, name: action.actionName })),
    }));
}

function actionInStage(action: StageAction, stageId: null | string, codes: Set<string>): boolean {
  if (stageId && action.stageId != null && String(action.stageId) === stageId) return true;
  return !!action.actionCode && codes.has(action.actionCode);
}

function sliceFor(
  input: StageWorkspaceInput,
  stageCode: string,
  stageId: null | string,
): StageSlice {
  const subStages = rowsFor(input, stageCode);
  const codes = new Set(subStages.flatMap((stage) => stage.actions.map((action) => action.code)));
  const scoped = input.catalogLoaded && (subStages.length > 0 || !!stageId);
  return {
    codes,
    scoped,
    stageActions: scoped ? input.actions.filter((action) => actionInStage(action, stageId, codes)) : [],
    subStages,
  };
}

function accepted(action: StageAction): boolean {
  return action.status === 'NA' || (action.status === 'DONE' && !!action.confirmedBy);
}

function namedAction(actions: StageAction[], code: null | string): string {
  if (!code) return '动作没有编码';
  return actions.find((action) => action.actionCode === code)?.actionName || code;
}

function joinFacts(lines: string[], empty: string): string {
  return lines.length > 0 ? lines.join('；') : empty;
}

function runStatusLabel(status: string): null | string {
  if (!ACTIVE_RUN.has(status)) return null;
  if (status === 'CANCEL_REQUESTED' || status === 'PENDING' || status === 'RUNNING' || status === 'WAITING_APPROVAL') {
    return agentRunStatusMeta(status).label;
  }
  return null;
}

function activeTaskLines(input: StageWorkspaceInput, actions: StageAction[]): string[] {
  if (!input.tasksLoaded) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const task of input.tasks) {
    if (!ACTIVE_TASK.has(task.status)) continue;
    const key = task.actionCode ?? task.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = task.resultSummary?.trim();
    const status = aiTaskStatusText(task.status);
    lines.push(summary
      ? `${namedAction(actions, task.actionCode)}：${status}，${summary}`
      : `${namedAction(actions, task.actionCode)}：${status}`);
  }
  return lines;
}

function activeRunLines(input: StageWorkspaceInput, actions: StageAction[], codes?: Set<string>): string[] {
  if (!input.runsLoaded) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const run of input.runs) {
    const label = runStatusLabel(run.status);
    if (!label) continue;
    if (codes && run.actionCode && !codes.has(run.actionCode)) continue;
    if (codes && !run.actionCode) continue;
    const key = run.actionCode ?? run.status;
    if (seen.has(key)) continue;
    seen.add(key);
    const titles = run.artifactTitles.filter((title) => title.trim());
    const name = namedAction(actions, run.actionCode);
    lines.push(titles.length > 0 ? `${name}：${label}，产物 ${titles.join('、')}` : `${name}：${label}`);
  }
  return lines;
}

/** 项目此刻在哪个大阶段、哪个小阶段。小阶段游标没加载时不补「尚未开始」。 */
function nowStage(input: StageWorkspaceInput): string {
  if (!input.currentStageCode) return NO_CURRENT_STAGE;
  const label = stageText(input.currentStageCode);
  if (!input.subStageLoaded) return label;
  if (!input.currentSubStageCode) return `${label}，小阶段尚未开始`;
  const match = input.subStages.find((stage) => stage.code === input.currentSubStageCode);
  return `${label}，小阶段 ${match?.name || input.currentSubStageCode}`;
}

/** 全项目进行中的 AI 任务和未结束的项目智能体运行。没加载就写明哪边没加载。 */
function aiDoingNow(input: StageWorkspaceInput): string {
  const lines = [...activeTaskLines(input, input.actions), ...activeRunLines(input, input.actions)];
  if (lines.length > 0) return lines.join('；');
  if (input.tasksLoaded && input.runsLoaded) return '没有进行中的 AI 任务或运行';
  if (!input.tasksLoaded && !input.runsLoaded) return AI_LISTS_MISSING;
  if (!input.tasksLoaded) return `没有进行中的运行；${AI_TASKS_MISSING}`;
  return `没有进行中的 AI 任务；${AI_RUNS_MISSING}`;
}

/** 版本链最后一版 status=GENERATED 的文档，文案用现成的「待审核」。 */
function awaitingReview(input: StageWorkspaceInput): string {
  if (!input.documentsLoaded) return DOCUMENTS_MISSING;
  const pending = input.documents.filter((doc) => doc.status === 'GENERATED');
  return joinFacts(
    pending.map((doc) => `${doc.title.trim() || doc.id}：${documentStatusLabel(doc.status)}`),
    '没有待审核成果',
  );
}

function unmetGate(items: GateChecklistItem[]): string[] {
  return items
    .filter((item) => !item.ok)
    .map((item) => `${item.name}：${plainGateFact(item.reason, item.status)}`);
}

function openBlocking(actions: StageAction[]): string[] {
  return actions
    .filter((action) => action.isBlocking === '1' && !accepted(action))
    .map((action) => `${action.actionName || action.actionCode || '未命名动作'}：${actionStatusText(action.status)}`);
}

/** 阻碍推进里的状态只说人话。不回显 status=、枚举码和配置键。 */
function plainIncomplete(status: null | string | undefined): string {
  if (status === 'NOT_STARTED') return '还没开始';
  if (status === 'DONE') return '已提交，待产线负责人批准';
  return '还没完成';
}

/** 门禁原因里的状态和来源改成白话；已经能看懂的原因原样留下。 */
function plainGateFact(reason: string, status: null | string): string {
  const head = reason.trim().split('；来源=')[0]?.trim() ?? '';
  if (!head) return status ? plainIncomplete(status) : NO_REASON;
  if (head.startsWith('已提交，待产线负责人批准')) return '已提交，待产线负责人批准';
  if (head.startsWith('必做未实例化')) return '还没开始';
  const statusInReason = head.match(/status=([A-Za-z0-9_]+)/)?.[1];
  if (head.startsWith('未完成') || head.includes('按未完成处理')) {
    return plainIncomplete(statusInReason || status);
  }
  if (!/status=|NOT_STARTED|IN_PROGRESS|DELAYED|gate\.|超管配置/.test(head)) return head;
  return plainIncomplete(statusInReason || status);
}

/** 门禁表和通过条件共用同一句白话。空原因时按状态说，不回显配置键。 */
export function gateReasonText(
  reason: null | string | undefined,
  status: null | string | undefined,
): string {
  return plainGateFact(reason ?? '', status ?? null);
}

/** 同一动作只留一句。门禁编码和动作编码、两侧名称都算同一个动作。 */
function absorbBlockingLine(
  lines: string[],
  seen: Map<string, true>,
  name: string,
  fact: string,
  code: string,
): void {
  const aliases = [
    code.trim() ? `code:${code.trim()}` : '',
    name.trim() ? `name:${name.trim()}` : '',
  ].filter((key) => key);
  if (aliases.some((key) => seen.has(key))) {
    for (const key of aliases) seen.set(key, true);
    return;
  }
  lines.push(`${name}：${fact}`);
  for (const key of aliases) seen.set(key, true);
}

/** 阻碍推进只看项目当前阶段的门禁原因和未完成阻断动作。判断不变，只改展示。 */
function blockingAdvance(input: StageWorkspaceInput, current: StageSlice): string {
  const checklistForCurrent = input.currentChecklistLoaded
    && input.currentChecklistStage === (input.currentStageCode ?? '');
  const lines: string[] = [];
  const seen = new Map<string, true>();
  if (checklistForCurrent) {
    for (const item of input.currentChecklistItems) {
      if (item.ok) continue;
      const name = item.name.trim() || item.code || '未命名条件';
      absorbBlockingLine(lines, seen, name, plainGateFact(item.reason, item.status), item.code);
    }
  }
  if (current.scoped) {
    for (const action of current.stageActions) {
      if (action.isBlocking !== '1' || accepted(action)) continue;
      const name = action.actionName?.trim() || action.actionCode || '未命名动作';
      absorbBlockingLine(lines, seen, name, plainIncomplete(action.status), action.actionCode ?? '');
    }
  }
  if (lines.length > 0) return lines.join('；');
  if (!checklistForCurrent) return CURRENT_GATE_MISSING;
  if (!current.scoped && input.catalogLoaded) return CURRENT_ACTIONS_UNSCOPED;
  return '没有未满足的门禁项或未完成的阻断动作';
}

function roleLabel(role: string): string {
  return ROLE_TEXT[role] ?? role;
}

function myDuty(input: StageWorkspaceInput, slice: StageSlice): string {
  if (!slice.scoped) return VIEW_CATALOG_MISSING;
  const roles = [...new Set(
    input.subStages
      .filter((stage) => stage.stageCode === (input.stageCode ?? '') && stage.ownerRole)
      .map((stage) => roleLabel(stage.ownerRole)),
  )];
  const rolePart = roles.length > 0 ? `责任角色 ${roles.join('、')}` : '';
  if (!input.todosLoaded) return rolePart || TODOS_MISSING;
  const todos = input.todos
    .filter((todo) => !!todo.actionCode && slice.codes.has(todo.actionCode))
    .map((todo) => `${todo.title?.trim() || todo.actionCode}：${taskTypeText(todo.taskType)}，${actionStatusText(todo.status)}`);
  const parts = [rolePart, ...todos].filter((part) => part);
  return parts.length > 0 ? parts.join('；') : '没有待办';
}

function taskFor(input: StageWorkspaceInput, action: StageAction): AiAgentTaskView | undefined {
  return input.tasks.find((task) => String(task.stageActionId ?? '') === action.id
    || task.actionCode === action.actionCode);
}

/** 本阶段已有执行模式、进行中任务和未结束运行。没有这些来源时不编工作说明。 */
function aiWork(input: StageWorkspaceInput, slice: StageSlice): string {
  if (!slice.scoped) return VIEW_CATALOG_MISSING;
  const lines = slice.stageActions.flatMap((action) => {
    const task = input.tasksLoaded ? taskFor(input, action) : undefined;
    const mode = task?.execMode || ACTION_EXEC_MODE[action.actionCode ?? ''] || '';
    if (!mode && !task) return [];
    const name = action.actionName || action.actionCode || '未命名动作';
    const bits = [mode ? execModeText(mode) : '', task ? aiTaskStatusText(task.status) : '']
      .filter((bit) => bit && bit !== '—');
    const summary = task?.resultSummary?.trim();
    if (summary) bits.push(summary);
    return [`${name}：${bits.join('，') || '没有执行模式或任务状态'}`];
  });
  lines.push(...activeRunLines(input, slice.stageActions, slice.codes));
  if (lines.length > 0) return lines.join('；');
  if (!input.tasksLoaded && !input.runsLoaded) return AI_LISTS_MISSING;
  return '没有 AI 任务或运行';
}

/** 这一阶段已经取到、且还没做完的动作名。已完成的、别的阶段的、没有名字的都不列。 */
function openActionNames(actions: StageAction[]): string[] {
  const names: string[] = [];
  for (const action of actions) {
    if (accepted(action)) continue;
    const name = action.actionName?.trim();
    if (!name) continue;
    names.push(name);
  }
  return names;
}

/** 没有单独的目的说明时，用这一阶段未完成动作概括；没有可列动作时不编造目的。 */
function purposeText(slice: StageSlice): string {
  const listed = slice.stageActions.some((action) => !accepted(action));
  return listed ? PURPOSE_FROM_OPEN_ACTIONS : PURPOSE_UNSTATED;
}

/** 没有单独的成果说明时，只列出这一阶段未完成动作的名字。 */
function requiredOutcomesText(slice: StageSlice): string {
  const names = openActionNames(slice.stageActions);
  if (names.length === 0) return OUTCOMES_UNSTATED;
  return `要完成：${names.join('、')}`;
}

function passAndGaps(input: StageWorkspaceInput, slice: StageSlice): { gaps: string; passConditions: string } {
  const checklistForStage = input.checklistLoaded && input.checklistStage === (input.stageCode ?? '');
  const stageItems = checklistForStage
    ? input.checklistItems.filter((item) => !item.stage || item.stage === input.stageCode)
    : [];
  const passConditions = checklistForStage
    ? joinFacts(
      stageItems.map((item) => `${item.name}：${plainGateFact(item.reason, item.status)}`),
      '没有门禁项',
    )
    : VIEW_GATE_MISSING;
  const gaps = [
    ...unmetGate(stageItems),
    ...(slice.scoped ? openBlocking(slice.stageActions) : []),
  ];
  const gapText = checklistForStage || slice.scoped
    ? joinFacts(gaps, checklistForStage ? '没有未满足的门禁项或未完成的阻断动作' : '没有未完成的阻断动作')
    : VIEW_FACTS_MISSING;
  return { gaps: gapText, passConditions };
}

/**
 * 同一工作区的四问看项目当前事实；下面六格看正在浏览的阶段。
 * 点阶段只改浏览阶段，不改变「现在在哪个阶段」。
 */
export function buildStageWorkspace(input: StageWorkspaceInput): StageWorkspaceView {
  const viewed = sliceFor(input, input.stageCode ?? '', input.stageId);
  const current = sliceFor(input, input.currentStageCode ?? '', input.currentStageId);
  const viewedFacts = passAndGaps(input, viewed);
  return {
    aiDoingNow: aiDoingNow(input),
    aiWork: aiWork(input, viewed),
    awaitingReview: awaitingReview(input),
    blockingAdvance: blockingAdvance(input, current),
    gaps: viewedFacts.gaps,
    myDuty: myDuty(input, viewed),
    nowStage: nowStage(input),
    passConditions: viewedFacts.passConditions,
    purpose: purposeText(viewed),
    requiredOutcomes: requiredOutcomesText(viewed),
    subStages: viewed.subStages,
  };
}
