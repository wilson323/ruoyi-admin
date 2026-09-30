<script setup lang="ts">
/** 小阶段目录画布：只展示服务端目录与当前浏览选择，不推断项目执行进度。 */
import { computed } from 'vue';

import type { SubStage } from '../../../../api/ipd/stage-sub-stages';

const props = defineProps<{
  activeCode: null | string;
  stages: SubStage[];
}>();
const emit = defineEmits<{ select: [code: string] }>();

const lanes = computed(() => {
  const byStage = new Map<string, SubStage[]>();
  for (const item of props.stages) {
    const entries = byStage.get(item.stageCode) ?? [];
    entries.push(item);
    byStage.set(item.stageCode, entries);
  }
  return [...byStage.entries()].map(([code, entries]) => ({
    code,
    items: [...entries].sort((a, b) => a.sortOrder - b.sortOrder),
    resident: entries.every((item) => item.code === 'KPI-S1'),
  }));
});
</script>

<template>
  <div class="stage-canvas" data-testid="ipd-ai-stage-canvas">
    <p class="canvas-caption">小阶段目录画布 · 选中节点仅改变浏览位置，不表示已执行或已完成</p>
    <div v-if="!lanes.length" class="canvas-empty">小阶段目录暂不可用。</div>
    <section v-for="(lane, laneIndex) in lanes" :key="lane.code" class="canvas-lane">
      <div class="lane-heading">
        <span class="lane-number">{{ String(laneIndex + 1).padStart(2, '0') }}</span>
        <div>
          <h5>{{ lane.code }}</h5>
          <small>{{ lane.resident ? '常驻指标 · 不参与阶段推进' : `${lane.items.length} 个小阶段` }}</small>
        </div>
      </div>
      <ol :class="['lane-flow', { 'is-resident': lane.resident }]">
        <li v-for="item in lane.items" :key="item.code" class="flow-item">
          <button
            :aria-pressed="activeCode === item.code"
            :data-testid="`ipd-ai-canvas-node-${item.code}`"
            class="flow-node"
            type="button"
            @click="emit('select', item.code)"
          >
            <span class="node-code">{{ item.code }}</span>
            <strong>{{ item.name }}</strong>
            <small>{{ item.gateCode ? `${item.gateCode} 门禁` : `${item.actions.length} 个标准动作` }}</small>
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.stage-canvas { display: grid; gap: 12px; }
.canvas-caption { margin: 0; color: var(--ipd-muted); font-size: 11px; line-height: 1.6; }
.canvas-empty { padding: 12px; border: 1px dashed var(--ipd-line); border-radius: 8px; color: var(--ipd-muted); font-size: 12px; }
.canvas-lane { display: grid; grid-template-columns: minmax(100px, 120px) minmax(0, 1fr); gap: 12px; align-items: start; }
.lane-heading { display: flex; align-items: flex-start; gap: 7px; padding-top: 5px; }
.lane-number { display: grid; flex: 0 0 26px; place-items: center; height: 26px; border-radius: 8px; background: var(--ipd-blue-soft); color: var(--ipd-blue); font-size: 11px; font-weight: 700; }
.lane-heading h5 { margin: 0; color: var(--ipd-text); font-size: 12px; }
.lane-heading small { color: var(--ipd-muted); font-size: 10px; line-height: 1.4; }
.lane-flow { display: flex; gap: 16px; min-width: 0; margin: 0; padding: 3px 2px 8px; overflow-x: auto; list-style: none; scroll-snap-type: x proximity; }
.flow-item { position: relative; flex: 0 0 148px; scroll-snap-align: start; }
.flow-item:not(:last-child)::after { position: absolute; top: 43px; right: -13px; width: 10px; height: 2px; background: var(--ipd-line); content: ''; }
.flow-node { display: grid; gap: 4px; width: 100%; min-height: 86px; padding: 10px; border: 1px solid var(--ipd-line); border-radius: 10px; background: var(--ipd-surface); color: var(--ipd-text); text-align: left; cursor: pointer; }
.flow-node:hover { border-color: var(--ipd-blue); background: var(--ipd-blue-soft); }
.flow-node[aria-pressed='true'] { border-color: var(--ipd-blue); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ipd-blue) 16%, transparent); }
.flow-node:focus-visible { outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color); outline-offset: var(--ipd-focus-ring-offset); }
.node-code { color: var(--ipd-blue); font-size: 10px; font-weight: 700; letter-spacing: 0.04em; }
.flow-node strong { font-size: 12px; line-height: 1.4; }
.flow-node small { color: var(--ipd-muted); font-size: 10px; }
.is-resident .flow-node { border-style: dashed; }
@media (max-width: 768px) { .canvas-lane { grid-template-columns: minmax(0, 1fr); gap: 5px; } }
</style>
