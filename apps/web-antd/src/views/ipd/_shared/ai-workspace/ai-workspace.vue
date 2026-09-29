<template>
  <div class="ipd-ai-workspace" data-testid="ipd-ai-workspace">
    <div class="ws-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :aria-selected="pane === tab.key"
        :class="['ws-tab', { 'is-active': pane === tab.key }]"
        :data-testid="`ipd-ai-ws-tab-${tab.key}`"
        role="tab"
        type="button"
        @click="setPane(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="ws-body">
      <div v-if="pane === 'cards'" class="ws-pane" data-testid="ipd-ai-ws-pane-cards">
        <slot name="cards">
          <div class="ws-empty">
            对话中产出的结构化建议卡（预审 / 结论 / 章程 / 需求草案）会在此展开。
          </div>
        </slot>
      </div>
      <div v-else-if="pane === 'steps'" class="ws-pane" data-testid="ipd-ai-ws-pane-steps">
        <slot name="steps">
          <div class="ws-empty">小阶段步骤导航由 B2 落位（消费 Track A 的 22 小阶段接口）。</div>
        </slot>
      </div>
      <div v-else-if="pane === 'canvas'" class="ws-pane" data-testid="ipd-ai-ws-pane-canvas">
        <slot name="canvas">
          <div class="ws-empty">流程画布由 B3 落位（Vue Flow）。</div>
        </slot>
      </div>
      <div v-else class="ws-pane" data-testid="ipd-ai-ws-pane-doc">
        <slot name="doc">
          <div class="ws-empty">文档编辑与 word/html 导出由 B4 落位（TinyMCE）。</div>
        </slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useIpdAiWorkspace } from './use-ai-workspace';

const { pane, setPane } = useIpdAiWorkspace();

const tabs = [
  { key: 'cards', label: '建议卡' },
  { key: 'steps', label: '步骤' },
  { key: 'canvas', label: '画布' },
  { key: 'doc', label: '文档' },
] as const;
</script>

<style scoped>
/* 色板：只用全局 --ipd-* token（Global Constraint #21），禁 hex */
.ipd-ai-workspace {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.ws-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--ipd-line);
}
.ws-tab {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--ipd-muted);
  font-size: 13px;
  cursor: pointer;
}
.ws-tab.is-active {
  color: var(--ipd-blue);
  box-shadow: inset 0 -2px 0 var(--ipd-blue);
}
.ws-tab:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ws-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.ws-pane {
  height: 100%;
}
.ws-empty {
  padding: 12px;
  border: 1px dashed var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-bg);
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.8;
}
</style>
