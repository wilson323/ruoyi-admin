<script lang="ts" setup>
/**
 * 项目智能体运行时间线。
 *
 * <p>只渲染后端真实事件（经 timeline-model 折叠）：步骤、工具调用 / 结果、来源、文本增量、
 * 产物、错误、完成。没有事件时不显示任何虚构步骤。
 *
 * <p>三态区分：
 * - 未发起：hasRun=false → 引导文案；
 * - 加载：已发起、尚无事件且仍在轮询 → role=status「正在等待智能体事件」；
 * - 失败：errorText 非空 → Alert（文案走 description prop，重试按钮放在 Alert 外，
 *   见 CLAUDE.md F8：description prop 与插槽同供时插槽被吞）；已收到的事件继续保留展示。
 *
 * <p>ARTIFACT：仅当 payload 带持久 artifactId 且本组件收到 runId 时展示「工作成果定档」
 * （调用已有 applyAgentRunArtifact，回填本项目文档链）。知识库是否入库只展示回执
 * indexStatus，NOT_INDEXED 不得写成已入库。定档用逻辑 artifactId。产物点赞只在
 * payload 带字符串 versionId 时渲染，旧事件没有 versionId 就不打点赞。
 *
 * <p>防注入：普通条目文本插值，正文复用净化后的Markdown；来源链接仅 http/https。
 * full 变体在生成当时另挂一块预览（文档安全Markdown，HTML 用 sandbox="" 的 iframe），
 * 不等定档。artifacts 变体不挂这块预览。
 */
import { computed, reactive, ref } from 'vue';
import { Alert, Button, Tag } from 'ant-design-vue';

import AiLoadingState from '../ai-loading-state.vue';

import {
  agentRunStatusMeta,
  applyAgentRunArtifact,
  type AgentRunEvent,
  type AgentRunResumeEntry,
} from '../../../../api/ipd/project-agent';
import { listAiDocumentVersions } from '../../../../api/ipd/ai-document';
import { ipdErrorText } from '../ipd-error-text';
import AssistantTurn from '../assistant-turn.vue';
import SafeMarkdown from '../safe-markdown';
import { verificationGaps } from './verification-gaps';
import { archiveResultText } from './artifact-archive';
import { deliveredDocumentPreview } from './artifact-live-preview';
import ArtifactLivePreview from './artifact-live-preview.vue';
import type { ClarificationChoice } from './clarification-choices';
import FeedbackBar from './feedback-bar.vue';
import IntentCard from './intent-card.vue';
import AguiInterruptForm from './agui-interrupt-form.vue';
import SkillsReviewPanel from './skills-review-panel.vue';
import type { AgentInterruptPause } from './agui-interrupt';
import ToolCallCard from './tool-call-card.vue';
import { foldTimelineRows } from './tool-call-rows';
import { buildTimelineItems, type TimelineItem } from './timeline-model';

/** 单条产物「工作成果定档」的交互态。 */
interface ArtifactApplyState {
  applied: boolean;
  errorText: string;
  loading: boolean;
  /** 定档成功后的回执说明（文档编号、状态、知识库索引）。 */
  receiptText: string;
}

/** 组件 props。 */
interface Props {
  /** 已去重、升序的真实事件。 */
  events: readonly AgentRunEvent[];
  interruptPause?: AgentInterruptPause | null;
  responding?: boolean;
  responseErrorText?: string;
  artifactArchives?: Array<{ artifactId: string; documentId: string }>;
  /** 是否已发起运行。 */
  hasRun: boolean;
  verifying?: boolean;
  reverifying?: boolean;
  reverifyErrorText?: string;
  /** 当前运行 ID；空时不渲染「工作成果定档」（路径需要 runId）。 */
  runId?: null | string;
  /** 是否仍在轮询事件。 */
  loading?: boolean;
  /** 已转成中文的错误文案；空串表示无错误。 */
  errorText?: string;
  /** 为 false 时不渲染定档按钮（定档留在左侧产物列，避免两处各写一次）。 */
  showArchive?: boolean;
  /** artifacts 只保留产物事件，供左侧定档列使用。 */
  variant?: 'artifacts' | 'full';
  /** 当前运行的动作码。空表示未绑定，计划确认卡据此决定要不要按钮。 */
  actionCode?: null | string;
}

const props = withDefaults(defineProps<Props>(), {
  actionCode: null,
  errorText: '',
  loading: false,
  runId: null,
  showArchive: true,
  variant: 'full',
});

const emit = defineEmits<{
  respond: [entries: AgentRunResumeEntry[]];
  choose: [choice: ClarificationChoice];
  execute: [steps: string[]];
  retry: [];
  reverify: [];
  rework: [association: { previousRunId: string; targetDocumentId: string; baseVersionId: string; comment: string }];
  revise: [];
}>();

const skillReviewRefreshSeq = computed(() => props.events.filter(event => event.type === 'RUN_FINISHED'
  || event.type === 'TOOL_RESULT' || event.type === 'STEP').at(-1)?.seq ?? 0);
const verification = computed(() => verificationGaps(props.events));
const evidenceRoot = ref<HTMLElement | null>(null);
const timelineRoot = ref<HTMLElement | null>(null);
function locateEvidence(path: string): void {
  if (path !== 'artifact:body') return;
  const target = livePreview.value ? evidenceRoot.value
    : timelineRoot.value?.querySelector<HTMLElement>('[data-kind="artifact"], [data-kind="text"]');
  target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  if (target) { target.tabIndex = -1; target.focus(); }
}

const shownEvents = computed(() =>
  props.variant === 'artifacts' ? props.events.filter((event) => event.type === 'ARTIFACT') : props.events,
);
const items = computed(() => buildTimelineItems(shownEvents.value));
/** 仅 full：可信父交付事件生成即预览；普通回答和澄清不靠标题推断文档。 */
const livePreview = computed(() => {
  if (props.variant !== 'full') return null;
  return deliveredDocumentPreview(props.events);
});
const rows = computed(() => foldTimelineRows(items.value, props.loading));
/** 只有最后一段正文显示输入光标，避免前面已经写完的段落一起闪。 */
const liveTextKey = computed(() => {
  if (!props.loading) return '';
  for (let index = rows.value.length - 1; index >= 0; index -= 1) {
    const row = rows.value[index];
    if (row?.kind === 'plain' && row.item.kind === 'text') return row.item.key;
  }
  return '';
});
const isWaiting = computed(() => props.hasRun && items.value.length === 0 && props.loading && !props.errorText);
const isEmptyRun = computed(() => props.hasRun && items.value.length === 0 && !props.loading && !props.errorText);

/** 按 artifactId 记录应用态（仅内存，不跨运行持久化）。 */
const applyByArtifact = reactive<Record<string, ArtifactApplyState>>({});

/** 条目类型 → 中文标签。 */
const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  'artifact': '产物',
  'error': '错误',
  'intent': '意图',
  'memory-note': '记忆',
  'run-finished': '运行结束',
  'run-started': '运行开始',
  'source': '来源',
  'step': '步骤',
  'text': '输出',
  'tool-call': '调用工具',
  'tool-result': '工具结果',
};

/** 运行结束条目的状态标签（状态缺失时不编造）。 */
function finishedLabel(item: Extract<TimelineItem, { kind: 'run-finished' }>): string {
  return item.status ? agentRunStatusMeta(item.status).label : '';
}

/** 仅非空字符串视为可调用 apply 的 runId。 */
function persistentRunId(): null | string {
  return typeof props.runId === 'string' && props.runId.trim() !== '' ? props.runId : null;
}

/**
 * 将产物定档回填到本项目文档（复用 api/ipd/project-agent.applyAgentRunArtifact）。
 *
 * 不另开文档写入。知识库索引状态只转述回执，审核前保持未入库。
 *
 * @param artifactId 事件 payload 中的持久产物 ID
 */
const appliedDocumentIds = reactive<Record<string, string>>({});
function archiveDocumentId(artifactId: string): string | undefined {
  return props.artifactArchives?.find(a => a.artifactId === artifactId)?.documentId
    ?? appliedDocumentIds[`${persistentRunId()}:${artifactId}`];
}

async function onApplyArtifact(artifactId: string): Promise<void> {
  const run = persistentRunId();
  if (!run || !artifactId) return;
  const prev = applyByArtifact[artifactId];
  if (prev?.loading || prev?.applied) return;
  applyByArtifact[artifactId] = { loading: true, errorText: '', applied: false, receiptText: '' };
  try {
    const receipt = await applyAgentRunArtifact(run, artifactId);
    if (persistentRunId() !== run) return;
    const receiptText = archiveResultText(receipt);
    if (receipt.documentId) appliedDocumentIds[`${run}:${artifactId}`] = receipt.documentId;
    applyByArtifact[artifactId] = {
      loading: false,
      errorText: receiptText ? '' : '产物未能回填项目文档，请稍后重试',
      applied: receiptText !== '',
      receiptText,
    };
  } catch (error) {
    if (persistentRunId() !== run) return;
    applyByArtifact[artifactId] = {
      loading: false,
      applied: false,
      receiptText: '',
      errorText: ipdErrorText(error, { fallback: '工作成果定档失败，请稍后重试' }),
    };
  }
}
/** 返工只读权威关联和文档链头，不调用 apply 来猜定档状态。 */
async function onReworkArtifact(artifactId: string): Promise<void> {
  const run = persistentRunId();
  const documentId = archiveDocumentId(artifactId);
  if (!run || !documentId) return;
  try {
    const versions = await listAiDocumentVersions(documentId);
    if (persistentRunId() !== run) return;
    const head = [...versions].sort((a, b) => b.versionNo - a.versionNo)[0];
    if (!head || head.status !== 'REJECTED' || !head.reviewComment?.trim()) {
      throw new Error('这份文档没有待处理的退回意见，请先核对审核结果');
    }
    emit('rework', { previousRunId: run, targetDocumentId: documentId,
      baseVersionId: head.id, comment: head.reviewComment });
  } catch (error) {
    applyByArtifact[artifactId] = { loading: false, applied: false, receiptText: '',
      errorText: ipdErrorText(error, { fallback: '无法读取退回意见，请稍后重试' }) };
  }
}
</script>

<template>
  <section class="ipd-agent-timeline" aria-label="智能体运行时间线" data-testid="agent-run-timeline">
    <Alert
      v-if="errorText"
      type="error"
      show-icon
      message="运行事件获取失败"
      :description="errorText"
      data-testid="timeline-error"
    />
    <Button v-if="errorText" size="small" class="timeline-retry" data-testid="timeline-retry" @click="emit('retry')">
      重新拉取事件
    </Button>

    <p v-if="!hasRun" class="timeline-hint" data-testid="timeline-idle">
      尚未发起运行，发起后这里按智能体的真实事件逐条展示。
    </p>
    <AiLoadingState
      v-else-if="isWaiting"
      data-testid="timeline-waiting"
      label="正在等待智能体事件"
    />
    <p v-else-if="isEmptyRun" class="timeline-hint" data-testid="timeline-empty">本次运行暂无事件。</p>

    <SkillsReviewPanel v-if="variant === 'full' && persistentRunId()" :run-id="persistentRunId()!" :refresh-seq="skillReviewRefreshSeq" />
    <section v-if="variant === 'full' && verifying" data-testid="verification-gaps" aria-label="需要补充的内容">
      <strong>这些内容还需要补充</strong>
      <ul>
        <li v-for="check in verification?.checks ?? []" :key="check.id" :data-check-id="check.id">
          <span>{{ check.gapSummary }}</span>
          <Button v-if="check.evidencePath === 'artifact:body'" size="small" @click="locateEvidence(check.evidencePath)">查看对应正文</Button>
        </li>
      </ul>
      <p>重新检查只核对当前正文。需要补充或改写正文时，请取消本次运行，再说明需要补充的内容并重新发起；原记录会保留。</p>
      <Button v-if="verification" :loading="reverifying" :disabled="reverifying" data-testid="verification-recheck" @click="emit('reverify')">重新检查</Button>
      <p v-if="reverifyErrorText" role="alert">{{ reverifyErrorText }}</p>
    </section>
    <div ref="evidenceRoot" tabindex="-1" aria-label="当前产物正文" data-testid="verification-evidence">
      <ArtifactLivePreview v-if="livePreview" :loading="loading && !verifying" :preview="livePreview" />
    </div>

    <ol v-if="items.length > 0" ref="timelineRoot" class="timeline-list" aria-live="polite" aria-relevant="additions">
      <li
        v-for="row in rows"
        :key="row.kind === 'tool' ? row.card.key : row.item.key"
        :class="['timeline-item', row.kind === 'tool' ? 'is-tool-call' : `is-${row.item.kind}`]"
        :data-kind="row.kind === 'tool' ? 'tool-call' : row.item.kind"
        data-testid="timeline-item"
      >
        <template v-if="row.kind === 'tool'">
          <span class="item-kind">调用工具</span>
          <ToolCallCard
            :name="row.card.name"
            :state="row.card.state"
            :input="row.card.input"
            :output="row.card.output"
            :error="row.card.error"
          />
        </template>
        <template v-else>
        <span class="item-kind">{{ KIND_LABEL[row.item.kind] }}</span>
        <div class="item-body">
          <template v-if="row.item.kind === 'intent'">
            <IntentCard
              :events="shownEvents"
              :intent="row.item"
              :action-code="actionCode"
              @choose="emit('choose', $event)"
              @execute="emit('execute', $event)"
              @revise="emit('revise')"
            />
          </template>
          <template v-else-if="row.item.kind === 'step'">
            <strong v-if="row.item.title">{{ row.item.title }}</strong>
            <span v-if="row.item.detail" class="item-detail">{{ row.item.detail }}</span>
          </template>
          <template v-else-if="row.item.kind === 'source'">
            <a v-if="row.item.url" :href="row.item.url" target="_blank" rel="noopener noreferrer">
              {{ row.item.title || row.item.url }}
            </a>
            <span v-else>{{ row.item.title || row.item.reference }}</span>
            <span v-if="row.item.outcomeText" data-testid="source-outcome">{{ row.item.outcomeText }}</span>
            <span v-if="row.item.reasonText" data-testid="source-reason">{{ row.item.reasonText }}</span>
            <ul v-if="row.item.evidence.length > 0">
              <li v-for="(entry, index) in row.item.evidence" :key="`${row.item.key}-${index}`" data-testid="source-evidence">
                {{ entry.kindLabel }} {{ entry.sourceName }}
              </li>
            </ul>
          </template>
          <template v-else-if="row.item.kind === 'text'">
            <AssistantTurn
              pace
              :content="row.item.text"
              :streaming="row.item.key === liveTextKey"
            />
          </template>
          <template v-else-if="row.item.kind === 'artifact'">
            <strong>{{ row.item.title || '未命名产物' }}</strong>
            <Tag v-if="row.item.artifactType">{{ row.item.artifactType }}</Tag>
            <SafeMarkdown
              v-if="row.item.artifactId && row.item.preview"
              :content="row.item.preview"
              class="item-preview"
              data-testid="artifact-preview"
            />
            <div v-if="showArchive && row.item.artifactId && persistentRunId()" class="item-apply" data-testid="artifact-apply">
              <p class="item-apply-note" data-testid="artifact-archive-note">
                定档回填本项目文档链。知识库须审核后入库，不会标成已索引。
              </p>
              <Button
                size="small"
                type="primary"
                :loading="applyByArtifact[row.item.artifactId]?.loading === true"
                :disabled="applyByArtifact[row.item.artifactId]?.applied === true"
                data-testid="artifact-apply-btn"
                @click="onApplyArtifact(row.item.artifactId)"
              >
                工作成果定档
              </Button>
              <Button v-if="archiveDocumentId(row.item.artifactId)"
                size="small" data-testid="artifact-rework-btn" @click="onReworkArtifact(row.item.artifactId)">
                根据退回意见再做
              </Button>
              <span
                v-if="applyByArtifact[row.item.artifactId]?.applied"
                class="item-apply-ok"
                role="status"
                data-testid="artifact-apply-ok"
              >
                {{ applyByArtifact[row.item.artifactId]?.receiptText }}
              </span>
              <p
                v-if="applyByArtifact[row.item.artifactId]?.errorText"
                class="item-apply-error"
                role="alert"
                data-testid="artifact-apply-error"
              >
                {{ applyByArtifact[row.item.artifactId]?.errorText }}
              </p>
            </div>
            <FeedbackBar
              v-if="row.item.versionId"
              target-type="ARTIFACT_VERSION"
              :target-id="row.item.versionId"
              :label="`产物${row.item.title ? `：${row.item.title}` : ''}`"
            />
          </template>
          <template v-else-if="row.item.kind === 'memory-note'">
            <span role="status" data-testid="memory-receipt-note">{{ row.item.text }}</span>
          </template>
          <template v-else-if="row.item.kind === 'error'">
            <span class="item-error" role="alert">
              {{ row.item.message || '智能体返回错误' }}
            </span>
          </template>
          <template v-else-if="row.item.kind === 'run-finished'">
            <span>{{ finishedLabel(row.item) }}</span>
          </template>
        </div>
        </template>
      </li>
    </ol>
    <AguiInterruptForm v-if="variant === 'full' && interruptPause" :pause="interruptPause" :loading="responding" :error-text="responseErrorText" @respond="emit('respond', $event)" @refresh="emit('retry')" />
  </section>
</template>

<style scoped>
.ipd-agent-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--ipd-font, inherit);
  color: var(--ipd-text);
}
.timeline-retry {
  align-self: flex-start;
}
.timeline-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-muted);
}
.timeline-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.timeline-item {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
}
.timeline-item.is-error {
  border-color: var(--ipd-red);
}
.item-kind {
  flex: 0 0 64px;
  font-size: 12px;
  color: var(--ipd-muted);
}
.item-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
  min-width: 0;
}
.item-detail {
  color: var(--ipd-muted);
}
.item-code {
  max-width: 100%;
  font-size: 12px;
  word-break: break-all;
  white-space: pre-wrap;
}
.item-text {
  margin: 0;
  word-break: break-word;
  white-space: pre-wrap;
}
.item-preview {
  flex: 1 1 100%;
  max-height: 160px;
  padding: 8px;
  margin: 0;
  overflow: auto;
  font-size: 12px;
  font-family: var(--ipd-font, inherit);
  line-height: 1.45;
  color: var(--ipd-text);
  word-break: break-word;
  white-space: normal;
  background: var(--ipd-bg);
  border: 1px solid var(--ipd-line);
  border-radius: 4px;
}
.item-apply {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.item-apply-note {
  flex: 1 1 100%;
  margin: 0;
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.6;
}
.item-apply-ok {
  font-size: 12px;
  color: var(--ipd-green);
}
.item-apply-error {
  flex: 1 1 100%;
  margin: 0;
  font-size: 12px;
  color: var(--ipd-red);
}
.item-error {
  color: var(--ipd-red);
}
</style>
