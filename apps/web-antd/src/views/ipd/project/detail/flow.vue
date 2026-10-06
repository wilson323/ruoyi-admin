<script setup lang="ts">
/**
 * 页11 项目详情-IPD 流程（卡 P0-10.11；后端 /stage-actions?projectId= + /advance-stage + /gate-checklist 已交付）。
 *
 * 六阶段进度（当前阶段高亮）→ 当前阶段门禁推进（advance-stage 失败时 400/10001
 * message 含明细，同时拉 gate-checklist 只读清单辅助定位）→ 全项目动作列表。
 *
 * R215 GAP-F8（2026-09-25）：追加「项目 SOP 快照」Drawer（GET /sop-templates/instances?
 * projectId=，service IDOR 项目成员可见）；模板实例化 instantiate 归 GAP-B2 等 owner 拍板，本页不接按钮。
 *
 * R236（2026-09-27）：节点级 AI 执行状态可视化——每个动作呈现 execMode 徽标 +
 * AI 任务态（PENDING/RUNNING/SUCCEEDED/FAILED/DEAD）+ 产物链接 + 人审标识。
 * 数据来源：GET /ai-agent-tasks?projectId=（AiAgentTaskView 只读投影）。
 * 轮询策略：进入页面拉一次 + 手动刷新按钮，不起高频定时器。
 *
 * 规格 vs 代码差异（G-04 以代码为准）：
 * - key-gates 协作决策链（P2-5；旧五节点顺序口径已废止）后端未交付，阶段推进以 gate-checklist 只读清单呈现；
 * - 阶段清单已接 GET /projects/{id}/stages（R128 P0#2 后端补交，P3-6.1 契约；空/失败回退
 *   STAGE_ORDER 六阶段骨架不断链）；动作表不做阶段分组（原型页11 无分组要求）；
 * - 动作详情操作（深管/轻管分形态）在页 12/13（action-detail）完成，本页仅导航。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Popconfirm,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  message,
} from 'ant-design-vue';

import {
  listAiDocumentsByProject,
  listAiDocumentVersions,
  type AiDocument,
} from '../../../../api/ipd/ai-document';
import { listProjectAgentRuns, type AgentRunListItem } from '../../../../api/ipd/project-agent';
import {
  advanceProjectStage,
  submitStageAcceptance,
  getGateChecklist,
  getProject,
  listProjectStages,
  type GateChecklistView,
  type Project,
  type ProjectStageRow,
} from '../../../../api/ipd/project';
import { fetchWorkbenchTasks, type WorkbenchTask } from '../../../../api/ipd/workbench';
import {
  fetchAiAgentTasksByProject,
  listStageActions,
  type AiAgentTaskView,
  type StageAction,
} from '../../../../api/ipd/stage-action';
import { listSopTemplateInstances, type IpdSopInstance } from '../../../../api/ipd/sop-template';
import {
  advanceSubStage,
  fetchSubStageProgress,
  fetchSubStages,
  type SubStage,
  type SubStageProgress,
} from '../../../../api/ipd/stage-sub-stages';
import AiSuggest from '../../_shared/ai-suggest.vue';
import StageWorkspace from './stage-workspace.vue';
import { gateReasonText } from './stage-workspace-model';
import { isTransportError, ipdErrorText } from '../../_shared/ipd-error-text';
import {
  ACTION_EXEC_MODE,
  aiTaskStatusText,
  aiTaskStatusTone,
  execModeText,
  execModeTone,
  roleText,
} from '../../_shared/ipd-enums';
import {
  STAGE_ORDER,
  actionStatusColor,
  actionStatusText,
  depthColor,
  depthText,
  projectDateText,
  stageColor,
  stageText,
} from '../project-display';

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId ?? ''));
const loading = ref(false);
const loadError = ref<unknown>(null);
const project = ref<null | Project>(null);
const actions = ref<StageAction[]>([]);
const subStages = ref<SubStage[]>([]);
const subStageProgress = ref<null | SubStageProgress>(null);
const subStageError = ref('');
const subStageLoading = ref(false);
const subStageAdvancing = ref(false);
const subStageCatalogLoaded = ref(false);
const targetSubStageCode = ref('');

const subStageOptions = computed(() => subStages.value
  .filter((stage) => stage.stageCode === subStageProgress.value?.currentStage)
  .map((stage) => ({ value: stage.code, label: `${stage.name}（${stage.code}）` })));

async function loadSubStageProgress(): Promise<void> {
  subStageLoading.value = true;
  subStageError.value = '';
  try {
    const [catalog, progress] = await Promise.all([
      fetchSubStages(),
      fetchSubStageProgress(projectId.value),
    ]);
    subStages.value = catalog;
    subStageProgress.value = progress;
    subStageCatalogLoaded.value = true;
    targetSubStageCode.value = '';
  } catch (cause) {
    subStageCatalogLoaded.value = false;
    subStageProgress.value = null;
    subStageError.value = ipdErrorText(cause, { domain: 'project', fallback: '小阶段游标加载失败' });
  } finally {
    subStageLoading.value = false;
  }
}

async function confirmSubStageAdvance(): Promise<void> {
  const progress = subStageProgress.value;
  const target = targetSubStageCode.value;
  if (!progress || !target || subStageAdvancing.value) return;
  subStageAdvancing.value = true;
  subStageError.value = '';
  try {
    await advanceSubStage(projectId.value, target, progress.version);
    await loadSubStageProgress();
    if (subStageProgress.value?.currentSubStageCode !== target) {
      throw new Error('推进结果与服务端回读不一致，请刷新后核实');
    }
    message.success('小阶段已推进并回读确认');
  } catch (cause) {
    await loadSubStageProgress();
    subStageError.value = ipdErrorText(cause, { domain: 'project', fallback: '小阶段推进失败' });
  } finally {
    subStageAdvancing.value = false;
  }
}

/** L2 AI 入口 adopt 回传（C08 零直写）：建议仅落本地暂存提示，由真人复核后走既有端点手动操作。 */
const adoptedAi = ref<{ markdown: string; scene: string } | null>(null);
function onAiAdopt(payload: { markdown: string; scene: string }): void {
  adoptedAi.value = payload;
}


// ---------- R236 AI 任务状态 ----------

const aiTasks = ref<AiAgentTaskView[]>([]);
const aiTasksLoaded = ref(false);
const aiTasksLoading = ref(false);
const reviewDocuments = ref<AiDocument[]>([]);
const reviewDocumentsLoaded = ref(false);
const agentRuns = ref<AgentRunListItem[]>([]);
const agentRunsLoaded = ref(false);
const workbenchTodos = ref<WorkbenchTask[]>([]);
const workbenchTodosLoaded = ref(false);
const browsedChecklist = ref<GateChecklistView | null>(null);

/** 按 stageActionId 归并最新一条任务（create_time DESC，后端已排序，取首条即最新）。 */
const aiTaskByActionId = computed(() => {
  const map = new Map<string, AiAgentTaskView>();
  for (const task of aiTasks.value) {
    const key = task.stageActionId ? String(task.stageActionId) : '';
    if (key && !map.has(key)) map.set(key, task);
  }
  return map;
});

/** 按 actionCode 归并最新一条任务（stageActionId 缺失时的回退匹配）。 */
const aiTaskByCode = computed(() => {
  const map = new Map<string, AiAgentTaskView>();
  for (const task of aiTasks.value) {
    const key = task.actionCode ?? '';
    if (key && !map.has(key)) map.set(key, task);
  }
  return map;
});

/** 获取动作对应的 AI 任务（优先 stageActionId 精确匹配，回退 actionCode）。 */
function taskForAction(action: Record<string, any>): AiAgentTaskView | undefined {
  return aiTaskByActionId.value.get(String(action.id))
    ?? aiTaskByCode.value.get(action.actionCode ?? '');
}

/** 获取动作的 execMode（优先从 AI 任务取，回退静态 69 码映射）。 */
function execModeForAction(action: Record<string, any>): string {
  const task = taskForAction(action);
  if (task?.execMode) return task.execMode;
  return ACTION_EXEC_MODE[action.actionCode ?? ''] ?? '';
}

/** 是否需人工确认（AI_GENERATE = 草稿待人审；HUMAN_GATE = 否决项必须人判）。 */
function needsHumanReview(action: Record<string, any>): boolean {
  const mode = execModeForAction(action);
  return mode === 'AI_GENERATE' || mode === 'HUMAN_GATE';
}

async function loadAiTasks(): Promise<void> {
  aiTasksLoading.value = true;
  try {
    aiTasks.value = await fetchAiAgentTasksByProject(projectId.value);
    aiTasksLoaded.value = true;
  } catch {
    // AI 任务加载失败不阻断主页面（降级为无 AI 状态展示）
    aiTasks.value = [];
    aiTasksLoaded.value = false;
  } finally {
    aiTasksLoading.value = false;
  }
}

/** 链头列表只含 v1。待审核以 versions 最后一版为准；任一链失败则整格写明文档列表没加载。 */
async function loadReviewDocuments(): Promise<void> {
  try {
    const heads = await listAiDocumentsByProject(projectId.value);
    const latest = await Promise.all(heads.map(async (head) => {
      const versions = await listAiDocumentVersions(head.id);
      return versions.length > 0 ? versions[versions.length - 1] ?? head : head;
    }));
    reviewDocuments.value = latest;
    reviewDocumentsLoaded.value = true;
  } catch {
    reviewDocuments.value = [];
    reviewDocumentsLoaded.value = false;
  }
}

/** 项目智能体运行和待办只读接入。失败保持未加载，工作区写明哪份列表没加载。 */
async function loadWorkspaceFacts(): Promise<void> {
  await Promise.all([
    loadReviewDocuments(),
    listProjectAgentRuns(projectId.value, { limit: 50 })
      .then((rows) => {
        agentRuns.value = Array.isArray(rows) ? rows : [];
        agentRunsLoaded.value = Array.isArray(rows);
      })
      .catch(() => {
        agentRuns.value = [];
        agentRunsLoaded.value = false;
      }),
    fetchWorkbenchTasks({ bucket: 'pending', limit: 50, projectId: projectId.value })
      .then((view) => {
        workbenchTodos.value = Array.isArray(view.tasks) ? view.tasks : [];
        workbenchTodosLoaded.value = Array.isArray(view.tasks);
      })
      .catch(() => {
        workbenchTodos.value = [];
        workbenchTodosLoaded.value = false;
      }),
  ]);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [detail, rows, stageRows] = await Promise.all([
      getProject(projectId.value),
      listStageActions(projectId.value),
      // 阶段清单（P3-6.1）：失败吞掉回退 STAGE_ORDER 骨架，与 gate-checklist 同口径不断链。
      listProjectStages(projectId.value).catch(() => [] as ProjectStageRow[]),
    ]);
    project.value = detail;
    actions.value = rows;
    serverStages.value = stageRows;
    await Promise.all([loadChecklist(), loadAiTasks(), loadSubStageProgress(), loadWorkspaceFacts()]);
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** 阶段清单数据源（GET /projects/{id}/stages 服务端真值；空=回退 STAGE_ORDER 骨架）。 */
const serverStages = ref<ProjectStageRow[]>([]);

/** 归一阶段序列：服务端 stages 按 sortOrder 升序（title 取 stageName），缺数据回退六阶段骨架。 */
const stageSequence = computed<Array<{ code: null | string; label: string }>>(() => {
  if (serverStages.value.length === 0) return STAGE_ORDER;
  return [...serverStages.value]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stage) => ({ code: stage.code, label: stage.name ?? stageText(stage.code) }));
});

const currentStageIndex = computed(() => {
  const index = stageSequence.value.findIndex((stage) => stage.code === project.value?.currentStage);
  return index >= 0 ? index : 0;
});

const stepItems = computed(() =>
  stageSequence.value.map((stage, index) => ({
    title: stage.label,
    status:
      index < currentStageIndex.value
        ? ('finish' as const)
        : index === currentStageIndex.value
          ? ('process' as const)
          : ('wait' as const),
  })),
);

const viewStageIndex = ref<number | null>(null);
const activeViewIndex = computed(() => {
  const index = viewStageIndex.value;
  const length = stageSequence.value.length;
  if (index == null || index < 0 || index >= length) return currentStageIndex.value;
  return index;
});
const viewedStage = computed(() => stageSequence.value[activeViewIndex.value]);

/** 阶段轨只切换总览视图，不调用阶段推进。浏览阶段的门禁由单独的只读请求加载。 */
function selectStageView(index: number): void {
  viewStageIndex.value = index;
}

/** 浏览其他阶段时另读该阶段门禁，不调用推进。当前阶段仍用页面已加载的清单。 */
async function loadBrowsedChecklist(code: null | string): Promise<void> {
  if (!code || !project.value || code === project.value.currentStage) return;
  if (checklist.value?.stage === code) return;
  try {
    const view = await getGateChecklist(projectId.value, code);
    if ((viewedStage.value?.code ?? null) !== code) return;
    browsedChecklist.value = view.stage === code ? view : null;
  } catch {
    if ((viewedStage.value?.code ?? null) !== code) return;
    browsedChecklist.value = null;
  }
}

watch(() => viewedStage.value?.code ?? null, (code) => {
  void loadBrowsedChecklist(code);
});

const viewedChecklist = computed(() => {
  const code = viewedStage.value?.code ?? null;
  if (!code) return null;
  if (checklist.value?.stage === code) return checklist.value;
  if (browsedChecklist.value?.stage === code) return browsedChecklist.value;
  return null;
});

const workspaceInput = computed(() => ({
  actions: actions.value,
  catalogLoaded: subStageCatalogLoaded.value,
  checklistItems: viewedChecklist.value?.items ?? [],
  checklistLoaded: viewedChecklist.value != null,
  checklistStage: viewedChecklist.value?.stage ?? null,
  currentChecklistItems: checklist.value?.items ?? [],
  currentChecklistLoaded: checklist.value != null,
  currentChecklistStage: checklist.value?.stage ?? null,
  currentStageCode: project.value?.currentStage ?? null,
  currentStageId: serverStages.value.find((stage) => stage.code === project.value?.currentStage)?.id ?? null,
  currentSubStageCode: subStageProgress.value?.currentSubStageCode ?? null,
  documents: reviewDocuments.value.map((doc) => ({ id: doc.id, status: doc.status, title: doc.title })),
  documentsLoaded: reviewDocumentsLoaded.value,
  runs: agentRuns.value.map((run) => ({
    actionCode: run.actionCode,
    artifactTitles: Array.isArray(run.artifactTitles) ? run.artifactTitles : [],
    status: run.status,
  })),
  runsLoaded: agentRunsLoaded.value,
  stageCode: viewedStage.value?.code ?? null,
  stageId: serverStages.value.find((stage) => stage.code === viewedStage.value?.code)?.id ?? null,
  subStageLoaded: subStageProgress.value != null,
  subStages: subStages.value,
  tasks: aiTasks.value,
  tasksLoaded: aiTasksLoaded.value,
  todos: workbenchTodos.value.map((task) => ({
    actionCode: task.actionCode,
    status: task.status,
    taskType: task.taskType,
    title: task.title,
  })),
  todosLoaded: workbenchTodosLoaded.value,
}));

/** 动作统计（全项目）。
 *  D7 修复（2026-10-06）：完成度分子改为 DONE/NA 口径（与工作台一致）；此前误用验收口径
 *  （DONE 且已确认人），真库 9140005 曾把 P01/C05 两个已完成待批准动作漏算成 2/16（实为 3/16）。
 *  pendingApproval 单列提示；blockingOpen 仍按门禁口径（阻断性未完成）计。 */
const actionStats = computed(() => {
  const total = actions.value.length;
  const completed = (action: { status: string }) =>
    action.status === 'NA' || action.status === 'DONE';
  const accepted = (action: { confirmedBy?: null | string; status: string }) =>
    action.status === 'NA' || (action.status === 'DONE' && !!action.confirmedBy);
  const done = actions.value.filter((action) => completed(action)).length;
  const pendingApproval = actions.value.filter(
    (action) => action.status === 'DONE' && !action.confirmedBy,
  ).length;
  const blockingOpen = actions.value.filter(
    (action) => action.isBlocking === '1' && !accepted(action),
  ).length;
  return { blockingOpen, done, pendingApproval, total };
});

const atLifecycle = computed(() => project.value?.currentStage === 'LIFECYCLE');

// ---------- 阶段推进与门禁清单 ----------

const advancing = ref(false);
const advanceError = ref('');
const checklist = ref<GateChecklistView | null>(null);
const checklistLoading = ref(false);
let checklistToken = 0;

/** 刷新当前阶段门禁。点击事件不能当作阶段参数传入。 */
function refreshChecklist(): void {
  void loadChecklist();
}

/** 读取门禁清单。传入阶段时只读该阶段，不推进项目。后返回的旧请求不覆盖新视图。 */
async function loadChecklist(stage?: string): Promise<void> {
  const token = ++checklistToken;
  checklistLoading.value = true;
  try {
    const view = await getGateChecklist(projectId.value, stage);
    if (token !== checklistToken) return;
    checklist.value = view;
  } catch {
    if (token !== checklistToken) return;
    checklist.value = null;
  } finally {
    if (token === checklistToken) checklistLoading.value = false;
  }
}

const submittingStage = ref(false);

async function submitStage(): Promise<void> {
  if (submittingStage.value) return;
  submittingStage.value = true;
  advanceError.value = '';
  try {
    await submitStageAcceptance(projectId.value);
    message.success('已提交本阶段验收，等待产线负责人批准');
    await loadChecklist();
  } catch (cause) {
    advanceError.value = isTransportError(cause)
      ? '无法连接服务，请检查网络后重试'
      : ipdErrorText(cause, { domain: 'project', fallback: '提交阶段验收失败' });
  } finally {
    submittingStage.value = false;
  }
}

async function advance(): Promise<void> {
  if (advancing.value) return;
  advancing.value = true;
  advanceError.value = '';
  try {
    project.value = await advanceProjectStage(projectId.value);
    message.success(`已进入「${stageText(project.value.currentStage)}」`);
    await loadChecklist();
  } catch (cause) {
    advanceError.value = isTransportError(cause)
      ? '无法连接服务，请检查网络后重试'
      : ipdErrorText(cause, { domain: 'project', fallback: '阶段推进失败，请检查门禁清单' });
    await loadChecklist();
  } finally {
    advancing.value = false;
  }
}

const checklistColumns = [
  { key: 'name', title: '门禁项' },
  { key: 'status', title: '动作状态' },
  { key: 'ok', title: '门禁结果', width: 110 },
  { key: 'reason', title: '说明' },
];

// ---------- 动作列表 ----------

const actionColumns = [
  { dataIndex: 'actionCode', key: 'actionCode', title: '编码', width: 130 },
  { dataIndex: 'actionName', key: 'actionName', title: '动作名称' },
  { key: 'execMode', title: 'AI 模式', width: 150 },
  { key: 'depth', title: '管理类型', width: 110 },
  { key: 'status', title: '状态', width: 100 },
  { key: 'aiStatus', title: 'AI 任务', width: 130 },
  { dataIndex: 'ownerRole', key: 'ownerRole', title: '责任角色', width: 120 },
  { key: 'dueDate', title: '截止日期', width: 130 },
  { key: 'actions', title: '操作', width: 110 },
];

function openAction(row: Record<string, any>): void {
  const actionId = String(row.id ?? '');
  if (actionId) {
    router.push(`/ipd/projects/${projectId.value}/actions/${actionId}`).catch((err: unknown) => {
      message.error(`导航失败: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}

/** AI 文档跳转：直达 AI 文档助手深链（/ipd/ai-assistant?projectId=&docId=，与 todo-link 等全站入口同形态）。
 *  2026-10-06 修复：原 /ipd/ai-docs/${docId} 路径路由表从未注册（实际注册名是 ai-assistant），点击产物必 404。 */
function openAiDoc(docId: string): void {
  router.push({ path: '/ipd/ai-assistant', query: { docId, projectId: projectId.value } }).catch((err: unknown) => {
    message.error(`导航失败: ${err instanceof Error ? err.message : String(err)}`);
  });
}

const actionPagination = computed(() => ({
  current: 1,
  pageSize: 50,
  showSizeChanger: false,
  showTotal: (total: number) => `共 ${total} 条`,
}));

// ---------- 项目 SOP 快照（R215 GAP-F8；GET /sop-templates/instances?projectId=）----------

const sopOpen = ref(false);
const sopLoading = ref(false);
const sopError = ref('');
const sopInstances = ref<IpdSopInstance[]>([]);

async function loadSopInstances(): Promise<void> {
  sopLoading.value = true;
  sopError.value = '';
  try {
    sopInstances.value = await listSopTemplateInstances(projectId.value);
  } catch (cause) {
    sopInstances.value = [];
    sopError.value = isTransportError(cause)
      ? '无法连接服务，请检查网络后重试'
      : ipdErrorText(cause, { domain: 'project', fallback: 'SOP 快照加载失败，请稍后重试' });
  } finally {
    sopLoading.value = false;
  }
}

function openSopSnapshots(): void {
  sopOpen.value = true;
  void loadSopInstances();
}

/** 实例状态三色：ACTIVE 绿 / SUPERSEDED 灰 / ARCHIVED 红（未知值灰兜底原样展示）。 */
function sopStatusColor(status: string): string {
  if (status === 'ACTIVE') return 'success';
  if (status === 'ARCHIVED') return 'error';
  return 'default';
}

function sopStatusText(status: string): string {
  if (status === 'ACTIVE') return '生效中';
  if (status === 'SUPERSEDED') return '已替代';
  if (status === 'ARCHIVED') return '已归档';
  return status || '未知';
}

/**
 * 快照 JSON 视图兜底（api 层原样透传，解析归本层）：合法 JSON pretty 展开，
 * 非法则原文展示（SopTemplateInstance.snapshotJson 不可变串，BR-IPD-SOP-03）。
 */
function snapshotText(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json || '（空快照）';
  }
}

const sopColumns = [
  { dataIndex: 'instanceVersion', key: 'instanceVersion', title: '实例版本', width: 90 },
  { key: 'status', title: '状态', width: 100 },
  { dataIndex: 'instantiatedAt', key: 'instantiatedAt', title: '实例化时间', width: 210 },
  { dataIndex: 'instantiatedBy', key: 'instantiatedBy', title: '实例化人', width: 140 },
  { dataIndex: 'templateId', key: 'templateId', title: '模板 ID', width: 190 },
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card v-if="loading" class="text-center">
      <Spin>正在加载 IPD 流程……</Spin>
    </Card>

    <Alert
      v-else-if="loadError"
      :message="isTransportError(loadError)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(loadError, { domain: 'project', fallback: 'IPD 流程加载失败，请稍后重试' })"
      show-icon
      type="error"
    >
      <template #description>
        <Button size="small" @click="load">重新加载</Button>
      </template>
    </Alert>

    <template v-else-if="project">
      <Card title="阶段进度">
        <Steps :current="currentStageIndex" :items="stepItems" @change="selectStageView" />
        <div class="text-muted-foreground mt-3 text-xs">
          当前阶段：<Tag :color="stageColor(project.currentStage)">{{ stageText(project.currentStage) }}</Tag>
          动作完成 {{ actionStats.done }}/{{ actionStats.total }}<span v-if="actionStats.pendingApproval">（其中 {{ actionStats.pendingApproval }} 项已完成、待批准）</span>；
          阻断性未完成 {{ actionStats.blockingOpen }} 项
        </div>
        <StageWorkspace
          v-if="viewedStage"
          :input="workspaceInput"
          :stage-label="viewedStage.label"
        />
      </Card>

      <Card title="阶段推进">
        <Alert
          v-if="advanceError"
          class="mb-4"
          :message="advanceError"
          show-icon
          type="error"
        />
        <Space wrap>
          <Button
            v-if="!atLifecycle"
            :loading="advancing"
            type="primary"
            @click="advance"
          >
            进入下一阶段
          </Button>
          <Button
            v-if="!atLifecycle"
            :loading="submittingStage"
            @click="submitStage"
          >
            提交阶段验收
          </Button>
          <Button :loading="checklistLoading" @click="refreshChecklist">刷新门禁清单</Button>
        </Space>
        <div v-if="atLifecycle" class="text-muted-foreground mt-2 text-sm">
          已处于生命周期阶段（最终阶段），无后续阶段推进。
        </div>

        <div v-if="checklist" class="mt-4">
          <div class="mb-2 text-sm font-medium">
            门禁清单（{{ stageText(checklist.stage ?? project.currentStage) }} /
            配置版本 {{ checklist.configVersion || '待补充' }}）
          </div>
          <Table
            :columns="checklistColumns"
            :data-source="checklist.items"
            :pagination="false"
            row-key="code"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                {{ record.status ? actionStatusText(record.status) : '未开始' }}
              </template>
              <template v-else-if="column.key === 'ok'">
                <Tag :color="record.ok ? 'success' : 'error'">{{ record.ok ? '已满足' : '未满足' }}</Tag>
              </template>
              <template v-else-if="column.key === 'reason'">
                <span :class="record.ok ? 'text-muted-foreground' : 'text-red-600'">{{ gateReasonText(record.reason, record.status) }}</span>
              </template>
            </template>
          </Table>
        </div>
        <div v-else-if="!checklistLoading" class="text-muted-foreground mt-4 text-sm">
          门禁清单暂不可用（当前阶段可能无配置），以推进按钮返回的服务端校验结果为准。
        </div>
      </Card>

      <Card title="小阶段游标" data-testid="ipd-sub-stage-progress">
        <Alert v-if="subStageError" type="error" show-icon :message="subStageError" />
        <p v-if="subStageProgress">
          当前小阶段：{{ subStages.find((stage) => stage.code === subStageProgress?.currentSubStageCode)?.name ?? subStageProgress.currentSubStageCode ?? '尚未开始' }}；版本 {{ subStageProgress.version }}
        </p>
        <Space wrap>
          <Select
            v-model:value="targetSubStageCode"
            aria-label="目标小阶段"
            :options="subStageOptions"
            placeholder="选择下一小阶段"
            style="min-width: 220px"
          />
          <Popconfirm title="确认推进此项目的小阶段？服务端将校验顺序和门禁。" @confirm="confirmSubStageAdvance">
            <Button :disabled="!subStageProgress || !targetSubStageCode || subStageLoading" :loading="subStageAdvancing">确认推进小阶段</Button>
          </Popconfirm>
          <Button :loading="subStageLoading" @click="loadSubStageProgress">刷新游标</Button>
        </Space>
        <p class="text-muted-foreground mt-2 text-xs">选择仅为操作意图；服务端按项目成员、当前阶段、顺序、门禁和版本裁定。</p>
      </Card>

      <!-- L2 每页 AI 入口（2026-09-28）：项目时间线叙事（projectId 实体上下文驱动，userPrompt 可空；采纳仅回传宿主，C08 零直写） -->
      <div>
        <AiSuggest
          scene="timeline.storyline"
          :project-id="projectId"
          adoptable
          label="AI 时间线叙事"
          data-testid="pd-flow-ai-storyline"
          @adopt="onAiAdopt"
        />
        <p v-if="adoptedAi" class="text-muted-foreground mt-2 text-xs" data-testid="pd-flow-ai-adopted">
          AI 建议已回传宿主（{{ adoptedAi.scene }}）：仅草稿不写库，请人工复核后手动操作。
        </p>
      </div>

      <Card title="阶段动作（全项目）">
        <template #extra>
          <Space>
            <Button :loading="aiTasksLoading" size="small" @click="loadAiTasks">刷新 AI 状态</Button>
            <Button size="small" @click="openSopSnapshots">项目 SOP 快照</Button>
          </Space>
        </template>
        <Table
          :columns="actionColumns"
          :data-source="actions"
          :pagination="actionPagination"
          :scroll="{ x: 1200 }"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'execMode'">
              <Tooltip :title="execModeForAction(record) || '未配置'">
                <Tag :color="execModeTone(execModeForAction(record))">
                  {{ execModeText(execModeForAction(record)) }}
                </Tag>
                <span
                  v-if="needsHumanReview(record)"
                  class="ml-1 text-xs text-orange-600"
                >需人工确认</span>
              </Tooltip>
            </template>
            <template v-else-if="column.key === 'depth'">
              <Tag :color="depthColor(record.depth)">{{ depthText(record.depth) }}</Tag>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="actionStatusColor(record.status)">{{ actionStatusText(record.status) }}</Tag>
            </template>
            <template v-else-if="column.key === 'aiStatus'">
              <template v-if="taskForAction(record)">
                <Tag
                  :color="aiTaskStatusTone(taskForAction(record)!.status)"
                  :class="{ 'font-bold': taskForAction(record)!.status === 'DEAD' }"
                >
                  {{ aiTaskStatusText(taskForAction(record)!.status) }}
                </Tag>
                <Tooltip v-if="taskForAction(record)!.status === 'DEAD'" title="≥3 次退避失败，已转人工介入">
                  <span class="ml-1 text-xs text-red-600">⚠ 人工介入</span>
                </Tooltip>
                <Button
                  v-if="taskForAction(record)!.status === 'SUCCEEDED' && taskForAction(record)!.aiDocId"
                  class="ml-1"
                  size="small"
                  type="link"
                  @click="openAiDoc(String(taskForAction(record)!.aiDocId))"
                >产物</Button>
              </template>
              <span v-else class="text-muted-foreground text-xs">—</span>
            </template>
            <template v-else-if="column.key === 'ownerRole'">
              {{ roleText(record.ownerRole) }}
            </template>
            <template v-else-if="column.key === 'dueDate'">
              {{ record.dueDate ? projectDateText(record.dueDate) : '—' }}
            </template>
            <template v-else-if="column.key === 'actions'">
              <Button size="small" type="link" @click="openAction(record)">查看详情</Button>
            </template>
          </template>
        </Table>
        <div class="text-muted-foreground mt-2 text-xs">
          标注「需交付物」的动作完成时需上传交付物，「免交付物」的动作填写实际完成日期（可加备注）即可，均在动作详情页操作。
          <span class="ml-2">AI 模式说明：<Tag color="processing" size="small">AI 直接执行</Tag>全自动
            <Tag class="ml-1" color="warning" size="small">AI 生成草稿</Tag>草稿待人审
            <Tag class="ml-1" color="error" size="small">人工评审 Gate</Tag>否决项必须人判（AI 不代签）。</span>
        </div>
      </Card>

      <Drawer v-model:open="sopOpen" title="项目 SOP 快照" width="720">
        <Alert v-if="sopError" class="mb-3" :message="sopError" show-icon type="error">
          <template #description>
            <Button size="small" @click="loadSopInstances">重试</Button>
          </template>
        </Alert>
        <div v-else-if="sopLoading" class="py-8 text-center">
          <Spin>正在加载 SOP 快照……</Spin>
        </div>
        <div v-else-if="!sopInstances.length" class="text-muted-foreground text-sm">
          本项目尚无 SOP 实例快照（模板实例化随立项流程产生，此读口按项目维度列出历史快照）。
        </div>
        <Table
          v-else
          :columns="sopColumns"
          :data-source="sopInstances"
          :pagination="false"
          :scroll="{ x: 760 }"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <Tag :color="sopStatusColor(record.status)">{{ sopStatusText(record.status) }}</Tag>
            </template>
            <template v-else-if="column.key === 'instantiatedAt'">
              {{ record.instantiatedAt ?? '—' }}
            </template>
            <template v-else-if="column.key === 'instantiatedBy'">
              {{ record.instantiatedBy ?? '—' }}
            </template>
          </template>
          <template #expandedRowRender="{ record }">
            <div class="text-muted-foreground mb-1 text-xs">
              实例 {{ record.id }} ｜ 实例化后即为快照，不随模板后续修改变化
            </div>
            <pre class="bg-muted max-h-64 overflow-auto rounded p-2 text-xs">{{ snapshotText(record.snapshotJson) }}</pre>
          </template>
          <template #emptyText>
            <span>本项目尚无 SOP 实例快照</span>
          </template>
        </Table>
      </Drawer>
    </template>
  </div>
</template>
