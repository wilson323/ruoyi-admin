<template>
  <div class="ipd-ai-workspace" data-testid="ipd-ai-workspace">
    <div class="ws-anchors" role="tablist" aria-label="工作区分区锚点（全部常驻渲染，点击仅定位）">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :aria-selected="pane === tab.key"
        :class="['ws-tab', { 'is-active': pane === tab.key }]"
        :data-testid="`ipd-ai-ws-tab-${tab.key}`"
        role="tab"
        type="button"
        @click="jumpTo(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div ref="bodyRef" class="ws-body">
      <section
        v-for="tab in tabs"
        :key="tab.key"
        :ref="(el) => setSectionRef(tab.key, el)"
        :class="['ws-section', { 'is-active': pane === tab.key }]"
        :data-testid="`ipd-ai-ws-pane-${tab.key}`"
      >
        <header class="ws-section-head">
          <h4>{{ tab.label }}</h4>
          <small>{{ tab.hint }}</small>
        </header>
        <div class="ws-pane">
          <slot :name="tab.key">
            <div class="ws-empty">{{ tab.empty }}</div>
          </slot>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 工作区（Artifact 面板）· 四区自动渲染版。
 *
 * <p>形态裁决（2026-09-29，参考 21st.dev 书签 AI Prompt Input / Assistant Tabs /
 * Thinking 等交互范式后按本仓规约移植）：「建议卡 / 步骤 / 画布 / 文档」四区
 * **全部常驻挂载、堆叠呈现**，AI 产出即渲染，无需切页签；顶部条只做锚点定位
 * （jumpTo 滚动 + 记录 pane 偏好），互斥 v-if 切换已移除——切页丢状态的问题
 * 从结构上消除。
 *
 * <p>自动定位：useIpdAiWorkspace().focusPane（如建议卡出卡时）递增 focusTick，
 * 本组件监听后把对应区滚动进视口。空态文案由 slot 供内容方接管，默认槽给兜底。
 */
import { onBeforeUpdate, ref, watch } from 'vue';

import {
  useIpdAiWorkspace,
  type IpdAiWorkspace as WorkspaceState,
} from './use-ai-workspace';
import type { WorkspacePane } from './workspace-mode';

const { focusTick, pane, setPane }: WorkspaceState = useIpdAiWorkspace();

const tabs = [
  {
    key: 'cards',
    label: '建议卡',
    hint: '结构化建议卡随对话自动展开',
    empty: '对话中产出的结构化建议卡（预审 / 结论 / 章程 / 需求草案）会在此自动渲染。',
  },
  {
    key: 'steps',
    label: '步骤',
    hint: '小阶段步骤导航',
    empty: '小阶段步骤导航由 B2 落位（消费 Track A 的 22 小阶段接口）。',
  },
  {
    key: 'canvas',
    label: '画布',
    hint: '流程画布',
    empty: '流程画布由 B3 落位（Vue Flow）。',
  },
  {
    key: 'doc',
    label: '文档',
    hint: '文档编辑与导出',
    empty: '文档编辑与 word/html 导出由 B4 落位（TinyMCE）。',
  },
] as const satisfies ReadonlyArray<{
  empty: string;
  hint: string;
  key: WorkspacePane;
  label: string;
}>;

const bodyRef = ref<HTMLElement>();
const sectionRefs = new Map<WorkspacePane, unknown>();

function setSectionRef(key: WorkspacePane, el: unknown) {
  if (el) {
    sectionRefs.set(key, el);
  } else {
    sectionRefs.delete(key);
  }
}

onBeforeUpdate(() => sectionRefs.clear());

/** 锚点定位：四区常驻，点击只滚动到对应区并记录偏好（不隐藏其它区）。 */
function jumpTo(key: WorkspacePane) {
  setPane(key);
  scrollToSection(key);
}

function scrollToSection(key: WorkspacePane) {
  const target = sectionRefs.get(key) as HTMLElement | undefined;
  target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

// 自动渲染定位：focusPane 递增 focusTick 后滚动到最新产出所在区。
watch(focusTick, () => scrollToSection(pane.value));
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
.ws-anchors {
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
:global(html.dark) .ws-tab.is-active {
  color: var(--ipd-blue-dark);
}
.ws-tab:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ws-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
}
.ws-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
}
.ws-section.is-active {
  border-color: var(--ipd-blue);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ipd-blue) 12%, transparent);
}
:global(html.dark) .ws-section.is-active {
  border-color: var(--ipd-blue-dark);
}
.ws-section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ws-section-head h4 {
  margin: 0;
  color: var(--ipd-text);
  font-size: 13px;
  font-weight: 650;
}
.ws-section-head small {
  color: var(--ipd-muted);
  font-size: 11px;
}
.ws-pane {
  min-height: 0;
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
