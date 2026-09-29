<script setup lang="ts">
import { computed } from 'vue';

import type { SubStage } from '../../../../api/ipd/stage-sub-stages';

const props = defineProps<{
  activeCode: null | string;
  stageCode?: string;
  stages: SubStage[];
}>();
const emit = defineEmits<{ select: [code: string] }>();

const groups = computed(() => {
  const byStage = new Map<string, SubStage[]>();
  for (const stage of props.stages) {
    if (props.stageCode && stage.stageCode !== props.stageCode) continue;
    const items = byStage.get(stage.stageCode) ?? [];
    items.push(stage);
    byStage.set(stage.stageCode, items);
  }
  return [...byStage.entries()].map(([code, items]) => ({ code, items }));
});
</script>

<template>
  <div class="stage-nav" data-testid="ipd-ai-step-nav">
    <div v-if="groups.length === 0" class="stage-empty">该浏览阶段暂无可显示的小阶段。</div>
    <section v-for="group in groups" :key="group.code" class="stage-group">
      <h3>{{ group.code }}</h3>
      <button
        v-for="stage in group.items"
        :key="stage.code"
        :aria-pressed="activeCode === stage.code"
        :data-testid="`ipd-ai-step-${stage.code}`"
        class="stage-item"
        type="button"
        @click="emit('select', stage.code)"
      >
        <strong>{{ stage.name }}</strong>
        <span v-if="stage.gateCode">{{ stage.gateCode }} 门禁</span>
        <small>{{ stage.actions.map((action) => action.actionName).join('、') }}</small>
      </button>
    </section>
  </div>
</template>

<style scoped>
.stage-nav { display: grid; gap: 12px; }
.stage-empty { padding: 10px; border: 1px dashed var(--ipd-line); border-radius: 8px; color: var(--ipd-muted); font-size: 12px; }
.stage-group { display: grid; gap: 6px; }
.stage-group h3 { color: var(--ipd-text); font-size: 13px; }
.stage-item { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--ipd-line); border-radius: 8px; background: var(--ipd-bg); color: var(--ipd-text); text-align: left; cursor: pointer; }
.stage-item[aria-pressed='true'] { border-color: var(--ipd-blue); }
.stage-item small { color: var(--ipd-muted); }
</style>
