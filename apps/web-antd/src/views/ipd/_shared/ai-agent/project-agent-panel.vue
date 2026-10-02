<script lang="ts" setup>
/**
 * 项目智能体面板（W1）。挂在 AI 工作界面；下方主输入框在 AI 模式只调用本组件的 submitText。
 *
 * <p>组合：能力选择器 + 任务输入 + 运行时间线 + 运行级反馈。所有状态来自
 * useProjectAgentRun；projectId 变化即重置运行并重新加载能力（项目隔离）。
 *
 * <p>硬约束：
 * - 能力开关关闭 / 能力不可用时展示后端原因，不回落到副驾 SSE 流；
 * - 幂等键在本组件生成：同一次提交失败重试复用同一个键，改动输入或成功后才换新键；
 * - 反馈只挂在持久 runId 上，且仅在运行结束后出现。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { Alert, Button, Input, Tag } from 'ant-design-vue';

import {
  agentRunStatusMeta,
  isAgentRunCancellable,
  listProjectAgentRuns,
  type AgentRunListItem,
} from '../../../../api/ipd/project-agent';
import CapabilityPicker from './capability-picker.vue';
import {
  ACTION_TOOL_GAP_NOTE,
  applyEntryDefaults,
  buildRunInput,
  describeActionEntryBlock,
  emptySelection,
  findSelectedPack,
  isSelectionSubmittable,
  sanitizeSelection,
  type AgentCapabilitySelection,
} from './capability-selection';
import FeedbackBar from './feedback-bar.vue';
import type { ClarificationChoice } from './clarification-choices';
import { confirmedPlanMessage } from './plan-confirm';
import RunTimeline from './run-timeline.vue';
import { createIdempotencyKey, useProjectAgentRun } from './use-project-agent-run';
import { useIpdAiWorkspace } from '../ai-workspace/use-ai-workspace';
import { ipdErrorText } from '../ipd-error-text';

/** 组件 props。 */
interface Props {
  /** 当前项目 ID（字符串）；为空时面板提示先选择项目。 */
  projectId: null | string;
  /** 可选动作编码（宿主为动作详情页或步骤动作时传入）。 */
  actionCode?: string;
  /** 该动作目录上的技能名；提交时只保留当前能力包里可用的。 */
  actionSkillNames?: string[];
  /** 事件轮询间隔（毫秒）。 */
  pollIntervalMs?: number;
  /**
   * 为 true 时能力包/模型/技能/工具只进对话框加号，左侧不渲染选择器。
   * 锚点晚于本面板挂载时会重试，避免选择器落回左侧。
   */
  controlsExternal?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  choose: [choice: ClarificationChoice];
}>();

/** 任务说明最大长度。 */
const MESSAGE_MAX = 4000;

/** 本轮已提交的任务说明。输入框清空后，对话栏仍用它显示用户气泡。打开历史时清空，避免把本轮提问安到另一条运行上。 */
const lastTask = ref('');
const historyQuery = ref('');
const historyItems = ref<AgentRunListItem[]>([]);
const historyLoading = ref(false);
const historyError = ref('');
let historyToken = 0;
const { focusPane } = useIpdAiWorkspace();

/**
 * 列表默认一页条数。
 * listProjectAgentRuns 的响应是数组，没有下一页字段；满这一页才把最后一条 runId 当 cursor。
 * 条数与 AgentRunListQuery.limit 的默认 20 一致。短页或空页不再请求。
 */
const HISTORY_PAGE_SIZE = 20;

/**
 * 历史只请求已有的列表接口。空项目清空，不编造行。
 * 不传 cursor 时服务端只给默认一页；这一页满了，用最后一条 runId 再请求。
 */
async function loadHistory(): Promise<void> {
  const token = ++historyToken;
  const pid = props.projectId;
  if (!pid) {
    historyItems.value = [];
    historyError.value = '';
    historyLoading.value = false;
    return;
  }
  historyLoading.value = true;
  historyError.value = '';
  const q = historyQuery.value.trim();
  try {
    const collected: AgentRunListItem[] = [];
    const seenRuns = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor = '';
    for (;;) {
      const rows = await listProjectAgentRuns(pid, {
        ...(q ? { q } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (token !== historyToken) return;
      const page = Array.isArray(rows) ? rows : [];
      for (const item of page) {
        if (!seenRuns.has(item.runId)) {
          seenRuns.add(item.runId);
          collected.push(item);
        }
      }
      const lastId = page.at(-1)?.runId ?? '';
      if (page.length < HISTORY_PAGE_SIZE) break;
      if (lastId === '' || seenCursors.has(lastId)) {
        throw new Error('运行列表尚未完整加载，请重试');
      }
      seenCursors.add(lastId);
      cursor = lastId;
    }
    if (token !== historyToken) return;
    historyItems.value = collected;
  } catch (error) {
    if (token !== historyToken) return;
    historyItems.value = [];
    historyError.value = ipdErrorText(error, { fallback: '运行列表加载失败' });
  } finally {
    if (token === historyToken) historyLoading.value = false;
  }
}

/** 产物标题；没有标题时不拿摘录冒充，也不展示提问。 */
function historyTitles(item: AgentRunListItem): string {
  const titles = Array.isArray(item.artifactTitles) ? item.artifactTitles.filter((title) => title !== '') : [];
  return titles.length > 0 ? titles.join('、') : '无产物';
}

watch(() => props.projectId, (pid, prev) => {
  lastTask.value = '';
  if (pid !== prev && historyQuery.value !== '') {
    historyQuery.value = '';
    return;
  }
  void loadHistory();
}, { immediate: true });

watch(historyQuery, () => {
  void loadHistory();
});

const agent = useProjectAgentRun(() => props.projectId, { pollIntervalMs: props.pollIntervalMs });
const {
  active,
  cancelError,
  cancelErrorText,
  cancelling,
  capabilities,
  capabilitiesErrorText,
  capabilitiesLoading,
  detail,
  detailErrorText,
  events,
  pollErrorText,
  polling,
  runId,
  status,
  submitErrorText,
  submitting,
  terminal,
} = agent;

/**
 * 打开列表中的一条运行，事件从 seq 0 整页替换，并定位到本次运行区。
 *
 * @param id 列表 runId
 */
async function openHistory(id: string): Promise<void> {
  lastTask.value = '';
  if (await agent.openRun(id)) focusPane('cards');
}

const titleId = `${useId()}-title`;
/** 面板自己的任务框。工作台把输入放到加号旁时，这个框不渲染。 */
const messageBox = ref<{ focus: () => void } | null>(null);
const selection = ref<AgentCapabilitySelection>(emptySelection());
const message = ref('');
let pendingKey: null | string = null;
const reworkAssociation = ref<null | { previousRunId: string; targetDocumentId: string; baseVersionId: string }>(null);
const reworkActionCode = ref<null | string>(null);
watch(() => props.projectId, () => { reworkAssociation.value = null; reworkActionCode.value = null; });

/** 能力清单、动作或目录技能变化：剔除失效选项，再按已批准技能和唯一可用模型补默认。 */
watch(
  [capabilities, () => props.actionCode, () => (props.actionSkillNames ?? []).join('\0')],
  ([caps]) => {
    selection.value = applyEntryDefaults(
      caps,
      sanitizeSelection(caps, selection.value),
      props.actionCode,
      props.actionSkillNames ?? [],
    );
  },
);

/**
 * 带动作进入时的阻断原因。没有动作时为空，不把「未选齐」说成已绑定。
 */
const entryBlockReason = computed(() => describeActionEntryBlock(
  capabilities.value,
  selection.value,
  props.actionCode,
  props.actionSkillNames ?? [],
));

/**
 * 动作已绑定且没有预选工具时的说明。加号里仍可勾选工具。
 */
const entryToolNote = computed(() => {
  const code = props.actionCode?.trim() ?? '';
  if (!code || entryBlockReason.value || selection.value.toolIds.length > 0) return '';
  const pack = findSelectedPack(capabilities.value, selection.value);
  if (!pack?.available || !pack.actionCodes.includes(code)) return '';
  return ACTION_TOOL_GAP_NOTE;
});

/** 输入变化即作废待复用的幂等键（新内容 = 新提交）。 */
watch([selection, message], () => {
  pendingKey = null;
}, { deep: true });

const canSubmit = computed(
  () =>
    !submitting.value &&
    !active.value &&
    message.value.trim() !== '' &&
    entryBlockReason.value === '' &&
    isSelectionSubmittable(capabilities.value, selection.value),
);
const canCancel = computed(() => active.value && status.value !== null && isAgentRunCancellable(status.value));
const statusMeta = computed(() => (status.value ? agentRunStatusMeta(status.value) : null));
const artifactEvents = computed(() => events.value.filter((event) => event.type === 'ARTIFACT'));
/** 中间栏挂上本次运行锚点后，完整时间线挪过去；定档留在左侧产物列。 */
const readoutReady = ref(false);
/** 工作台把选择器锚点放进输入框加号菜单时为 true，左侧不再放能力表单和任务框。 */
const controlsReady = ref(false);

let syncFrame = 0;
let syncTries = 0;

function syncReadoutTarget(): void {
  readoutReady.value = Boolean(document.getElementById('ipd-ai-run-readout'));
  controlsReady.value = Boolean(document.getElementById('ipd-ai-agent-controls'));
}

/** 锚点在对话框里，可能比本面板晚进入文档，找到为止。 */
function syncUntilAnchors(): void {
  syncReadoutTarget();
  const controlsPending = props.controlsExternal && !controlsReady.value;
  const readoutPending = !readoutReady.value && document.getElementById('ipd-ai-run-readout') === null;
  if ((!controlsPending && !readoutPending) || syncTries >= 20) return;
  syncTries += 1;
  syncFrame = requestAnimationFrame(syncUntilAnchors);
}

onMounted(() => {
  void nextTick(syncUntilAnchors);
});

onUnmounted(() => {
  if (syncFrame !== 0) cancelAnimationFrame(syncFrame);
});

/** 地址栏上的需求单只接受数字，避免把别的查询参数送进运行。 */
function demandRequirementId(): string | undefined {
  const value = new URLSearchParams(window.location.search).get('requirementId') ?? '';
  return /^\d+$/.test(value) ? value : undefined;
}

/** 分拣页打开时，同一次创建运行带上需求单。没有该参数时请求体不变。 */
function withDemand<T extends { requirementId?: string }>(input: T): T {
  const requirementId = demandRequirementId();
  return requirementId ? { ...input, requirementId } : input;
}

/** 发起运行（失败保留幂等键供重试复用）。 */
async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  pendingKey ??= createIdempotencyKey();
  const input = buildRunInput(
    capabilities.value,
    selection.value,
    message.value,
    pendingKey,
    reworkActionCode.value ?? props.actionCode,
    props.actionSkillNames ?? [],
  );
  const requested = (reworkActionCode.value ?? props.actionCode)?.trim() ?? '';
  if (!input || (requested !== '' && input.actionCode !== requested)) return;
  if (await agent.startRun(withDemand({ ...input, ...(reworkAssociation.value ?? {}) }))) {
    lastTask.value = message.value;
    reworkAssociation.value = null;
    reworkActionCode.value = null;
    message.value = '';
    pendingKey = null;
  }
}

/**
 * 主输入框把文字交给本面板的同一条创建路径。
 *
 * 不新建请求客户端，也不回落到副驾流。能力包或模型未选齐时返回 need-selection，
 * 由宿主提示用户在对话框补选，而不是改走 streamCopilot。
 *
 * @param text 用户任务说明（空白视为失败）
 * @returns started 已创建；need-project 未选项目；need-selection 能力未齐；busy 已有运行；failed 创建被拒绝
 */
async function submitText(text: string): Promise<'busy' | 'failed' | 'need-project' | 'need-selection' | 'started'> {
  const trimmed = text.trim();
  if (!props.projectId) return 'need-project';
  if (!trimmed) return 'failed';
  if (submitting.value || active.value) return 'busy';
  message.value = trimmed;
  await nextTick();
  if (entryBlockReason.value || !canSubmit.value) return 'need-selection';
  await submit();
  return submitErrorText.value ? 'failed' : 'started';
}

/** 当前运行详情上的动作码。详情未到之前视为还没绑定。 */
const runActionCode = computed(() => detail.value?.actionCode ?? null);
let confirming = false;

/**
 * 聚焦已经在页面上的任务输入框。
 * 工作台把输入放在加号旁时用那个框，否则用本面板自己的框。不发请求。
 */
function focusTaskInput(): void {
  const external = document.querySelector<HTMLTextAreaElement>('[data-testid="ipd-ai-input"]');
  if (external) {
    external.focus();
    return;
  }
  messageBox.value?.focus();
}

/**
 * 按已确认计划再开一次运行。
 *
 * 当前运行仍可取消时先走已有 cancel，再用新的幂等键走已有 create。
 * 正文第一行固定，随后每行一条事件里的步骤。不提交 actionCode。
 *
 * @param steps 计划卡从事件 steps 取出的原文字符串
 */
async function confirmPlan(steps: readonly string[]): Promise<void> {
  if (confirming || submitting.value) return;
  const caps = capabilities.value;
  if (!caps || !props.projectId) return;
  confirming = true;
  try {
    const waiting = status.value !== null && isAgentRunCancellable(status.value);
    if (waiting) {
      await agent.cancel();
      if (cancelError.value) return;
    }
    if (active.value) agent.resetRun();
    const key = createIdempotencyKey();
    const exact = confirmedPlanMessage(steps);
    const built = buildRunInput(caps, selection.value, exact, key);
    if (!built) return;
    const { actionCode: _actionCode, ...withoutAction } = built;
    void _actionCode;
    if (await agent.startRun(withDemand({ ...withoutAction, message: exact, idempotencyKey: key }))) {
      lastTask.value = exact;
      pendingKey = null;
    }
  } finally {
    confirming = false;
  }
}

/**
 * 点澄清选项后走已有创建运行。
 *
 * 当前运行还能取消时先取消，再把选中项组成的正文交给 submitText。不另开会话协议。
 *
 * @param text 已写成「已选：…。」的发送正文
 * @returns 与 submitText 相同的结果
 */
async function answerClarification(
  text: string,
): Promise<'busy' | 'failed' | 'need-project' | 'need-selection' | 'started'> {
  if (confirming || submitting.value) return 'busy';
  confirming = true;
  try {
    const waiting = status.value !== null && isAgentRunCancellable(status.value);
    if (waiting) {
      await agent.cancel();
      if (cancelError.value) return 'failed';
    }
    if (active.value) agent.resetRun();
    return await submitText(text);
  } finally {
    confirming = false;
  }
}

/** 明确选择已定档产物后，仍走原 submitText/create 发送路径。 */
async function reworkArtifact(association: { previousRunId: string; targetDocumentId: string; baseVersionId: string; comment: string }): Promise<void> {
  if (active.value || submitting.value || !runActionCode.value) return;
  selection.value = applyEntryDefaults(capabilities.value, selection.value, runActionCode.value, []);
  reworkActionCode.value = runActionCode.value;
  reworkAssociation.value = { previousRunId: association.previousRunId,
    targetDocumentId: association.targetDocumentId, baseVersionId: association.baseVersionId };
  try {
    await submitText(`请根据以下退回意见修订原文档，保留已证实的内容，纠正未获证据支持的表述：\n${association.comment}`);
  } finally {
    // 关联只属于这次明确点击；失败或缺少选择不能污染下一次普通发送。
    reworkAssociation.value = null;
    reworkActionCode.value = null;
    pendingKey = null;
  }
}

defineExpose({
  active,
  answerClarification,
  confirmPlan,
  entryBlockReason,
  entryToolNote,
  events,
  focusTaskInput,
  lastTask,
  runActionCode,
  submitText,
  syncReadoutTarget,
});

/** Ctrl/Cmd + Enter 快捷提交。 */
function onMessageKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <section class="ipd-agent-panel" :aria-labelledby="titleId" data-testid="project-agent-panel">
    <header class="panel-header">
      <h3 :id="titleId" class="panel-title">项目智能体</h3>
      <Tag v-if="statusMeta" :color="statusMeta.color" data-testid="panel-status">{{ statusMeta.label }}</Tag>
    </header>

    <section class="run-history" data-testid="agent-run-history">
      <h4>历史</h4>
      <Input
        v-if="projectId"
        v-model:value="historyQuery"
        allow-clear
        size="small"
        placeholder="搜索动作、状态或产物"
        aria-label="搜索历史运行"
        data-testid="agent-run-history-query"
      />
      <p v-if="historyLoading" class="panel-hint" role="status">正在加载历史运行…</p>
      <p v-else-if="historyError" class="panel-error" role="alert">{{ historyError }}</p>
      <p v-else-if="!projectId || historyItems.length === 0" data-testid="agent-run-history-empty">
        {{ projectId ? '没有匹配的运行' : '请先选择项目。' }}
      </p>
      <ul v-else class="history-list">
        <li v-for="item in historyItems" :key="item.runId">
          <button
            type="button"
            class="history-row"
            data-testid="agent-run-history-row"
            :data-run-id="item.runId"
            @click="openHistory(item.runId)"
          >
            <span>{{ item.actionCode || '未绑定动作' }}</span>
            <span>{{ agentRunStatusMeta(item.status).label }}</span>
            <span>{{ item.createdAt }}</span>
            <span>{{ historyTitles(item) }}</span>
            <span>{{ item.inputChars }} 字</span>
          </button>
        </li>
      </ul>
    </section>
    <section v-if="readoutReady" class="run-artifacts" data-testid="agent-run-artifacts">
      <h4>AI 产物</h4>
      <p v-if="artifactEvents.length === 0" data-testid="agent-run-artifacts-empty">本次运行还没有可定档产物。</p>
      <RunTimeline
        v-else
        variant="artifacts"
        :events="artifactEvents"
        :artifact-archives="detail?.artifactArchives"
        @rework="reworkArtifact"
        :has-run="true"
        :run-id="runId"
        :action-code="runActionCode"
        :loading="active || polling"
        :error-text="pollErrorText"
        @retry="agent.resume()"
      />
    </section>

    <p v-if="!projectId" class="panel-hint" data-testid="panel-no-project">请先选择项目。</p>

    <template v-else>
      <p v-if="capabilitiesLoading" class="panel-hint" role="status" data-testid="panel-cap-loading">
        正在加载智能体能力…
      </p>
      <template v-else-if="capabilitiesErrorText">
        <Alert
          type="error"
          show-icon
          message="项目智能体暂不可用"
          :description="capabilitiesErrorText"
          data-testid="panel-cap-error"
        />
        <Button size="small" class="panel-retry" data-testid="panel-cap-retry" @click="agent.loadCapabilities()">
          重新加载
        </Button>
      </template>

      <template v-else-if="capabilities">
        <CapabilityPicker
          v-if="!controlsExternal && !controlsReady"
          v-model="selection"
          :capabilities="capabilities"
          :disabled="active || submitting"
        />
        <Teleport v-if="controlsReady" to="#ipd-ai-agent-controls">
          <CapabilityPicker
            v-model="selection"
            :capabilities="capabilities"
            :disabled="active || submitting"
          />
        </Teleport>
        <Alert
          v-if="entryBlockReason"
          type="warning"
          show-icon
          :message="entryBlockReason"
          data-testid="panel-entry-block"
        />
        <p v-else-if="entryToolNote" class="panel-hint" data-testid="panel-entry-tool-note">
          {{ entryToolNote }}
        </p>

        <Input.TextArea
          v-if="!controlsReady"
          ref="messageBox"
          v-model:value="message"
          :maxlength="MESSAGE_MAX"
          :auto-size="{ minRows: 2, maxRows: 6 }"
          :disabled="active || submitting"
          aria-label="发送给项目智能体的任务说明"
          placeholder="描述要智能体完成的任务（Ctrl/⌘ + Enter 发起）"
          data-testid="panel-message"
          @keydown="onMessageKeydown"
        />

        <div class="panel-actions">
          <Button
            v-if="!controlsReady"
            type="primary"
            :disabled="!canSubmit"
            :loading="submitting"
            data-testid="panel-submit"
            @click="submit"
          >
            发起运行
          </Button>
          <Button
            v-if="canCancel"
            danger
            :loading="cancelling"
            data-testid="panel-cancel"
            @click="agent.cancel()"
          >
            取消运行
          </Button>
        </div>

        <p v-if="submitErrorText" class="panel-error" role="alert" data-testid="panel-submit-error">
          {{ submitErrorText }}
        </p>
        <p v-if="cancelErrorText" class="panel-error" role="alert" data-testid="panel-cancel-error">
          {{ cancelErrorText }}
        </p>
        <p v-if="detailErrorText" class="panel-warn" data-testid="panel-detail-error">{{ detailErrorText }}</p>
      </template>

      <RunTimeline
        v-if="!readoutReady"
        :events="events"
        :artifact-archives="detail?.artifactArchives"
        @rework="reworkArtifact"
        :has-run="runId !== null"
        :run-id="runId"
        :action-code="runActionCode"
        :loading="active || polling"
        :error-text="pollErrorText"
        @choose="emit('choose', $event)"
        @execute="confirmPlan"
        @revise="focusTaskInput"
        @retry="agent.resume()"
      />
      <Teleport v-else to="#ipd-ai-run-readout">
        <RunTimeline
          :show-archive="false"
          :events="events"
        :artifact-archives="detail?.artifactArchives"
        @rework="reworkArtifact"
          :has-run="runId !== null"
          :run-id="runId"
          :action-code="runActionCode"
          :loading="active || polling"
          :error-text="pollErrorText"
          @choose="emit('choose', $event)"
          @execute="confirmPlan"
          @revise="focusTaskInput"
          @retry="agent.resume()"
        />
      </Teleport>

      <p v-if="terminal && detail?.errorCode" class="panel-warn" data-testid="panel-error-code">
        失败码：{{ detail.errorCode }}
      </p>
      <FeedbackBar v-if="terminal" target-type="RUN_MESSAGE" :target-id="runId" label="本次运行" />
    </template>
  </section>
</template>

<style scoped>
.run-history,
.run-artifacts {
  display: grid;
  gap: 6px;
}
.run-history h4,
.run-artifacts h4 {
  margin: 0;
  color: var(--ipd-text);
  font-size: 13px;
}
.run-history p,
.run-artifacts p {
  margin: 0;
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.6;
}
.history-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.history-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
  color: var(--ipd-text);
  text-align: left;
  background: transparent;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
  cursor: pointer;
}
.ipd-agent-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  font-family: var(--ipd-font, inherit);
  color: var(--ipd-text);
  background: var(--ipd-bg);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}
.panel-header {
  display: flex;
  gap: 8px;
  align-items: center;
}
.panel-title {
  margin: 0;
  font-size: 15px;
  color: var(--ipd-navy);
}
.panel-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-muted);
}
.panel-retry {
  align-self: flex-start;
}
.panel-actions {
  display: flex;
  gap: 8px;
}
.panel-error {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-red);
}
.panel-warn {
  margin: 0;
  font-size: 12px;
  color: var(--ipd-amber);
}
</style>
