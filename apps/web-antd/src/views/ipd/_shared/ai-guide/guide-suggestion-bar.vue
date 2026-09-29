<!--
  引导建议 chips 条（C4b）：点击=填入既有输入框，不发任何写请求（单轨红线 3/4）。
  chips 本体走 @copilotkit/vue 既有原语（CopilotChatSuggestionView + Pill，成熟能力
  替换详稿手写按钮，差异登记见交付说明）；testid 经 $attrs 覆盖 Pill 静态值。
-->
<script setup lang="ts">
import { computed } from 'vue';

import type { Suggestion } from '@copilotkit/vue/v2';

import {
  CopilotChatSuggestionPill,
  CopilotChatSuggestionView,
} from '@copilotkit/vue/v2';

const props = defineProps<{ suggestions: string[] }>();
const emit = defineEmits<{ (e: 'pick', text: string): void }>();

/** Suggestion wire 形态（message/isLoading 必填）：title=展示文案，message=pick 全文。 */
const items = computed<Suggestion[]>(() =>
  props.suggestions.map((text) => ({
    isLoading: false,
    message: text,
    title: text,
  })),
);

/** 单路径 emit（只走 Pill @click，不并用 slot onSelect，防双发）。 */
function pick(text: string) {
  emit('pick', text);
}
</script>

<template>
  <div
    v-if="suggestions.length"
    class="ipd-guide-chips"
    data-testid="ipd-guide-chips"
  >
    <CopilotChatSuggestionView :suggestions="items">
      <template #suggestion="{ suggestion, index, isLoading }">
        <CopilotChatSuggestionPill
          :data-testid="`ipd-guide-chip-${index}`"
          :is-loading="isLoading"
          @click="pick(suggestion.message)"
        >
          {{ suggestion.title }}
        </CopilotChatSuggestionPill>
      </template>
    </CopilotChatSuggestionView>
  </div>
</template>

<style scoped>
/* 色板仅用 _shared/ipd-theme.css 的 --ipd-* token（Global Constraints #21） */
.ipd-guide-chips {
  padding: 6px 0;
  border-top: 1px solid var(--ipd-line);
}
.ipd-guide-chips :deep(.cpk\:inline-flex) {
  color: var(--ipd-blue);
}
</style>
