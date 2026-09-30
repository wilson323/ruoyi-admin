<script setup lang="ts">
import { computed } from 'vue';

import type { SubStage } from '../../../../api/ipd/stage-sub-stages';

const props = defineProps<{
  activeCode: null | string;
  /** 项目智能体里，选中步骤是为了把动作带到对话，不是只换视图。 */
  bindsSession?: boolean;
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
  // 组内按目录 sortOrder 升序：接口返回顺序不保证有序，编号时间线必须以目录顺序绘制
  return [...byStage.entries()].map(([code, items]) => ({
    code,
    items: [...items].sort((a, b) => a.sortOrder - b.sortOrder),
  }));
});
</script>

<template>
  <div class="stage-nav" data-testid="ipd-ai-step-nav">
    <p class="stage-hint">
      {{ bindsSession
        ? '选中步骤后，到对话里点对应动作再发送，运行才会绑定该动作。'
        : '选中仅切换视图，不表示已执行或已完成。' }}
    </p>
    <div v-if="groups.length === 0" class="stage-empty">该浏览阶段暂无可显示的小阶段。</div>
    <section v-for="group in groups" :key="group.code" class="stage-group">
      <h3>{{ group.code }}</h3>
      <button
        v-for="(stage, index) in group.items"
        :key="stage.code"
        :aria-pressed="activeCode === stage.code"
        :data-testid="`ipd-ai-step-${stage.code}`"
        class="stage-item"
        type="button"
        @click="emit('select', stage.code)"
      >
        <span class="timeline-marker">{{ String(index + 1).padStart(2, '0') }}</span>
        <strong>{{ stage.name }}</strong>
        <span v-if="stage.gateCode">{{ stage.gateCode }} 门禁</span>
        <small>{{ stage.actions.map((action) => action.actionName).join('、') }}</small>
      </button>
    </section>
  </div>
</template>

<style scoped>
.stage-nav { display: grid; gap: 12px; }
.stage-hint { margin: 0; color: var(--ipd-muted); font-size: 12px; }
.timeline-marker { color: var(--ipd-muted); font-size: 11px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
.stage-empty { padding: 10px; border: 1px dashed var(--ipd-line); border-radius: 8px; color: var(--ipd-muted); font-size: 12px; }
.stage-group { display: grid; gap: 6px; }
.stage-group h3 { color: var(--ipd-text); font-size: 13px; }
.stage-item { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--ipd-line); border-radius: 8px; background: var(--ipd-bg); color: var(--ipd-text); text-align: left; cursor: pointer; }
.stage-item[aria-pressed='true'] { border-color: var(--ipd-blue); }
.stage-item small { color: var(--ipd-muted); }
</style>
