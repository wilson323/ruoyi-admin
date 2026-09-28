<script lang="ts" setup>
/**
 * 全局 AI 副驾（R215 AI 融合批次3 = AI-FUSION-B3）。
 *
 * 挂载于 layouts/ipd.vue：所有 IPD 页面共享同一入口（浮钮 + 右抽屉）。
 * 走后端 AiCopilotService 三档上下文（项目/个人/RAG，AI-STRAT-1 Phase 2）——
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
 */
import { computed, nextTick, onErrorCaptured, ref, shallowRef, type Component } from 'vue';

import { CopilotKitProvider } from '@copilotkit/vue/v2';
import { PhSparkle as Sparkles } from '@phosphor-icons/vue';
import { Alert, Button, Drawer, Input, message as antMessage } from 'ant-design-vue';

import {
  parseStreamDone,
  streamCopilot,
  type CopilotStreamDone,
} from '../../../api/ipd/ai-copilot';

import { getCardType } from './ai-cards/card-registry';
import {
  copilotKitAuthHeaders,
  IpdAiCardRenderHost,
} from './ai-cards/copilotkit-render';
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
  arrayRowKeys: Readonly<Record<string, Readonly<Record<string, true>>>> | undefined,
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
          ? dropSchemaExtra(row, rowKeys, undefined, `${prefix}${field}[${index}].`, dropped)
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
  const refCount = (value: unknown): number => (Array.isArray(value) ? value.length : 1);
  const refKeys = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).map((item) => String(item));
  const dataCount = (value: unknown): number | null =>
    Array.isArray(value) ? value.length : null;
  if (type === 'gate.precheck') {
    const reviewIds = refCount(refs.reviewIds);
    const elementResultIds = refCount(refs.elementResultIds);
    const items = dataCount(data.items);
    if (Number(data.reviewCount) !== reviewIds) {
      violations.push(`reviewCount=${String(data.reviewCount)}↔reviewIds=${reviewIds}`);
    }
    if (Number(data.totalElements) !== elementResultIds) {
      violations.push(
        `totalElements=${String(data.totalElements)}↔elementResultIds=${elementResultIds}`,
      );
    }
    if (items === null || items !== elementResultIds) {
      violations.push(`items=${items ?? '缺失'}↔elementResultIds=${elementResultIds}`);
    }
  } else if (type === 'gate.conclusion') {
    const reviewIds = refCount(refs.reviewIds);
    const elementResultIds = refCount(refs.elementResultIds);
    const reviews = dataCount(data.reviews);
    const voteSum =
      Number(data.passCount) + Number(data.conditionalCount) + Number(data.failCount);
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
      violations.push(`requirements=${requirements ?? '缺失'}↔requirementIds=${requirementIds}`);
    }
    for (const row of Array.isArray(data.requirements) ? data.requirements : []) {
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
      reason: '卡片信封结构非法（type/version/data/sourceRefs 形态不符），已忽略，对话继续',
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
  const violations = reconcileCardViolations(raw.type as AiCardType, data, sourceRefs);
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

/** 会话消息（role 与后端 CopilotTurn 对齐；assistant 附流式状态与来源摘要）。 */
interface ChatMessage {
  content: string;
  intent: null | string;
  role: 'assistant' | 'user';
  sources: null | string[];
  streaming: boolean;
}

/** 后端多轮上限 8 轮；SSE 端点契约现状不收 history（AiCopilotController.stream 构造
 *  AiCopilotReq 时 history 固定空列表），多轮上下文待后端扩展后由前端补传（B3 注记）。 */
// const MAX_HISTORY_TURNS = 8;

/** 与 layouts/ipd.vue 同 key：AI 上下文自动跟随全局当前项目。 */
const CURRENT_PROJECT_KEY = 'ipd:current-project';

const open = ref(false);
const inputText = ref('');
const sending = ref(false);
const messages = ref<ChatMessage[]>([]);
const listRef = ref<HTMLElement>();

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

const currentProjectId = computed(
  () => window.localStorage.getItem(CURRENT_PROJECT_KEY) ?? '',
);

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
  listRef.value?.scrollTo({ behavior: 'smooth', top: listRef.value.scrollHeight });
}

/** 新轮清卡片态（P2-02）：用户发新消息开启新轮时清上一轮卡片渲染态，防跨轮串态。 */
function clearCardState() {
  cardView.value = null;
  cardDegraded.value = '';
  cardNotice.value = '';
}

let abort: AbortController | null = null;

async function send() {
  const text = inputText.value.trim();
  if (!text || sending.value) return;
  clearCardState();
  inputText.value = '';
  sending.value = true;
  messages.value.push(
    { content: text, intent: null, role: 'user', sources: null, streaming: false },
    { content: '', intent: null, role: 'assistant', sources: null, streaming: true },
  );
  await scrollToListBottom();
  abort = new AbortController();
  const assistant = messages.value.at(-1)!;
  try {
    await streamCopilot(
      { message: text, projectId: currentProjectId.value || undefined },
      {
        onDelta: (token) => {
          assistant.content += token;
          scrollToListBottom();
        },
        onDone: (done) => {
          assistant.streaming = false;
          if (!assistant.content) {
            assistant.content = '（模型未返回内容，请换个问法或稍后重试）';
          }
          // R221 对话即填表：done 帧携 fillPayload 时广播给当前页面消费（如动作详情 C08 回填）。
          if (done?.fillPayload && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('ipd:ai-fill-payload', { detail: done.fillPayload }),
            );
          }
          // P2-02 done 处理泛化：card 字段分发渲染（无 card 原样透传，非法信封置 null 不断对话流）。
          handleDoneCard(done);
        },
        onError: (err) => {
          assistant.streaming = false;
          if (!assistant.content) {
            assistant.content = `[${err.code}] ${err.message}`;
          } else {
            assistant.content += `\n\n[流式中断 ${err.code}] ${err.message}`;
          }
        },
        onMeta: (meta) => {
          assistant.intent = meta.intent;
          assistant.sources = meta.sources;
        },
      },
      abort.signal,
    );
  } finally {
    assistant.streaming = false;
    sending.value = false;
    abort = null;
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
      rejectCard('卡片信封非法（缺 type/version/data/sourceRefs 四键），已忽略，对话继续');
      return;
    }
    const checked = enforceCardRenderRules(card);
    if (!checked.ok) {
      rejectCard(checked.reason);
      return;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ipd:ai-card', { detail: checked.card }));
    }
    cardNotice.value = '';
    cardDegraded.value = '';
    cardView.value = { component: checked.component, data: checked.card.data };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    rejectCard(`卡片处理异常（${detail}），已忽略，对话继续`);
  }
}

/** 拒出卡收口（P2-02）：置 null + 提示文案，对话流不受影响（不断流不崩）。 */
function rejectCard(notice: string): void {
  cardView.value = null;
  cardDegraded.value = '';
  cardNotice.value = notice;
}

function toggleOpen() {
  open.value = !open.value;
  if (!open.value) abort?.abort();
}

function clearConversation() {
  abort?.abort();
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
  const detail = error instanceof Error ? error.message : String(error);
  cardDegraded.value = `卡片渲染异常（${detail}），已降级占位，对话不受影响`;
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

    <button
      aria-label="AI 副驾"
      class="ipd-ai-fab"
      data-testid="ipd-ai-fab"
      type="button"
      @click="toggleOpen"
    >
      <Sparkles :size="20" />
      <span>AI 副驾</span>
    </button>
    <Drawer
      :open="open"
      :width="440"
      data-testid="ipd-ai-drawer"
      title="AI 副驾"
      @close="toggleOpen"
    >
      <div class="ipd-ai-panel">
        <Alert
          message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
          show-icon
          type="warning"
        />
        <div v-if="currentProjectId" class="ctx-chip" data-testid="ipd-ai-ctx">
          已注入当前项目上下文（#{{ currentProjectId }}）：问「我的待办」「项目风险」试试
        </div>
        <div ref="listRef" class="msg-list" data-testid="ipd-ai-messages">
          <div v-if="messages.length === 0" class="empty-hint">
            你好，我是 IPD AI 副驾。可以问项目待办、推进建议，或任何 IPD 流程问题。
          </div>
          <div
            v-for="(m, i) in messages"
            :key="i"
            :class="['msg', m.role]"
            :data-testid="`ipd-ai-msg-${m.role}`"
          >
            <div class="bubble">
              {{ m.content }}<span v-if="m.streaming" class="cursor">▍</span>
            </div>
            <div v-if="m.role === 'assistant' && m.sources?.length" class="sources">
              来源：{{ m.sources.join('；') }}
            </div>
          </div>
          <div v-if="cardView" class="ipd-ai-card-host" data-testid="ipd-ai-card-host">
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
        </div>
        <div class="input-row">
          <Input
            v-model:value="inputText"
            :maxlength="2000"
            :disabled="sending"
            placeholder="输入问题，回车发送（≤2000 字）"
            data-testid="ipd-ai-input"
            @keyup.enter="send"
          />
          <Button
            :loading="sending"
            data-testid="ipd-ai-send"
            type="primary"
            @click="send"
          >
            发送
          </Button>
          <Button data-testid="ipd-ai-new" title="开启新会话" @click="clearConversation">
            新会话
          </Button>
        </div>
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
  background: var(--ipd-blue, #2f6fed);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(47, 111, 237, 0.35);
}
.ipd-ai-fab:focus-visible {
  outline: 2px solid var(--ipd-focus-ring-color, #2f6fed);
  outline-offset: 2px;
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
.ctx-chip {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--ipd-surface, #f5f7fa);
  border: 1px solid var(--ipd-line, #e2e8f0);
  color: var(--ipd-muted, #6b7488);
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
.empty-hint {
  color: var(--ipd-muted, #6b7488);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 4px;
}
.msg.user {
  align-self: flex-end;
}
.msg.assistant {
  align-self: flex-start;
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
.msg.user .bubble {
  background: var(--ipd-blue, #2f6fed);
  color: #fff;
  border-bottom-right-radius: 2px;
}
.msg.assistant .bubble {
  background: var(--ipd-surface, #f5f7fa);
  border: 1px solid var(--ipd-line, #e2e8f0);
  color: var(--ipd-text, #26303f);
  border-bottom-left-radius: 2px;
}
.msg .sources {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ipd-muted, #8b94a4);
}
.cursor {
  animation: ipd-ai-blink 1s step-end infinite;
}
@keyframes ipd-ai-blink {
  50% {
    opacity: 0;
  }
}
.input-row {
  display: flex;
  gap: 8px;
}
.input-row .ant-input {
  flex: 1;
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
  border: 1px dashed var(--ipd-line, #e2e8f0);
  background: var(--ipd-surface, #f5f7fa);
  color: var(--ipd-muted, #6b7488);
}
.ipd-ai-card-notice {
  border: 1px solid var(--ipd-line, #e2e8f0);
  background: var(--ipd-surface, #f5f7fa);
  color: var(--ipd-muted, #6b7488);
}
</style>
