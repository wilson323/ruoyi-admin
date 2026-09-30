<script lang="ts" setup>
/**
 * 加载态。对齐收藏组件 theshanelevine / loading-state 的 Drive 变体：
 * 3×3 方格、人字波前、闪烁文案、实时耗时。减少动效时格子停在暗态，计时继续。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';

interface Props {
  label: string;
}

const props = defineProps<Props>();

/** 与原组件 chevron 相同：(列 + |行-1|) × 90ms。 */
const delays = [90, 180, 270, 0, 90, 180, 90, 180, 270];

const deciseconds = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

const elapsedLabel = computed(() => {
  const total = deciseconds.value / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
});

onMounted(() => {
  timer = setInterval(() => {
    deciseconds.value += 1;
  }, 100);
});

onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
});
</script>

<template>
  <div class="ipd-loading-state" role="status">
    <span class="pixel-grid" aria-hidden="true">
      <i
        v-for="(delay, index) in delays"
        :key="index"
        :style="{ animationDelay: `${delay}ms` }"
      />
    </span>
    <span class="loading-label">{{ props.label }}</span>
    <span class="loading-elapsed">{{ elapsedLabel }}</span>
  </div>
</template>

<style scoped>
.ipd-loading-state {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  width: fit-content;
}
.pixel-grid {
  display: grid;
  flex: none;
  grid-template-columns: repeat(3, 4px);
  gap: 1.5px;
}
.pixel-grid i {
  width: 4px;
  height: 4px;
  background: var(--ipd-text);
  border-radius: 1px;
  opacity: 0.15;
}
.loading-label {
  font-size: 13px;
  font-weight: 500;
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--ipd-muted) 35%,
    var(--ipd-text) 50%,
    var(--ipd-muted) 65%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
}
.loading-elapsed {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ipd-muted);
}
@media (prefers-reduced-motion: no-preference) {
  .pixel-grid i {
    animation: pixel-on 650ms ease-in-out infinite;
  }
  .loading-label {
    animation: shimmer-text 1.4s linear infinite;
  }
}
@keyframes pixel-on {
  0%,
  100% { opacity: 0.15; }
  45% { opacity: 1; }
}
@keyframes shimmer-text {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
</style>
