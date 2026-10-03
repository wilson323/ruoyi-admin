<script lang="ts" setup>
/**
 * 全局 AI 副驾（R215 AI 融合批次3 = AI-FUSION-B3）。
 *
 * 挂载于 layouts/ipd.vue：所有 IPD 页面共享同一入口（浮钮 + 右抽屉）。
 * 走后端 AiCopilotService 的项目、个人、已审核文档与同租户公共知识上下文——
 * 前端只传 message + 当前项目 id，上下文由后端注入（不教 AI 编数据）。
 *
 * 交互契约：
 * - 默认 SSE 真流式（meta/delta/done/error 四帧），token 逐段渲染；
 * - 多轮 history 只回传最近 8 轮（后端上限，超出前端裁剪）；
 * - BR-AI-04：不做内容过滤，UI 常驻风险提示；
 * - 关闭抽屉即 AbortController 断流（60s SSE 超时前主动止）。
 *
 * P2-02（R232 批次7）done 帧双事件分发：done 帧可选超集携 card（P2-01 四键
 * AiCardEnvelope）时走双通道——① 既有 ipd:ai-fill-payload 文本/填表回填（R221，行为
 * 零回归）；② 卡片分发通道 `ipd:ai-card` CustomEvent（载荷=过检后四键信封）+ 按
 * (type, version) 注册表分发渲染（容器 ipd-ai-card-host），宿主可订阅渲染结构化建议卡。
 * 卡片进分发/渲染前过三渲染铁律：R2 schema 外字段丢弃+留痕、R3 卡片数值与 sourceRefs
 * 对账（不平拒出卡降级纯文本）。card 缺席/非法/对账不平：置 null 不派发不崩不断对话流
 * （ipd-ai-card-notice 提示后对话继续）；卡片渲染抛错降级（ipd-ai-card-degraded）；
 * confirm 只收组件 emit 零直写（C08 铁律：卡片层零直写，真人提交走既有端点）；
 * 新轮/新会话清上一轮卡片态。
 * 信封守卫复用 api/ipd/ai-copilot 的 parseStreamDone（import 复用，禁复制校验逻辑防双轨）。
 *
 * P3-01（2026-09-28 CopilotKit 单轨融合）：宿主挂 CopilotKitProvider（runtimeUrl=
 * /api/copilotkit，Bearer header 鉴权，契约 docs/copilotkit单轨融合契约-20260928.md）
 * + IpdAiCardRenderHost 渲染层（4 卡 useRenderTool = 注册表组件 + useDefaultRenderTool
 * 兜底）。单轨红线：不开第二个聊天 UI、不建平行卡片体系、不删文本降级路径；既有四帧
 * 文本/卡片通道零回归。
 *
 * AI 模式主发送走 ProjectAgentPanel.submitText（createProjectAgentRun），
 * 不回落 streamCopilot；副驾模式仍走 streamCopilot。
 * 业务模式与抽屉尺寸是两种独立状态；切换业务模式会中止并清空旧会话，
 * 避免副驾与项目智能体共用请求与卡片。
 */
import {
  computed,
  nextTick,
  onErrorCaptured,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { CopilotKitProvider } from '@copilotkit/vue/v2';
import {
  PhArrowsIn as CollapseIcon,
  PhArrowsOut as ExpandIcon,
  PhSparkle as Sparkles,
} from '@phosphor-icons/vue';
import {
  Alert,
  Drawer,
  message as antMessage,
} from 'ant-design-vue';

import {
  parseStreamDone,
  streamCopilot,
  type CopilotDataItem,
  type CopilotStreamDone,
} from '../../../api/ipd/ai-copilot';

import { getCardType } from './ai-cards/card-registry';
import AssistantTurn from './assistant-turn.vue';
import AiLoadingState from './ai-loading-state.vue';
import AiComposer, {
  formatAttachmentSize,
  type ComposerAttachment,
} from './ai-composer.vue';
import {
  copilotKitAuthHeaders,
  IpdAiCardRenderHost,
} from './ai-cards/copilotkit-render';
import IpdAiWorkspace from './ai-workspace/ai-workspace.vue';
import { useIpdAiWorkspace } from './ai-workspace/use-ai-workspace';
import type { WorkspaceMode, WorkspacePane } from './ai-workspace/workspace-mode';
import { fetchGuideEvents } from '../../../api/ipd/guide-script';
import { listProjects, type Project } from '../../../api/ipd/project';
import { fetchSubStages, type SubStage, type SubStageAction } from '../../../api/ipd/stage-sub-stages';
import {
  buildGuideContextValue,
  buildGuideSuggestions,
  extractGuideText,
  parseGuideSteps,
} from './ai-guide/guide-script';
import { IpdGuideScriptHost } from './ai-guide/guide-script-host';
import { IpdSwarmProgressHost } from './ai-swarm/swarm-progress-host';
import GuideSuggestionBar from './ai-guide/guide-suggestion-bar.vue';
import DocumentVersionReview from './ai-agent/document-version-review.vue';
import ProjectAgentPanel from './ai-agent/project-agent-panel.vue';
import { clarificationSendText, type ClarificationChoice } from './ai-agent/clarification-choices';
import { timelineTranscript } from './ai-agent/timeline-model';
import type { AgentRunEvent } from '../../../api/ipd/project-agent';
import StageStepNav from './ai-workspace/stage-step-nav.vue';
import { ipdErrorText } from './ipd-error-text';
import type {
  AiCardData,
  AiCardEnvelope,
  AiCardType,
  DemandDraftCardData,
  DemandDraftRequirementData,
  GateConclusionCardData,
  GateConclusionReviewData,
  GatePrecheckCardData,
  GatePrecheckItemData,
  ProjectCharterCardData,
} from './ai-cards/types';

/* -------------------------------------------------------------------------- */
/* P2-02 卡片过检层（三渲染铁律 R2/R3）：done 帧 card 进派发/渲染前的收窄。      */
/* -------------------------------------------------------------------------- */

/** R1 信封键面白名单（四键零增删；envelope 层 R2 丢弃依据）。 */
const ENVELOPE_KEYS = {
  data: true,
  sourceRefs: true,
  type: true,
  version: true,
} as const;

/**
 * R1 schema 对账镜像：`satisfies Record<keyof T, true>` 编译期钉死键面零增删——
 * types.ts 字段增删即本处编译失败（防镜像单侧漂移）；运行期作 R2 丢弃白名单。
 */
const DEMAND_DRAFT_DATA_KEYS = {
  contextProjectCode: true,
  contextProjectId: true,
  contextProjectName: true,
  requirements: true,
} satisfies Record<keyof DemandDraftCardData, true>;
const DEMAND_DRAFT_ITEM_KEYS = {
  requirementId: true,
  source: true,
  status: true,
  title: true,
} satisfies Record<keyof DemandDraftRequirementData, true>;
const GATE_CONCLUSION_DATA_KEYS = {
  conditionalCount: true,
  failCount: true,
  gateCode: true,
  passCount: true,
  reviews: true,
} satisfies Record<keyof GateConclusionCardData, true>;
const GATE_CONCLUSION_ITEM_KEYS = {
  decision: true,
  opinion: true,
  reviewerType: true,
  round: true,
} satisfies Record<keyof GateConclusionReviewData, true>;
const GATE_PRECHECK_DATA_KEYS = {
  gateCode: true,
  items: true,
  reviewCount: true,
  round: true,
  totalElements: true,
} satisfies Record<keyof GatePrecheckCardData, true>;
const GATE_PRECHECK_ITEM_KEYS = {
  conditionNote: true,
  elementId: true,
  evidenceRef: true,
  leftoverStatus: true,
  result: true,
} satisfies Record<keyof GatePrecheckItemData, true>;
const PROJECT_CHARTER_DATA_KEYS = {
  contextCurrentStage: true,
  contextProductId: true,
  contextProjectCode: true,
  contextProjectId: true,
  contextProjectName: true,
} satisfies Record<keyof ProjectCharterCardData, true>;

/** 逐卡 schema 镜像：data 键面白名单 + 数组行键面白名单 + sourceRefs 键面（= Catalog 清单）。 */
interface CardSchemaMirror {
  data: Readonly<Record<string, true>>;
  items: Readonly<Record<string, Readonly<Record<string, true>>>>;
  sourceRefs: Readonly<Record<string, true>>;
}

const CARD_SCHEMA_MIRRORS: Record<AiCardType, CardSchemaMirror> = {
  'demand.draft': {
    data: DEMAND_DRAFT_DATA_KEYS,
    items: { requirements: DEMAND_DRAFT_ITEM_KEYS },
    sourceRefs: { projectId: true, requirementIds: true },
  },
  'gate.conclusion': {
    data: GATE_CONCLUSION_DATA_KEYS,
    items: { reviews: GATE_CONCLUSION_ITEM_KEYS },
    sourceRefs: { elementResultIds: true, gateId: true, reviewIds: true },
  },
  'gate.precheck': {
    data: GATE_PRECHECK_DATA_KEYS,
    items: { items: GATE_PRECHECK_ITEM_KEYS },
    sourceRefs: { elementResultIds: true, gateId: true, reviewIds: true },
  },
  'project.charter': {
    data: PROJECT_CHARTER_DATA_KEYS,
    items: {},
    sourceRefs: { projectId: true },
  },
};

/** 运行期对象判别（与 api/ipd 防御性解析同款形态；本层不 import 私有函数防双轨）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * R2 铁律：schema 外字段丢弃 + 留痕（console.debug 与 action-detail onAiFill 同口径）。
 * 四层丢弃面：card. / data. / data.<arr>[i]. / sourceRefs.（mode 等非链路键同口径丢弃，
 * 与无该键全等——mode 非链路输入防御性忽略）；数组非对象行保留原样交渲染层
 * onErrorCaptured 降级（不静默吞行）。返回白名单内字段的安全浅副本。
 */
function dropSchemaExtra(
  raw: Record<string, unknown>,
  keep: Readonly<Record<string, true>>,
  arrayRowKeys:
    | Readonly<Record<string, Readonly<Record<string, true>>>>
    | undefined,
  prefix: string,
  dropped: string[],
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.prototype.hasOwnProperty.call(keep, key)) {
      safe[key] = value;
    } else {
      dropped.push(`${prefix}${key}`);
    }
  }
  for (const [field, rowKeys] of Object.entries(arrayRowKeys ?? {})) {
    const rows = safe[field];
    if (Array.isArray(rows)) {
      safe[field] = rows.map((row, index) =>
        isPlainRecord(row)
          ? dropSchemaExtra(
              row,
              rowKeys,
              undefined,
              `${prefix}${field}[${index}].`,
              dropped,
            )
          : row,
      );
    }
  }
  return safe;
}

/**
 * R3 铁律：卡片数值与 sourceRefs 源表引用逐项对账（无 LLM 复述值兜底）。
 * 对账矩阵（与后端 AiSuggestionCardR2R3Test 同口径）：
 * - gate.precheck：reviewCount↔reviewIds 数、totalElements↔elementResultIds 数、
 *   items↔elementResultIds 数；
 * - gate.conclusion：reviews↔reviewIds 数、passCount+conditionalCount+failCount↔
 *   elementResultIds 数；
 * - project.charter：contextProjectId↔projectId；
 * - demand.draft：contextProjectId↔projectId、requirements↔requirementIds 数、
 *   requirementId∈requirementIds。
 * 返回违规清单（空 = 对账平）；引用值标量记 1（sourceRefs 值 = number|string|string[]）。
 */
function reconcileCardViolations(
  type: AiCardType,
  data: Record<string, unknown>,
  refs: Record<string, unknown>,
): string[] {
  const violations: string[] = [];
  const refCount = (value: unknown): number =>
    Array.isArray(value) ? value.length : 1;
  const refKeys = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).map((item) => String(item));
  const dataCount = (value: unknown): number | null =>
    Array.isArray(value) ? value.length : null;
  if (type === 'gate.precheck') {
    const reviewIds = refCount(refs.reviewIds);
    const elementResultIds = refCount(refs.elementResultIds);
    const items = dataCount(data.items);
    if (Number(data.reviewCount) !== reviewIds) {
      violations.push(
        `reviewCount=${String(data.reviewCount)}↔reviewIds=${reviewIds}`,
      );
    }
    if (Number(data.totalElements) !== elementResultIds) {
      violations.push(
        `totalElements=${String(data.totalElements)}↔elementResultIds=${elementResultIds}`,
      );
    }
    if (items === null || items !== elementResultIds) {
      violations.push(
        `items=${items ?? '缺失'}↔elementResultIds=${elementResultIds}`,
      );
    }
  } else if (type === 'gate.conclusion') {
    const reviewIds = refCount(refs.reviewIds);
    const elementResultIds = refCount(refs.elementResultIds);
    const reviews = dataCount(data.reviews);
    const voteSum =
      Number(data.passCount) +
      Number(data.conditionalCount) +
      Number(data.failCount);
    if (reviews === null || reviews !== reviewIds) {
      violations.push(`reviews=${reviews ?? '缺失'}↔reviewIds=${reviewIds}`);
    }
    if (voteSum !== elementResultIds) {
      violations.push(
        `passCount+conditionalCount+failCount=${voteSum}↔elementResultIds=${elementResultIds}`,
      );
    }
  } else if (type === 'project.charter') {
    if (String(data.contextProjectId) !== String(refs.projectId)) {
      violations.push(
        `contextProjectId=${String(data.contextProjectId)}↔projectId=${String(refs.projectId)}`,
      );
    }
  } else {
    const requirementIds = refCount(refs.requirementIds);
    const allowed = refKeys(refs.requirementIds);
    const requirements = dataCount(data.requirements);
    if (String(data.contextProjectId) !== String(refs.projectId)) {
      violations.push(
        `contextProjectId=${String(data.contextProjectId)}↔projectId=${String(refs.projectId)}`,
      );
    }
    if (requirements === null || requirements !== requirementIds) {
      violations.push(
        `requirements=${requirements ?? '缺失'}↔requirementIds=${requirementIds}`,
      );
    }
    for (const row of Array.isArray(data.requirements)
      ? data.requirements
      : []) {
      const id = isPlainRecord(row) ? row.requirementId : undefined;
      if (id !== undefined && !allowed.includes(String(id))) {
        violations.push(`requirementId=${String(id)}∉requirementIds`);
      }
    }
  }
  return violations;
}

/** 过检结果：ok=false → 调用方拒出卡降级纯文本提示（不断对话流）。 */
type CardCheckResult =
  | { card: AiCardEnvelope; component: Component; ok: true }
  | { ok: false; reason: string };

/**
 * 卡片过检总入口（P2-02）：结构复验 → 注册表命中 → R2 丢弃留痕 → R3 对账。
 * 任一不过 = 拒出卡（reason 提示 + 降级纯文本），绝不带病派发/渲染。
 */
function enforceCardRenderRules(raw: AiCardEnvelope): CardCheckResult {
  // 结构复验（parseCardEnvelope 只验键存在性，此处不信 TS 标注重验形态）
  if (
    typeof raw.type !== 'string' ||
    typeof raw.version !== 'number' ||
    !isPlainRecord(raw.data) ||
    !isPlainRecord(raw.sourceRefs)
  ) {
    return {
      ok: false,
      reason:
        '卡片信封结构非法（type/version/data/sourceRefs 形态不符），已忽略，对话继续',
    };
  }
  const entry = getCardType(raw.type, raw.version);
  if (!entry?.component) {
    return {
      ok: false,
      reason: `未知卡片（type=${raw.type} version=${raw.version}）未命中注册表，已忽略，对话继续`,
    };
  }
  const mirror = CARD_SCHEMA_MIRRORS[raw.type as AiCardType];
  // R2：四层 schema 外字段丢弃 + console.debug 留痕
  const dropped: string[] = [];
  const envelope = dropSchemaExtra(
    raw as unknown as Record<string, unknown>,
    ENVELOPE_KEYS,
    undefined,
    'card.',
    dropped,
  );
  const data = dropSchemaExtra(
    envelope.data as Record<string, unknown>,
    mirror.data,
    mirror.items,
    'data.',
    dropped,
  );
  const sourceRefs = dropSchemaExtra(
    envelope.sourceRefs as Record<string, unknown>,
    mirror.sourceRefs,
    undefined,
    'sourceRefs.',
    dropped,
  );
  if (dropped.length > 0) {
    console.debug('[ipd:ai-card] R2 schema 外字段已丢弃', dropped.join('、'));
  }
  // R3 前置：sourceRefs 必备键齐（= Catalog 清单），缺键即对账不平
  const missingRefs = Object.keys(mirror.sourceRefs).filter(
    (key) => !(key in sourceRefs) || sourceRefs[key] == null,
  );
  if (missingRefs.length > 0) {
    return {
      ok: false,
      reason: `卡片与 sourceRefs 对账不平（缺必备键 ${missingRefs.join('、')}），已拒出卡降级纯文本，对话继续`,
    };
  }
  // R3：卡片数值 ↔ sourceRefs 对账
  const violations = reconcileCardViolations(
    raw.type as AiCardType,
    data,
    sourceRefs,
  );
  if (violations.length > 0) {
    return {
      ok: false,
      reason: `卡片数值与 sourceRefs 对账不平（${violations.join('；')}），已拒出卡降级纯文本，对话继续`,
    };
  }
  return {
    card: {
      type: raw.type,
      version: raw.version,
      data: data as unknown as AiCardData,
      sourceRefs: sourceRefs as AiCardEnvelope['sourceRefs'],
    },
    component: entry.component,
    ok: true,
  };
}

/** 会话消息（role 与后端 CopilotTurn 对齐；assistant 附流式状态、来源和 meta 里的结构化条目）。 */
interface ChatMessage {
  content: string;
  intent: null | string;
  items: CopilotDataItem[] | null;
  role: 'assistant' | 'user';
  sources: null | string[];
  streaming: boolean;
}

/** 后端多轮上限 8 轮；SSE 端点契约现状不收 history（AiCopilotController.stream 构造
 *  AiCopilotReq 时 history 固定空列表），多轮上下文待后端扩展后由前端补传（B3 注记）。 */
// const MAX_HISTORY_TURNS = 8;

/** 与 layouts/ipd.vue 同 key：AI 上下文自动跟随全局当前项目。 */
const CURRENT_PROJECT_KEY = 'ipd:current-project';
/** 与顶栏同一事件：对话里切换只改选中项，不整页刷新。 */
const PROJECT_SYNC_EVENT = 'ipd:current-project-changed';

const props = defineProps<{
  projectCurrentStage?: null | string;
  stages?: Array<{ code: string; name: string }>;
}>();
/** 浏览阶段只影响工作区视图，不推进项目的服务端 currentStage。 */
/** 项目模式中间栏只留本次运行和步骤；画布、文档未接线时不占位。 */
const projectWorkspacePanes: WorkspacePane[] = ['cards', 'steps'];
const viewStageCode = ref(props.projectCurrentStage || props.stages?.[0]?.code || 'CONCEPT');
const viewStageName = computed(
  () => props.stages?.find((stage) => stage.code === viewStageCode.value)?.name ?? viewStageCode.value,
);
watch(() => props.projectCurrentStage, (stage) => {
  if (stage) viewStageCode.value = stage;
});
function selectViewStage(code: string) {
  if (props.stages?.some((stage) => stage.code === code)) viewStageCode.value = code;
}

const open = ref(false);
/** 展示尺寸：false=右抽屉；true=全屏工作界面，不决定业务模式。 */
const expanded = ref(false);
/**
 * 业务模式切换会中止并清空旧会话；AI 模式发送走项目智能体面板，不调用副驾流。
 */
const {
  activeSubStageCode,
  focusPane,
  mode: workspaceMode,
  pane: workspacePane,
  setMode,
} = useIpdAiWorkspace();
expanded.value = workspaceMode.value === 'ai';
open.value = workspaceMode.value === 'ai';
const route = useRoute();
/** 在 setup 里取路由。点击处理函数里再调 useRouter() 拿不到当前实例，跳转会被吃掉。 */
const router = useRouter();

/**
 * 查询参数只取单个字符串。
 * 布局里能读到路由；单测直接挂组件时没有路由，退回地址栏。
 */
function queryText(key: string): string {
  const value = route?.query?.[key];
  if (route?.query) return typeof value === 'string' ? value : '';
  return new URLSearchParams(window.location.search).get(key) ?? '';
}

/** 从产品线需求链接进来时打开项目智能体，发送仍走原来的创建运行。 */
function demandRequirementId(): string {
  const value = queryText('requirementId');
  return /^\d+$/.test(value) ? value : '';
}

/** 待办或动作深链上的项目编号。只接受数字，避免把任意查询写进当前项目。 */
function entryProjectId(): string {
  const value = queryText('projectId');
  return /^\d+$/.test(value) ? value : '';
}

/** 待办深链上的文档编号。只接受数字。 */
function entryDocumentId(): string {
  const value = queryText('docId');
  return /^\d+$/.test(value) ? value : '';
}

/** 待办或动作深链上的动作编码。 */
function entryActionCodeFromQuery(): string {
  const value = queryText('actionCode');
  return /^[A-Z][A-Z0-9]{0,15}$/.test(value) ? value : '';
}

const entryActionCode = ref('');
let entryEpoch = 0;

/**
 * 从待办或动作进入时带上项目和动作，并打开项目智能体。
 * 发送仍走面板里的 createProjectAgentRun。
 */
async function applyEntryFromQuery(): Promise<void> {
  const projectId = entryProjectId();
  const actionCode = entryActionCodeFromQuery();
  if (projectId) switchConversationProject(projectId);
  const epoch = ++entryEpoch;
  if (entryDocumentId()) applyMode('ai');
  entryActionCode.value = actionCode;
  sessionActionCode.value = '';
  if (!actionCode) return;
  applyMode('ai');
  await loadSubStages();
  if (epoch !== entryEpoch || (projectId && projectId !== currentProjectId.value)) return;
  const stage = subStages.value.find((item) =>
    item.actions.some((action) => action.actionCode === actionCode),
  );
  if (!stage) return;
  activeSubStageCode.value = stage.code;
  sessionActionCode.value = actionCode;
}

function applyMode(next: WorkspaceMode) {
  if (next !== workspaceMode.value) {
    abort?.abort();
    runVersion++;
    sending.value = false;
    messages.value = [];
    inputText.value = '';
    guideRequest++;
    guideSuggestions.value = [];
    guideContext.value = buildGuideContextValue('', null);
    activeSubStageCode.value = null;
    cardConfirmPayload.value = null;
    clearCardState();
  }
  setMode(next);
  if (next === 'ai') {
    expanded.value = true;
    open.value = true;
  } else {
    expanded.value = false;
    open.value = true;
  }
}
function onModeSelected(event: Event) {
  const next = (event as CustomEvent<{ mode?: string }>).detail?.mode;
  if (next === 'classic' || next === 'ai') applyMode(next);
}
onMounted(() => {
  window.addEventListener('ipd:ai-mode-select', onModeSelected);
});
onUnmounted(() => window.removeEventListener('ipd:ai-mode-select', onModeSelected));
const inputText = ref('');
const sending = ref(false);
const messages = ref<ChatMessage[]>([]);
const listRef = ref<HTMLElement>();
const guideSuggestions = ref<string[]>([]);
const guideContext = ref(buildGuideContextValue('', null));
const subStages = ref<SubStage[]>([]);
const subStageError = ref('');
const subStagesLoaded = ref(false);
let guideRequest = 0;

async function loadSubStages() {
  if (subStagesLoaded.value) return;
  try {
    const data = await fetchSubStages();
    if (!Array.isArray(data)) throw new Error('小阶段数据格式错误');
    subStages.value = data;
    subStageError.value = '';
    subStagesLoaded.value = true;
  } catch (error) {
    subStageError.value = ipdErrorText(error, { domain: 'project', fallback: '小阶段数据暂不可用' });
  }
}

watch([workspacePane, open], ([_pane, visible]) => {
  // 四区自动渲染后步骤区常驻挂载：可见即载入小阶段（pane 仅作锚点偏好）。
  if (visible) void loadSubStages();
}, { immediate: true });

const sessionActionCode = ref('');
const selectedSubStage = computed(() =>
  subStages.value.find((stage) => stage.code === activeSubStageCode.value) ?? null,
);
const sessionAction = computed((): SubStageAction | null =>
  selectedSubStage.value?.actions.find((action) => action.actionCode === sessionActionCode.value) ?? null,
);

/** 把步骤上的动作带进下一次项目智能体运行，而不是只高亮导航。 */
function selectStepAction(action: SubStageAction) {
  sessionActionCode.value = action.actionCode;
  if (!inputText.value.trim()) inputText.value = action.actionName;
}

function selectSubStage(code: string) {
  if (!currentProjectId.value) {
    subStageError.value = '请先选择有权限的项目，再查看小阶段引导';
    return;
  }
  if (code !== activeSubStageCode.value) sessionActionCode.value = '';
  activeSubStageCode.value = code;
  if (workspaceMode.value !== 'classic') return;
  window.dispatchEvent(new CustomEvent('ipd:guide-sub-stage', {
    detail: {
      projectId: currentProjectId.value || undefined,
      subStageCode: code,
    },
  }));
}

async function onGuideSubStage(event: Event) {
  if (workspaceMode.value !== 'classic') return;
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object' || !('subStageCode' in detail)) return;
  const { subStageCode, projectId } = detail as {
    projectId?: unknown;
    subStageCode?: unknown;
  };
  if (typeof subStageCode !== 'string' || !subStageCode.trim()) return;
  if (typeof projectId !== 'string' || !projectId || projectId !== currentProjectId.value) return;
  const request = ++guideRequest;
  guideSuggestions.value = [];
  try {
    const events = await fetchGuideEvents(
      subStageCode,
      projectId,
    );
    if (request !== guideRequest || workspaceMode.value !== 'classic') return;
    const steps = parseGuideSteps(events);
    guideSuggestions.value = buildGuideSuggestions(steps);
    guideContext.value = buildGuideContextValue(subStageCode, steps[0] ?? null);
    const intro = extractGuideText(events);
    if (intro) {
      messages.value.push({
        content: intro,
        intent: null,
        items: null,
        role: 'assistant',
        sources: null,
        streaming: false,
      });
      await scrollToListBottom();
    }
  } catch (error) {
    if (request !== guideRequest) return;
    guideContext.value = buildGuideContextValue('', null);
    antMessage.warning(ipdErrorText(error, { domain: 'project', fallback: '小阶段引导暂不可用' }));
  }
}

onMounted(() => window.addEventListener('ipd:guide-sub-stage', onGuideSubStage));
onUnmounted(() => {
  guideRequest++;
  window.removeEventListener('ipd:guide-sub-stage', onGuideSubStage);
});

/** P2-02 卡片分发渲染视图：命中注册表的 (component, data) 对（组件契约 = data prop + confirm emit）。 */
interface CardView {
  component: Component;
  data: AiCardData;
}

/** P2-02 卡片三态：cardView=渲染卡片容器；cardDegraded=渲染降级占位；cardNotice=非法信封提示（对话继续）。 */
const cardView = shallowRef<CardView | null>(null);
const cardDegraded = ref('');
const cardNotice = ref('');
/** 卡片 confirm hook 载荷暂存（C08 零直写：只收组件 emit，真人提交走既有端点）。 */
const cardConfirmPayload = shallowRef<AiCardData | null>(null);

const currentProjectId = ref(window.localStorage.getItem(CURRENT_PROJECT_KEY) ?? '');
const conversationProjects = ref<Project[]>([]);

/** 对话栏项目选项：名称加编号；没有编号时只显示名称。 */
function projectOptionLabel(project: Project): string {
  return project.code ? `${project.name} · ${project.code}` : project.name;
}

/** 拉取可选项目。失败时保留空列表，不编造项目。 */
async function loadConversationProjects(): Promise<void> {
  try {
    conversationProjects.value = await listProjects();
  } catch {
    conversationProjects.value = [];
  }
}

let abort: AbortController | null = null;
let runVersion = 0;

function onActiveProjectUpdated(event: Event) {
  const detail = (event as CustomEvent<{ projectId?: string }>).detail;
  const nextId = typeof detail?.projectId === 'string' ? detail.projectId : '';
  if (nextId === currentProjectId.value) return;
  currentProjectId.value = nextId;
  entryEpoch++;
  entryActionCode.value = '';
  sessionActionCode.value = '';
  abort?.abort();
  runVersion++;
  guideRequest++;
  sending.value = false;
  messages.value = [];
  inputText.value = '';
  guideSuggestions.value = [];
  guideContext.value = buildGuideContextValue('', null);
  activeSubStageCode.value = null;
  cardConfirmPayload.value = null;
  clearCardState();
}

function onProjectStorage(event: StorageEvent) {
  if (event.key === CURRENT_PROJECT_KEY) {
    onActiveProjectUpdated(new CustomEvent('ipd:active-project-updated', {
      detail: { projectId: event.newValue ?? '' },
    }));
  }
}

/**
 * 在对话栏切换项目：写入全局当前项目并清空本轮会话。
 * 不调用 location.reload，避免抽屉被整页刷新关掉。
 */
function switchConversationProject(id: string): void {
  if (!id || id === currentProjectId.value) return;
  window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  window.dispatchEvent(new CustomEvent(PROJECT_SYNC_EVENT, { detail: { projectId: id } }));
  onActiveProjectUpdated(new CustomEvent('ipd:active-project-updated', { detail: { projectId: id } }));
}

watch(
  () => [
    route?.fullPath ?? `${window.location.pathname}${window.location.search}`,
    queryText('projectId'),
    queryText('actionCode'),
    queryText('docId'),
    queryText('requirementId'),
  ],
  () => {
    if (demandRequirementId()) applyMode('ai');
    void applyEntryFromQuery();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('ipd:active-project-updated', onActiveProjectUpdated);
  window.addEventListener('storage', onProjectStorage);
  void loadConversationProjects();
  // 地址栏已经带了项目时，不用本地记住的另一个项目把阶段清掉。
  if (!entryProjectId()) {
    onActiveProjectUpdated(new CustomEvent('ipd:active-project-updated', {
      detail: { projectId: window.localStorage.getItem(CURRENT_PROJECT_KEY) ?? '' },
    }));
  }
  void applyEntryFromQuery();
});
onUnmounted(() => {
  window.removeEventListener('ipd:active-project-updated', onActiveProjectUpdated);
  window.removeEventListener('storage', onProjectStorage);
});

/** 历史裁剪（后端 SSE 契约支持后启用）：最近 8 轮成对回传，取最近。
function historyTurns(): CopilotTurn[] {
  const settled = messages.value
    .filter((m) => !m.streaming && m.content)
    .map((m) => ({ content: m.content, role: m.role }));
  return settled.slice(-MAX_HISTORY_TURNS);
}
*/

async function scrollToListBottom() {
  await nextTick();
  listRef.value?.scrollTo({
    behavior: 'smooth',
    top: listRef.value.scrollHeight,
  });
}

/** 新轮清卡片态（P2-02）：用户发新消息开启新轮时清上一轮卡片渲染态，防跨轮串态。 */
function clearCardState() {
  cardView.value = null;
  cardDegraded.value = '';
  cardNotice.value = '';
}

/** 附件清单后缀（诚实呈现：后端 /ai-copilot 无文件通道，只随消息声明名称/大小，不上传内容）。 */
function attachmentManifest(attachments: ComposerAttachment[]): string {
  if (!attachments.length) return '';
  const list = attachments
    .map((file) => `${file.name}（${formatAttachmentSize(file.size)}）`)
    .join('；');
  return `\n\n[附件清单（文件内容未上传，仅随消息声明）] ${list}`;
}

/** 项目智能体面板：主输入框把文字交给同一条 createProjectAgentRun 路径。 */
type ProjectAgentSubmitResult = 'busy' | 'failed' | 'need-project' | 'need-selection' | 'started';
const projectAgentPanelRef = ref<{
  active: boolean;
  answerClarification: (text: string) => Promise<ProjectAgentSubmitResult>;
  confirmPlan: (steps: readonly string[]) => Promise<void>;
  events: AgentRunEvent[];
  focusTaskInput: () => void;
  entryBlockReason: string;
  entryToolNote: string;
  lastTask: string;
  runActionCode: null | string;
  submitText: (text: string) => Promise<ProjectAgentSubmitResult>;
  syncReadoutTarget: () => void;
} | null>(null);

/** 项目智能体本轮任务与模型正文（与中间回读同一段事件，不另开一条生成）。 */
const agentEvents = computed(() => projectAgentPanelRef.value?.events ?? []);
const agentTask = computed(() => projectAgentPanelRef.value?.lastTask ?? '');
const agentReply = computed(() => timelineTranscript(agentEvents.value));
const agentStreaming = computed(() => projectAgentPanelRef.value?.active === true);

/** 对话栏和中间回读是否仍贴在底部。用户往上翻之后不再抢滚动。 */
const streamPinned = { chat: true, readout: true };

/**
 * 流式增长时立刻滚到底，不用 smooth。
 * smooth 会把上一次动画还没走完的滚动排队，字越快越觉得顿。
 */
function followStream(el: HTMLElement | null | undefined, slot: 'chat' | 'readout') {
  if (!el || !streamPinned[slot]) return;
  const previous = el.style.scrollBehavior;
  el.style.scrollBehavior = 'auto';
  el.scrollTop = el.scrollHeight;
  el.style.scrollBehavior = previous;
}

const readoutRef = ref<HTMLElement | null>(null);
function readoutScroller(): HTMLElement | null {
  return readoutRef.value?.closest('.ws-body') ?? null;
}
watch(readoutRef, (el, _previous, onCleanup) => {
  const readout = el?.closest<HTMLElement>('.ws-body');
  if (!readout) return;
  const onScroll = () => {
    streamPinned.readout = readout.scrollHeight - readout.scrollTop - readout.clientHeight <= 80;
  };
  readout.addEventListener('scroll', onScroll, { passive: true });
  onCleanup(() => readout.removeEventListener('scroll', onScroll));
});

watch(listRef, (el, _previous, onCleanup) => {
  if (!el) return;
  const onScroll = () => {
    streamPinned.chat = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  onCleanup(() => el.removeEventListener('scroll', onScroll));
});

watch(agentReply, async (_value, _previous, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  await nextTick();
  if (!active) return;
  followStream(listRef.value, 'chat');
  followStream(readoutScroller(), 'readout');
});

watch(workspaceMode, () => {
  void nextTick(() => projectAgentPanelRef.value?.syncReadoutTarget());
});

/**
 * 把创建运行的结果说给用户，成功时切到本次运行。
 *
 * @param result 面板已有的提交结果
 */
function presentProjectAgentResult(result: ProjectAgentSubmitResult | undefined): void {
  switch (result) {
    case 'started':
      focusPane('cards');
      return;
    case 'need-project':
    case undefined:
      antMessage.warning('请先选择有权限的项目');
      return;
    case 'need-selection':
      antMessage.warning(
        projectAgentPanelRef.value?.entryBlockReason
          || '请先点输入框里的加号，选择能力包和模型',
      );
      return;
    case 'busy':
      antMessage.warning('当前已有进行中的智能体运行');
      return;
    case 'failed':
      antMessage.warning('项目智能体未能发起运行，请查看面板提示后重试');
      return;
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

/**
 * AI 模式主发送：调用已有面板 submitText，不新建客户端、不回落副驾 SSE。
 *
 * @param text 任务说明（含附件清单后缀）
 */
async function sendViaProjectAgent(text: string): Promise<void> {
  const result = await projectAgentPanelRef.value?.submitText(text);
  presentProjectAgentResult(result);
}

/**
 * 点澄清选项：选项原文留在输入框，发送文写成「已选：…。」并走已有创建运行。
 *
 * @param choice 被点中的那一项，不是问题列表里的第一项
 */
async function chooseClarification(choice: ClarificationChoice): Promise<void> {
  inputText.value = choice.option;
  const result = await projectAgentPanelRef.value?.answerClarification(
    clarificationSendText(choice.option, choice.question),
  );
  if (result === 'started') inputText.value = '';
  presentProjectAgentResult(result);
}

/**
 * meta 帧里的待办或推进条目。只留下有标题的行；链接只接受站内路径。
 */
function copilotItems(data: unknown): CopilotDataItem[] | null {
  if (!Array.isArray(data)) return null;
  const items: CopilotDataItem[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title) continue;
    const hint = typeof row.hint === 'string' ? row.hint.trim() : '';
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    items.push({
      hint: hint || null,
      title,
      type: typeof row.type === 'string' ? row.type : null,
      url: url.startsWith('/') && !url.startsWith('//') ? url : null,
    });
  }
  return items.length > 0 ? items : null;
}

/** 点开 meta 里的站内链接。单测没有路由时不跳转。 */
function openCopilotItem(url: string): void {
  if (!url.startsWith('/') || url.startsWith('//')) return;
  void router?.push(url);
}

/** 输入框发送入口（AiComposer send 事件：文本 + 附件清单）。 */
function onComposerSend(payload: { attachments: ComposerAttachment[]; text: string }): void {
  void send(payload.text, payload.attachments);
}

async function send(text: string = inputText.value.trim(), attachments: ComposerAttachment[] = []) {
  const body = text + attachmentManifest(attachments);
  if (workspaceMode.value === 'ai') {
    if ((!text && attachments.length === 0) || sending.value) return;
    inputText.value = '';
    sending.value = true;
    try {
      await sendViaProjectAgent(body);
    } finally {
      sending.value = false;
    }
    return;
  }
  if ((!text && attachments.length === 0) || sending.value) return;
  clearCardState();
  inputText.value = '';
  sending.value = true;
  messages.value.push(
    {
      content: body,
      intent: null,
      items: null,
      role: 'user',
      sources: null,
      streaming: false,
    },
    {
      content: '',
      intent: null,
      items: null,
      role: 'assistant',
      sources: null,
      streaming: true,
    },
  );
  await scrollToListBottom();
  abort = new AbortController();
  const version = ++runVersion;
  const assistant = messages.value.at(-1)!;
  try {
    await streamCopilot(
      { message: body, projectId: currentProjectId.value || undefined },
      {
        onDelta: (token) => {
          if (version !== runVersion) return;
          assistant.content += token;
          scrollToListBottom();
        },
        onDone: (done) => {
          if (version !== runVersion) return;
          assistant.streaming = false;
          if (!assistant.content) {
            assistant.content = '（模型未返回内容，请换个问法或稍后重试）';
          }
          // R221 对话即填表：done 帧携 fillPayload 时广播给当前页面消费（如动作详情 C08 回填）。
          if (done?.fillPayload && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('ipd:ai-fill-payload', {
                detail: done.fillPayload,
              }),
            );
          }
          // P2-02 done 处理泛化：card 字段分发渲染（无 card 原样透传，非法信封置 null 不断对话流）。
          handleDoneCard(done);
        },
        onError: (err) => {
          if (version !== runVersion) return;
          assistant.streaming = false;
          if (!assistant.content) {
            assistant.content = `[${err.code}] ${err.message}`;
          } else {
            assistant.content += `\n\n[流式中断 ${err.code}] ${err.message}`;
          }
        },
        onMeta: (meta) => {
          if (version !== runVersion) return;
          assistant.intent = meta.intent;
          assistant.items = copilotItems(meta.data);
          assistant.sources = meta.sources;
        },
      },
      abort.signal,
    );
  } finally {
    assistant.streaming = false;
    if (version === runVersion) {
      sending.value = false;
      abort = null;
    }
    await scrollToListBottom();
  }
}

/**
 * done 帧卡片处理（P2-02 双事件分发·卡片通道）：
 * - 无 card 字段 / card:null → 原样透传，不派发不渲染不报错（非结构化轮次常态）；
 * - card 在场：四键信封守卫复用 api/ipd/ai-copilot 的 parseStreamDone（内部
 *   isCardEnvelope/parseCardEnvelope，import 复用禁复制逻辑防双轨）——缺键置 null；
 * - 过检通过（enforceCardRenderRules：R2 丢弃留痕 + R3 对账平）：广播过检后四键
 *   信封 `ipd:ai-card` CustomEvent（与 fillPayload 广播并行互不覆盖，双通道并存）
 *   + getCardType(type, version) 注册表分发渲染（容器 testid=ipd-ai-card-host）；
 * - 信封非法 / 未命中注册表 / R3 对账不平 / 处理抛错：置 null 拒出卡降级纯文本
 *   提示（ipd-ai-card-notice），不崩不断对话流（卡片层是增强不是依赖）。
 */
function handleDoneCard(done: CopilotStreamDone): void {
  const raw = done as CopilotStreamDone & { card?: unknown };
  if (raw === null || typeof raw !== 'object') return;
  if (!('card' in raw) || raw.card === null || raw.card === undefined) return;
  try {
    const card = parseStreamDone(raw).card;
    if (!card) {
      rejectCard(
        '卡片信封非法（缺 type/version/data/sourceRefs 四键），已忽略，对话继续',
      );
      return;
    }
    const checked = enforceCardRenderRules(card);
    if (!checked.ok) {
      rejectCard(checked.reason);
      return;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ipd:ai-card', { detail: checked.card }),
      );
    }
    cardNotice.value = '';
    cardDegraded.value = '';
    cardView.value = { component: checked.component, data: checked.card.data };
    // 自动渲染定位：出卡即滚动到工作区「建议卡」区（四区常驻不切换）。
    focusPane('cards');
  } catch (error) {
    rejectCard(`${ipdErrorText(error, { fallback: '卡片处理异常' })}，已忽略，对话继续`);
  }
}

/** 拒出卡收口（P2-02）：置 null + 提示文案，对话流不受影响（不断流不崩）。 */
function rejectCard(notice: string): void {
  cardView.value = null;
  cardDegraded.value = '';
  cardNotice.value = notice;
  // 自动渲染定位：降级/非法提示同样落在「建议卡」区，定位保持可见。
  focusPane('cards');
}

function toggleOpen() {
  open.value = !open.value;
  if (!open.value) abort?.abort();
}

/** 只改变展示尺寸，不改变业务模式或清空当前会话。 */
function toggleExpand() {
  expanded.value = !expanded.value;
}

function clearConversation() {
  if (workspaceMode.value !== 'classic') return;
  abort?.abort();
  runVersion++;
  sending.value = false;
  messages.value = [];
  clearCardState();
  antMessage.info('已开启新会话');
}

/**
 * 卡片渲染异常降级（P2-02）：卡片组件 render 抛错 → ipd-ai-card-degraded 降级占位，
 * 对话流不受影响；只拦截卡片在场时的渲染错误，其余子组件错误照常上抛（不扩大捕获面）。
 */
onErrorCaptured((error: unknown) => {
  if (!cardView.value) return true;
  cardView.value = null;
  cardDegraded.value = `${ipdErrorText(error, { fallback: '卡片渲染异常' })}，已降级占位，对话不受影响`;
  return false;
});

/**
 * 卡片确认 hook（P2-02，C08 铁律：卡片层零直写）：只收组件 confirm emit 暂存载荷，
 * 绝不发起任何 /api/v1 写调用——真人提交走既有端点，后续批次在此 hook 接真人复核链。
 */
function onCardConfirm(payload: AiCardData) {
  cardConfirmPayload.value = payload;
}

defineExpose({ clearConversation, send });
</script>

<template>
  <CopilotKitProvider
    :enable-inspector="false"
    :headers="copilotKitAuthHeaders"
    runtime-url="/api/copilotkit"
  >
    <IpdAiCardRenderHost :on-confirm="onCardConfirm" />
    <IpdGuideScriptHost :value="guideContext" />
    <IpdSwarmProgressHost />

    <button
      :aria-label="workspaceMode === 'ai' ? '项目 AI 工作界面' : 'AI 副驾'"
      class="ipd-ai-fab"
      data-testid="ipd-ai-fab"
      type="button"
      @click="toggleOpen"
    >
      <Sparkles :size="20" />
      <span>{{ workspaceMode === 'ai' ? '项目 AI' : 'AI 副驾' }}</span>
    </button>
    <Drawer
      :open="open"
      :width="expanded ? '100%' : 440"
      data-testid="ipd-ai-drawer"
      :title="workspaceMode === 'ai' ? '项目 AI 工作界面' : 'AI 副驾'"
      @close="toggleOpen"
    >
      <template #extra>
        <button
          v-if="!expanded"
          aria-label="放大工作窗口"
          class="ipd-ai-size-btn"
          data-testid="ipd-ai-expand"
          title="放大工作窗口"
          type="button"
          @click="toggleExpand"
        >
          <ExpandIcon :size="16" />
        </button>
        <button
          v-else
          aria-label="缩小工作窗口"
          class="ipd-ai-size-btn"
          data-testid="ipd-ai-collapse"
          title="缩小工作窗口"
          type="button"
          @click="toggleExpand"
        >
          <CollapseIcon :size="16" />
        </button>
      </template>
      <div
        :class="['ipd-ai-panel', { 'is-workbench': expanded, 'is-project-mode': workspaceMode === 'ai' }]"
        :data-expanded="expanded ? 'true' : undefined"
        :data-testid="expanded ? 'ipd-ai-workbench' : undefined"
      >
        <div class="ipd-ai-mode-switch" role="group" aria-label="AI 工作方式">
          <button
            :aria-pressed="workspaceMode === 'classic'"
            :class="['ipd-ai-mode-option', { 'is-active': workspaceMode === 'classic' }]"
            data-testid="ipd-ai-mode-classic"
            type="button"
            @click="applyMode('classic')"
          >
            <strong>AI 副驾</strong>
            <span>当前页面咨询与建议</span>
          </button>
          <button
            :aria-pressed="workspaceMode === 'ai'"
            :class="['ipd-ai-mode-option', { 'is-active': workspaceMode === 'ai' }]"
            data-testid="ipd-ai-mode-project"
            type="button"
            @click="applyMode('ai')"
          >
            <strong>项目智能体</strong>
            <span>按项目执行与回读</span>
          </button>
        </div>
        <nav
          v-if="expanded && workspaceMode === 'ai' && stages?.length"
          aria-label="浏览阶段（不改变项目实际进度）"
          class="ipd-ai-stage-nav"
          data-testid="ipd-ai-stage-nav"
        >
          <button
            v-for="(stage, index) in stages"
            :key="stage.code"
            :aria-pressed="viewStageCode === stage.code"
            :class="['ipd-ai-stage-option', { 'is-active': viewStageCode === stage.code }]"
            :data-testid="`ipd-ai-stage-${stage.code}`"
            type="button"
            @click="selectViewStage(stage.code)"
          >
            <span class="ipd-ai-stage-number">{{ index + 1 }}</span>
            <span>{{ stage.name }}</span>
            <small v-if="projectCurrentStage === stage.code">当前进度</small>
          </button>
        </nav>
        <aside
          v-if="workspaceMode === 'ai'"
          class="ipd-ai-runs-col"
          data-testid="ipd-ai-runs"
        >
          <DocumentVersionReview
            v-if="entryDocumentId()"
            :document-id="entryDocumentId()"
            :project-id="entryProjectId() || currentProjectId"
          />
          <ProjectAgentPanel
            ref="projectAgentPanelRef"
            controls-external
            :action-code="sessionAction?.actionCode || entryActionCode || undefined"
            :action-skill-names="sessionAction?.skillNames ?? []"
            :project-id="currentProjectId || null"
            @choose="chooseClarification"
          />
        </aside>
        <div class="chat-col">
          <label class="chat-project" data-testid="ipd-ai-project-switch">
            <span>项目</span>
            <select
              data-testid="ipd-ai-project-select"
              name="ipd_ai_project_id"
              :value="currentProjectId"
              @change="switchConversationProject(($event.target as HTMLSelectElement).value)"
            >
              <option v-if="!currentProjectId" disabled value="">选择项目</option>
              <option v-for="project in conversationProjects" :key="project.id" :value="project.id">
                {{ projectOptionLabel(project) }}
              </option>
              <option
                v-if="currentProjectId && !conversationProjects.some((project) => project.id === currentProjectId)"
                :value="currentProjectId"
              >
                当前项目 #{{ currentProjectId }}
              </option>
            </select>
          </label>
          <Alert
            message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
            show-icon
            type="warning"
          />
          <div
            v-if="currentProjectId"
            class="ctx-chip"
            data-testid="ipd-ai-ctx"
          >
            <template v-if="workspaceMode === 'classic'">
              已注入当前项目上下文（#{{ currentProjectId }}）：问「我的待办」「项目风险」试试
            </template>
            <template v-else>当前项目：#{{ currentProjectId }}</template>
          </div>
          <div
            v-else-if="workspaceMode === 'ai'"
            class="ctx-chip"
            data-testid="ipd-ai-ctx"
          >
            请先选择有权限的项目，再发起项目智能体运行
          </div>
          <div ref="listRef" class="msg-list" data-testid="ipd-ai-messages">
            <div
              v-if="workspaceMode === 'ai' && selectedSubStage"
              class="step-actions"
              data-testid="ipd-ai-step-actions"
            >
              <p v-if="projectAgentPanelRef?.entryBlockReason" data-testid="ipd-ai-entry-block">
                {{ projectAgentPanelRef.entryBlockReason }}
              </p>
              <p v-else-if="sessionAction" data-testid="ipd-ai-entry-bound">
                本次发送将绑定动作 {{ sessionAction.actionName }}（{{ sessionAction.actionCode }}），并带上小阶段目录里已批准的技能。
              </p>
              <p v-else>
                当前步骤：{{ selectedSubStage.name }}。目标还不明确时，先点选一个动作再发送。
              </p>
              <p
                v-if="sessionAction && projectAgentPanelRef?.entryToolNote && !projectAgentPanelRef?.entryBlockReason"
                data-testid="ipd-ai-entry-tool-note"
              >
                {{ projectAgentPanelRef.entryToolNote }}
              </p>
              <button
                v-for="action in selectedSubStage.actions"
                :key="action.actionCode"
                type="button"
                :aria-pressed="sessionActionCode === action.actionCode"
                :data-testid="`ipd-ai-step-action-${action.actionCode}`"
                @click="selectStepAction(action)"
              >
                {{ action.actionName }}
              </button>
            </div>
            <div v-if="workspaceMode === 'ai' ? !agentTask : messages.length === 0" class="empty-hint">
              {{ workspaceMode === 'ai'
                ? '描述任务后发送，将按当前项目发起智能体运行。过程在中间回读，产物在左侧定档。'
                : '你好，我是 IPD AI 副驾。可以问项目待办、推进建议，或任何 IPD 流程问题。' }}
            </div>
            <template v-if="workspaceMode === 'ai' && agentTask">
              <div class="msg user" data-testid="ipd-ai-msg-user">
                <div class="bubble">{{ agentTask }}</div>
              </div>
              <div
                v-if="agentReply || agentStreaming"
                class="msg assistant"
                data-testid="ipd-ai-msg-assistant"
              >
                <AssistantTurn
                  class="assistant-turn-block"
                  pace
                  :content="agentReply"
                  :streaming="agentStreaming"
                />
              </div>
            </template>
            <div
              v-for="(m, i) in messages"
              v-if="workspaceMode !== 'ai'"
              :key="i"
              :class="['msg', m.role]"
              :data-testid="`ipd-ai-msg-${m.role}`"
            >
              <div class="bubble">
                <AssistantTurn
                  v-if="m.role === 'assistant'"
                  :content="m.content"
                  :streaming="m.streaming"
                />
                <template v-else>{{ m.content }}</template>
              </div>
              <div
                v-if="m.role === 'assistant' && m.sources?.length"
                class="sources"
              >
                来源：{{ m.sources.join('；') }}
              </div>
              <ul
                v-if="m.role === 'assistant' && m.items?.length"
                class="copilot-items"
                data-testid="ipd-ai-msg-items"
              >
                <li v-for="(item, itemIndex) in m.items" :key="`${item.type ?? 'item'}-${itemIndex}`">
                  <button
                    v-if="item.url"
                    type="button"
                    @click="openCopilotItem(item.url)"
                  >
                    {{ item.title }}
                  </button>
                  <span v-else>{{ item.title }}</span>
                  <small v-if="item.hint">{{ item.hint }}</small>
                </li>
              </ul>
            </div>
            <AiLoadingState v-if="sending" data-testid="ipd-ai-loading" label="正在生成" />
          </div>
          <GuideSuggestionBar
            v-if="workspaceMode === 'classic'"
            :suggestions="guideSuggestions"
            @pick="inputText = $event"
          />
          <AiComposer
            v-model="inputText"
            :capability-menu="workspaceMode === 'ai'"
            :prompt-shell="workspaceMode === 'ai'"
            :disabled="sending"
            :sending="sending"
            :show-reset="workspaceMode === 'classic'"
            @reset="clearConversation"
            @send="onComposerSend"
          />
        </div>
        <aside
          :data-mode="workspaceMode"
          class="showcase-col"
          data-testid="ipd-ai-showcase"
        >
          <div v-if="expanded && workspaceMode === 'ai'" class="ipd-ai-view-stage">
            正在浏览：{{ viewStageName }}阶段 <span>仅切换视图，不推进项目</span>
          </div>
          <IpdAiWorkspace
            :hints="workspaceMode === 'ai' ? { cards: '正文、工具和步骤按本次运行事件回读' } : undefined"
            :panes="workspaceMode === 'ai' ? projectWorkspacePanes : undefined"
            :titles="workspaceMode === 'ai' ? { cards: '本次运行' } : undefined"
          >
            <template #steps>
              <Alert
                v-if="!currentProjectId"
                message="请先选择有权限的项目，再查看小阶段引导。"
                show-icon
                type="info"
              />
              <StageStepNav
                v-else-if="subStages.length"
                :active-code="activeSubStageCode"
                :binds-session="workspaceMode === 'ai'"
                :stage-code="workspaceMode === 'ai' ? viewStageCode : undefined"
                :stages="subStages"
                @select="selectSubStage"
              />
              <div v-else class="showcase-empty" data-testid="ipd-ai-step-nav-empty">
                {{ subStageError || '小阶段数据加载中…' }}
              </div>
            </template>
            <template #cards>
              <div
                v-if="workspaceMode === 'ai'"
                id="ipd-ai-run-readout"
                ref="readoutRef"
                data-testid="ipd-ai-run-readout"
              />
              <div
                v-else-if="cardView"
                class="ipd-ai-card-host"
                data-testid="ipd-ai-card-host"
              >
                <component
                  :is="cardView.component"
                  :data="cardView.data"
                  @confirm="onCardConfirm"
                />
              </div>
              <div
                v-else-if="cardDegraded"
                class="ipd-ai-card-degraded"
                data-testid="ipd-ai-card-degraded"
              >
                {{ cardDegraded }}
              </div>
              <div
                v-else-if="cardNotice"
                class="ipd-ai-card-notice"
                data-testid="ipd-ai-card-notice"
              >
                {{ cardNotice }}
              </div>
              <div
                v-else-if="expanded"
                class="showcase-empty"
                data-testid="ipd-ai-showcase-empty"
              >
                工作区：建议卡 / 步骤 / 画布 / 文档四区常驻自动渲染，对话中产出即就地展开（
                步骤 / 画布 / 文档依次由 B2/B3/B4 落位）。
              </div>
            </template>
          </IpdAiWorkspace>
        </aside>
      </div>
    </Drawer>
  </CopilotKitProvider>
</template>

<style scoped>
/* 色板沿用 _shared/ipd-theme.css 的 --ipd-* token（暗色自动翻转） */
.ipd-ai-fab {
  position: fixed;
  right: 28px;
  bottom: 32px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background: var(--ipd-blue);
  color: hsl(var(--primary-foreground));
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--ipd-blue) 28%, transparent);
}
.ipd-ai-fab:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ipd-ai-fab:hover {
  filter: brightness(1.08);
}
.ipd-ai-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}
.ipd-ai-mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ipd-line);
  border-radius: 12px;
  background: var(--ipd-bg);
}
.ipd-ai-mode-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ipd-muted);
  text-align: left;
  cursor: pointer;
}
.ipd-ai-mode-option strong {
  color: var(--ipd-text);
  font-size: 13px;
}
.ipd-ai-mode-option span {
  font-size: 11px;
}
.ipd-ai-mode-option.is-active {
  border-color: var(--ipd-line);
  background: var(--ipd-surface);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ipd-navy) 10%, transparent);
}
.ipd-ai-mode-option.is-active strong {
  color: var(--ipd-blue);
}
:global(html.dark) .ipd-ai-mode-option.is-active strong {
  color: var(--ipd-blue-dark);
}
.ipd-ai-mode-option:hover:not(.is-active) {
  background: var(--ipd-blue-soft);
}
.ipd-ai-mode-option:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
/* 放大只改变展示尺寸；AI 模式按原型排为运行、工作区、对话。 */
.ipd-ai-panel.is-workbench {
  display: grid;
  grid-template-columns: minmax(320px, 5fr) minmax(0, 7fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0 16px;
}
.ipd-ai-panel.is-workbench .ipd-ai-mode-switch {
  grid-column: 1 / -1;
  margin-bottom: 8px;
}
.ipd-ai-panel.is-workbench.is-project-mode {
  grid-template-columns: minmax(180px, 220px) minmax(280px, 1fr) minmax(320px, 0.85fr);
  grid-template-rows: auto auto minmax(0, 1fr);
}
.ipd-ai-stage-nav {
  display: flex;
  grid-column: 1 / -1;
  grid-row: 2;
  gap: 6px;
  min-width: 0;
  margin: 0 0 12px;
  padding: 6px;
  overflow-x: auto;
  border: 1px solid var(--ipd-line);
  border-radius: 10px;
  background: var(--ipd-bg);
}
.ipd-ai-stage-option {
  display: flex;
  flex: 1 0 116px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--ipd-muted);
  font-size: 12px;
  cursor: pointer;
}
.ipd-ai-stage-option.is-active {
  border-color: var(--ipd-line);
  background: var(--ipd-surface);
  color: var(--ipd-blue);
}
:global(html.dark) .ipd-ai-stage-option.is-active {
  color: var(--ipd-blue-dark);
}
.ipd-ai-stage-option:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ipd-ai-stage-number {
  display: grid;
  flex: 0 0 20px;
  place-items: center;
  height: 20px;
  border-radius: 50%;
  background: var(--ipd-line);
  color: var(--ipd-text);
  font-size: 11px;
  font-weight: 700;
}
.ipd-ai-stage-option.is-active .ipd-ai-stage-number {
  background: var(--ipd-blue);
  color: hsl(var(--primary-foreground));
}
:global(html.dark) .ipd-ai-stage-option.is-active .ipd-ai-stage-number {
  color: var(--ipd-navy);
}
.ipd-ai-stage-option small {
  color: var(--ipd-muted);
  font-size: 10px;
}
.ipd-ai-runs-col {
  grid-column: 1;
  grid-row: 3;
  min-height: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--ipd-line);
  border-radius: 10px;
  background: var(--ipd-surface);
}
.ipd-ai-runs-col h3 {
  margin: 0 0 10px;
  color: var(--ipd-text);
  font-size: 14px;
}
.ipd-ai-runs-col p {
  margin: 0;
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.7;
}
.ipd-ai-panel.is-workbench .chat-col {
  padding-right: 16px;
}
.ipd-ai-panel.is-workbench.is-project-mode .chat-col {
  grid-column: 3;
  grid-row: 3;
  padding-right: 0;
  padding-left: 16px;
  border-left: 1px solid var(--ipd-line);
}
.ipd-ai-panel.is-workbench .showcase-col {
  padding: 4px 2px 4px 16px;
  overflow-y: auto;
  border-left: 1px solid var(--ipd-line);
}
.ipd-ai-panel.is-workbench.is-project-mode .showcase-col {
  grid-column: 2;
  grid-row: 3;
  padding: 0;
  border-left: 0;
}
.ipd-ai-view-stage {
  padding: 8px 10px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  font-size: 12px;
  font-weight: 650;
}
.ipd-ai-view-stage span {
  margin-left: 8px;
  color: var(--ipd-muted);
  font-size: 11px;
  font-weight: 400;
}
.chat-col {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.showcase-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.showcase-empty {
  padding: 12px;
  border: 1px dashed var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.8;
}
.ipd-ai-size-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  cursor: pointer;
}
.ipd-ai-size-btn:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ipd-ai-size-btn:hover {
  filter: brightness(1.05);
}
.chat-project {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  color: var(--ipd-muted);
  font-size: 12px;
}
.chat-project select {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  color: var(--ipd-text);
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}
.ctx-chip {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  color: var(--ipd-muted);
  font-size: 12px;
}
.msg-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 2px;
}
.step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
}
.step-actions p {
  flex: 1 0 100%;
  margin: 0;
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.5;
}
.step-actions button {
  padding: 4px 8px;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
  background: var(--ipd-bg);
  color: var(--ipd-text);
  font-size: 12px;
  cursor: pointer;
}
.step-actions button[aria-pressed='true'] {
  border-color: var(--ipd-blue);
}
.empty-hint {
  color: var(--ipd-muted);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 4px;
}
.msg.user {
  align-self: flex-end;
}
.msg.assistant {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-self: flex-start;
  width: 100%;
  max-width: 100%;
}
.msg .bubble {
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.is-project-mode .msg .bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 1.75;
}
.msg.user .bubble {
  background: var(--ipd-blue);
  color: hsl(var(--primary-foreground));
  border-radius: 16px 16px 4px 16px;
}
.is-project-mode .msg.user .bubble {
  background: var(--ipd-navy);
  color: var(--ipd-surface);
}
/* 思考区与回答气泡分开：只有 .answer 走气泡样式，意图卡独立成块 */
.msg.assistant :deep(.assistant-turn-block) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.msg.assistant :deep(.answer) {
  padding: 8px 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 16px 16px 16px 4px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ipd-navy) 6%, transparent);
}
.is-project-mode .msg.assistant :deep(.answer) {
  padding: 10px 14px;
  font-size: 15px;
  line-height: 1.75;
}
:global(html.dark) .ipd-ai-fab,
:global(html.dark) .ipd-ai-panel:not(.is-project-mode) .msg.user .bubble {
  color: var(--ipd-navy);
}
.msg.assistant .bubble {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  color: var(--ipd-text);
  border-radius: 16px 16px 16px 4px;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ipd-navy) 6%, transparent);
}
.msg .sources {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ipd-muted);
}
.copilot-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.copilot-items li {
  padding: 6px 8px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  font-size: 12px;
  line-height: 1.5;
}
.copilot-items button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ipd-blue);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.copilot-items small {
  display: block;
  color: var(--ipd-muted);
}
.cursor {
  animation: ipd-ai-blink 1s step-end infinite;
}
@keyframes ipd-ai-blink {
  50% {
    opacity: 0;
  }
}
/* P2-02 卡片三态容器（host=卡片分发渲染 / degraded=渲染降级占位 / notice=非法信封提示） */
.ipd-ai-card-host {
  display: flex;
  flex-direction: column;
}
.ipd-ai-card-degraded,
.ipd-ai-card-notice {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
}
.ipd-ai-card-degraded {
  border: 1px dashed var(--ipd-line);
  background: var(--ipd-surface);
  color: var(--ipd-muted);
}
.ipd-ai-card-notice {
  border: 1px solid var(--ipd-line);
  background: var(--ipd-surface);
  color: var(--ipd-muted);
}
@media (max-width: 1024px) {
  .ipd-ai-panel.is-workbench.is-project-mode {
    grid-template-columns: minmax(145px, 180px) minmax(220px, 1fr) minmax(260px, 0.9fr);
    gap: 0 10px;
  }
}
@media (max-width: 768px) {
  .ipd-ai-panel.is-workbench,
  .ipd-ai-panel.is-workbench.is-project-mode {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .ipd-ai-runs-col {
    display: none;
  }
  .ipd-ai-stage-nav {
    flex: 0 0 auto;
  }
  .ipd-ai-panel.is-workbench .chat-col,
  .ipd-ai-panel.is-workbench.is-project-mode .chat-col,
  .ipd-ai-panel.is-workbench .showcase-col,
  .ipd-ai-panel.is-workbench.is-project-mode .showcase-col {
    padding: 0;
    border: 0;
  }
  .ipd-ai-panel.is-workbench .chat-col {
    min-height: 320px;
  }
}
</style>
