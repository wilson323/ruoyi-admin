<script lang="ts" setup>
/**
 * 助手回合：把 &lt;think&gt; 与回答拆开，并给出复制 / 转发。
 *
 * 推理未闭合时默认展开（流式思考）；闭合后默认收起，原文仍可打开查看。
 * pace 为真时，只按已经收到的正文逐字揭示；卸掉组件或追平后清掉定时器。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

import { TEXT_REVEAL_INTERVAL_MS, nextRevealedMessage } from './ai-agent/text-reveal';
import { modelMessageParts } from './ai-workspace/model-message';
import MessageActions from './message-actions.vue';

/** 组件 props。 */
interface Props {
  content: string;
  /** 大块 TEXT_DELTA 按已收字符逐步揭示。副驾本身已逐 token，不要再开。 */
  pace?: boolean;
  streaming?: boolean;
}

const props = withDefaults(defineProps<Props>(), { pace: false, streaming: false });

const source = computed(() => modelMessageParts(props.content));
const shownReason = ref('');
const shownAnswer = ref('');
/** 本回合是否曾经处于流式，用来区分「打开历史全文」和「还在往下写」。 */
const live = ref(false);
const thinkBodyRef = ref<HTMLElement | null>(null);
let revealTimer: null | ReturnType<typeof setInterval> = null;

/** 停掉逐字揭示。组件卸载和追平后都要调用，避免定时器残留。 */
function clearReveal(): void {
  if (revealTimer === null) return;
  clearInterval(revealTimer);
  revealTimer = null;
}

/** 一次揭示已经收到的思考或回答，追平后停表。 */
function revealTick(): void {
  const next = nextRevealedMessage(
    { reasoning: shownReason.value, answer: shownAnswer.value },
    { reasoning: source.value.reasoning, answer: source.value.answer },
  );
  shownReason.value = next.reasoning;
  shownAnswer.value = next.answer;
  if (next.reasoning === source.value.reasoning && next.answer === source.value.answer) clearReveal();
}

/**
 * 对齐可见文字和已收全文。
 *
 * 未开启 pace，或这一回合从未进入流式，直接显示全文。流式中的新字符才进定时器。
 */
function syncReveal(): void {
  if (props.streaming) live.value = true;
  if (!props.pace || !live.value) {
    clearReveal();
    live.value = false;
    shownReason.value = source.value.reasoning;
    shownAnswer.value = source.value.answer;
    return;
  }
  if (!source.value.reasoning.startsWith(shownReason.value)) shownReason.value = '';
  if (!source.value.answer.startsWith(shownAnswer.value)) shownAnswer.value = '';
  if (shownReason.value === source.value.reasoning && shownAnswer.value === source.value.answer) {
    clearReveal();
    return;
  }
  if (revealTimer !== null) return;
  revealTimer = setInterval(revealTick, TEXT_REVEAL_INTERVAL_MS);
}

watch(() => [props.content, props.pace, props.streaming] as const, syncReveal, { immediate: true });
onUnmounted(clearReveal);

const parts = computed(() => ({
  answer: shownAnswer.value,
  reasoning: shownReason.value,
  reasoningOpen: source.value.reasoningOpen && shownAnswer.value === '',
}));
const caughtUp = computed(
  () => shownReason.value === source.value.reasoning && shownAnswer.value === source.value.answer,
);

/** 思考区跟着最新一行走，外层对话才能一直看见正在长出来的正文。 */
watch(
  () => parts.value.reasoning,
  async () => {
    await nextTick();
    const body = thinkBodyRef.value;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  },
);
</script>

<template>
  <div class="assistant-turn" data-testid="assistant-turn">
    <details
      v-if="parts.reasoning"
      class="think"
      :open="streaming && parts.reasoningOpen ? true : undefined"
      data-testid="assistant-think"
    >
      <summary data-testid="assistant-think-summary">
        <svg class="think-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span :class="['think-label', { 'is-live': streaming && !parts.answer }]">思考</span>
        <svg class="think-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <pre ref="thinkBodyRef" class="think-body" data-testid="assistant-think-body">{{ parts.reasoning }}<span v-if="streaming && !parts.answer" class="cursor">▍</span></pre>
    </details>
    <div v-if="parts.answer" class="answer" data-testid="assistant-answer">
      {{ parts.answer }}<span v-if="streaming || !caughtUp" class="cursor">▍</span>
    </div>
    <span v-else-if="streaming || !caughtUp" class="cursor">▍</span>
    <MessageActions v-if="!streaming && caughtUp && source.answer" :text="source.answer" />
  </div>
</template>

<style scoped>
.assistant-turn,
.think,
.think summary {
  max-width: 100%;
  white-space: normal;
}
.think {
  margin-bottom: 6px;
  color: var(--ipd-muted);
}
.think summary {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}
.think summary::-webkit-details-marker {
  display: none;
}
.think-label {
  white-space: nowrap;
}
.think:not([open]) .think-body {
  display: none;
}
.think-body,
.answer {
  margin: 4px 0 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}
.think-body {
  max-height: 9.5em;
  overflow: auto;
  scroll-behavior: auto;
  color: var(--ipd-muted);
}
.answer {
  color: inherit;
}
.cursor {
  animation: ipd-ai-blink 1s step-end infinite;
}
@keyframes ipd-ai-blink {
  50% {
    opacity: 0;
  }
}
</style>
