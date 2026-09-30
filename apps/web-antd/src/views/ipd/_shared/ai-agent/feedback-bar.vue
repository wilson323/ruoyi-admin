<script lang="ts" setup>
/**
 * AI 反馈条（点赞 / 点踩 + 可选原因）。
 *
 * <p>只对持久化目标显示：targetId 必须是服务端返回的非空字符串（运行用 runId，产物用 versionId），
 * 本地临时 key（如时间线 seq）不得传入；无持久 ID 时整个组件不渲染。
 *
 * <p>交互：点选评级立即 PUT（幂等 upsert）；之后可补充原因再次 PUT 覆盖。
 * 失败文案走 ipdErrorText，role=alert 播报，不吞错。
 */
import { computed, ref, watch } from 'vue';
import { Button, Input } from 'ant-design-vue';

import {
  saveAiFeedback,
  type AiFeedbackRating,
  type AiFeedbackTargetType,
} from '../../../../api/ipd/project-agent';
import { ipdErrorText } from '../ipd-error-text';

/** 组件 props。 */
interface Props {
  targetType: AiFeedbackTargetType;
  /** 持久化目标 ID；null / 空串时组件不渲染。 */
  targetId?: null | string;
  /** 无障碍语境前缀，如「本次运行」「产物：竞品分析」。 */
  label?: string;
}

const props = withDefaults(defineProps<Props>(), { label: '该结果', targetId: null });

/** 原因最大长度（与常见后端 varchar(500) 对齐，超出前端截断输入）。 */
const REASON_MAX = 500;

const rating = ref<AiFeedbackRating | null>(null);
const reason = ref('');
const saving = ref(false);
const errorText = ref('');
const saved = ref(false);

/** 仅非空字符串视为持久 ID。 */
const persistentId = computed(() =>
  typeof props.targetId === 'string' && props.targetId.trim() !== '' ? props.targetId : null,
);

watch(
  () => [props.targetType, props.targetId],
  () => {
    rating.value = null;
    reason.value = '';
    errorText.value = '';
    saved.value = false;
  },
);

/**
 * 提交反馈（PUT 幂等）。
 *
 * @param next 评级
 * @param withReason 是否携带原因
 */
async function submit(next: AiFeedbackRating, withReason: boolean): Promise<void> {
  const id = persistentId.value;
  if (!id || saving.value) return;
  const targetType = props.targetType;
  saving.value = true;
  errorText.value = '';
  saved.value = false;
  try {
    const text = reason.value.trim();
    const view = await saveAiFeedback(
      targetType,
      id,
      withReason && text ? { rating: next, reason: text } : { rating: next },
    );
    if (persistentId.value !== id || props.targetType !== targetType) return;
    rating.value = view.rating;
    saved.value = true;
  } catch (error) {
    if (persistentId.value !== id) return;
    errorText.value = ipdErrorText(error, { fallback: '反馈提交失败，请稍后重试' });
  } finally {
    saving.value = false;
  }
}

/** 点选评级。 */
function onRate(next: AiFeedbackRating): void {
  void submit(next, false);
}

/** 补充原因后提交。 */
function onSubmitReason(): void {
  if (rating.value) void submit(rating.value, true);
}
</script>

<template>
  <div v-if="persistentId" class="ipd-ai-feedback" data-testid="ai-feedback-bar">
    <div class="feedback-actions" role="group" :aria-label="`${label}反馈`">
      <Button
        size="small"
        :type="rating === 'UP' ? 'primary' : 'default'"
        :aria-label="`${label}有帮助`"
        :aria-pressed="rating === 'UP'"
        :disabled="saving"
        data-testid="feedback-up"
        @click="onRate('UP')"
      >
        点赞
      </Button>
      <Button
        size="small"
        :type="rating === 'DOWN' ? 'primary' : 'default'"
        :danger="rating === 'DOWN'"
        :aria-label="`${label}没帮助`"
        :aria-pressed="rating === 'DOWN'"
        :disabled="saving"
        data-testid="feedback-down"
        @click="onRate('DOWN')"
      >
        点踩
      </Button>
      <span v-if="saved" class="feedback-saved" role="status">已记录反馈</span>
    </div>
    <div v-if="rating" class="feedback-reason">
      <Input.TextArea
        v-model:value="reason"
        :maxlength="REASON_MAX"
        :auto-size="{ minRows: 1, maxRows: 4 }"
        :aria-label="`${label}反馈原因（可选）`"
        placeholder="补充原因（可选）"
        data-testid="feedback-reason"
      />
      <Button
        size="small"
        :disabled="saving || reason.trim() === ''"
        data-testid="feedback-reason-submit"
        @click="onSubmitReason"
      >
        提交原因
      </Button>
    </div>
    <p v-if="errorText" class="feedback-error" role="alert">{{ errorText }}</p>
  </div>
</template>

<style scoped>
.ipd-ai-feedback {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--ipd-font, inherit);
}
.feedback-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.feedback-saved {
  font-size: 12px;
  color: var(--ipd-green);
}
.feedback-reason {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.feedback-error {
  margin: 0;
  font-size: 12px;
  color: var(--ipd-red);
}
</style>
