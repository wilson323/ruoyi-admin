<script lang="ts" setup>
/**
 * 意图卡：只挂在中间「本次运行」。
 *
 * 澄清问题画成可点选项（对齐 21st Question Tool：A/B 徽章、选中态、已答禁用）。
 * 计划步骤单独成有序列表。未绑定动作的计划确认才出「开始执行 / 先改范围」。
 * 点选项仍由宿主走 answerClarification → createProjectAgentRun，不另开发送轨。
 */
import { computed, ref, watch } from 'vue';

import type { AgentRunEvent } from '../../../../api/ipd/project-agent';
import {
  CLARIFICATION_STILL_RUNNING,
  clarificationChoices,
  clarificationOptionBadge,
  clarificationOptionsLocked,
  clarificationStillGenerating,
  type ClarificationChoice,
} from './clarification-choices';
import { BOUND_PLAN_SENTENCE, planConfirmView } from './plan-confirm';
import {
  intentStepMarks,
  type AgentIntentView,
} from './timeline-model';

/** 组件 props。 */
interface Props {
  events: readonly AgentRunEvent[];
  intent: AgentIntentView;
  /** 当前运行的动作码。空表示这次运行没有绑定动作。 */
  actionCode?: null | string;
}

const props = withDefaults(defineProps<Props>(), { actionCode: null });
const emit = defineEmits<{
  choose: [choice: ClarificationChoice];
  execute: [steps: string[]];
  revise: [];
}>();

/** 本卡内刚点过的选项；切到下一轮 INTENT 时清空。 */
const picked = ref<null | ClarificationChoice>(null);

watch(
  () => [props.intent.questions.join('\0'), props.intent.needsClarification] as const,
  () => {
    picked.value = null;
  },
);

/** 澄清问题拆成的全部选项，不丢第一项之后的选项。 */
const choices = computed(() =>
  props.intent.needsClarification ? clarificationChoices(props.intent.questions) : [],
);
/** 有成对引号时保留原问题一句，避免选项离开原句。 */
const choiceQuestions = computed(() => {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const choice of choices.value) {
    if (choice.option === choice.question || seen.has(choice.question)) continue;
    seen.add(choice.question);
    lines.push(choice.question);
  }
  return lines;
});
/** 闸门没停住内核、并且已经写出正文或工具时，才说明仍会继续。 */
const stillGenerating = computed(() =>
  clarificationStillGenerating(props.events, props.intent.needsClarification),
);
/** 历史已结束的澄清，或本卡刚点过，都禁用再点。 */
const optionsLocked = computed(
  () => clarificationOptionsLocked(props.events) || picked.value !== null,
);
/** 计划步骤的展示状态，条数与 payload.steps 相同。 */
const marks = computed(() => intentStepMarks(props.events, props.intent.steps.length));
/** 计划确认交互：按钮、固定句，或两者都没有。 */
const offer = computed(() => planConfirmView(props.events, props.actionCode));
/** 未绑定计划确认的步骤原文。不是这种卡时为空。 */
const unboundSteps = computed(() => (offer.value.kind === 'unbound' ? offer.value.steps : []));

/**
 * 点中一个澄清选项：记下选中态，再交给宿主创建下一轮运行。
 *
 * @param choice 被点中的那一项
 */
function onChoose(choice: ClarificationChoice): void {
  if (optionsLocked.value) return;
  picked.value = choice;
  emit('choose', choice);
}
</script>

<template>
  <article class="intent-card" data-testid="agent-intent-card">
    <strong v-if="intent.title">{{ intent.title }}</strong>
    <p v-if="intent.detail" class="intent-detail" data-testid="intent-detail">{{ intent.detail }}</p>
    <p data-testid="intent-needs-plan">{{ intent.needsPlan ? '要计划' : '不要计划' }}</p>
    <p data-testid="intent-needs-clarification">{{ intent.needsClarification ? '要澄清' : '不要澄清' }}</p>
    <div
      v-if="choices.length > 0"
      class="intent-options"
      data-testid="intent-questions"
    >
      <p v-for="(line, index) in choiceQuestions" :key="`line-${index}`" class="intent-note">{{ line }}</p>
      <p v-if="picked" class="intent-note" data-testid="intent-option-picked">
        已选：{{ picked.option }}
      </p>
      <button
        v-for="(choice, index) in choices"
        :key="`opt-${index}`"
        type="button"
        class="intent-option"
        data-testid="intent-option"
        :aria-pressed="picked?.option === choice.option"
        :class="{ 'is-selected': picked?.option === choice.option }"
        :disabled="optionsLocked"
        @click="onChoose(choice)"
      >
        <span class="intent-option-badge" aria-hidden="true">{{ clarificationOptionBadge(index) }}</span>
        <span class="intent-option-label">{{ choice.option }}</span>
      </button>
    </div>
    <p v-if="stillGenerating" class="intent-note" data-testid="intent-clarification-pending">
      {{ CLARIFICATION_STILL_RUNNING }}
    </p>
    <ol
      v-if="intent.needsPlan && intent.steps.length > 0"
      class="intent-list"
      data-testid="intent-steps"
    >
      <li v-for="(step, index) in intent.steps" :key="`s-${index}`">
        {{ step }}
        <span class="intent-mark">{{ marks[index] }}</span>
      </li>
    </ol>
    <p v-if="offer.kind === 'bound'" class="intent-note" data-testid="intent-bound-plan">
      {{ BOUND_PLAN_SENTENCE }}
    </p>
    <div v-if="offer.kind === 'unbound'" class="intent-actions" data-testid="intent-plan-actions">
      <button type="button" data-testid="intent-plan-execute" @click="emit('execute', unboundSteps)">
        开始执行
      </button>
      <button type="button" data-testid="intent-plan-revise" @click="emit('revise')">
        先改范围
      </button>
    </div>
  </article>
</template>

<style scoped>
.intent-card {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 12px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  font-size: 13px;
  line-height: 1.55;
}
.intent-detail,
.intent-note,
.intent-card p {
  margin: 0;
}
.intent-list {
  flex: 1 1 100%;
  margin: 0;
  padding-left: 1.2em;
}
.intent-mark {
  margin-left: 6px;
  color: var(--ipd-muted);
  font-size: 12px;
}
.intent-actions,
.intent-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.intent-options {
  flex: 1 1 100%;
}
.intent-options .intent-note {
  flex: 1 1 100%;
}
.intent-actions button,
.intent-option {
  padding: 2px 8px;
  font: inherit;
  font-size: 12px;
  color: var(--ipd-text);
  background: transparent;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
  cursor: pointer;
}
.intent-option {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  text-align: left;
}
.intent-option:disabled {
  cursor: default;
  opacity: 0.72;
}
.intent-option.is-selected {
  border-color: var(--ipd-accent, #1677ff);
  background: color-mix(in srgb, var(--ipd-accent, #1677ff) 8%, transparent);
}
.intent-option-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 4px;
  border: 1px solid var(--ipd-line);
  border-radius: 4px;
  color: var(--ipd-muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}
.intent-option.is-selected .intent-option-badge {
  border-color: var(--ipd-accent, #1677ff);
  background: var(--ipd-accent, #1677ff);
  color: #fff;
}
.intent-option-label {
  min-width: 0;
}
.intent-note {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>
