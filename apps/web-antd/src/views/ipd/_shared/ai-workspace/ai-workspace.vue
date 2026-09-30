<template>
  <div class="ipd-ai-workspace" data-testid="ipd-ai-workspace">
    <div class="ws-anchors" role="tablist" aria-label="工作区分区">
      <button
        v-for="tab in visibleTabs"
        :key="tab.key"
        :aria-selected="activeKey === tab.key"
        :class="['ws-tab', { 'is-active': activeKey === tab.key }]"
        :data-testid="`ipd-ai-ws-tab-${tab.key}`"
        role="tab"
        type="button"
        @click="jumpTo(tab.key)"
      >
        {{ titleOf(tab.key) }}
      </button>
    </div>
    <div ref="bodyRef" class="ws-body">
      <section
        v-for="tab in visibleTabs"
        :key="tab.key"
        v-show="activeKey === tab.key"
        :ref="(el) => setSectionRef(tab.key, el)"
        :class="['ws-section', { 'is-active': activeKey === tab.key }]"
        :data-testid="`ipd-ai-ws-pane-${tab.key}`"
        role="tabpanel"
      >
        <header class="ws-section-head">
          <h4>{{ titleOf(tab.key) }}</h4>
          <small>{{ hintOf(tab.key) }}</small>
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
 * <p>分区用页签切换：同一时间只显示当前 pane。内容用 v-show 隐藏而不是拆掉，
 * 切走再切回时运行回读和小阶段选中还在。当前 pane 不在本次挂载列表里时，
 * 显示列表中的第一项，不改已保存的偏好。
 */
import { computed, onBeforeUpdate, ref, watch } from 'vue';

import {
  useIpdAiWorkspace,
  type IpdAiWorkspace as WorkspaceState,
} from './use-ai-workspace';
import type { WorkspacePane } from './workspace-mode';

const props = defineProps<{
  /** 要挂载的分区；缺省四区都在。项目模式只留本次运行和步骤。 */
  panes?: WorkspacePane[];
  /** 分区标题覆盖；未给出的键仍用默认标题。 */
  titles?: Partial<Record<WorkspacePane, string>>;
  /** 分区说明覆盖。 */
  hints?: Partial<Record<WorkspacePane, string>>;
}>();

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

const visibleTabs = computed(() => {
  if (!props.panes) return tabs;
  const allowed = new Set<WorkspacePane>(props.panes);
  return tabs.filter((tab) => allowed.has(tab.key));
});

/** 当前要显示的分区。保存的 pane 不在本次列表中时，落到第一项。 */
const activeKey = computed(() => {
  const keys = visibleTabs.value.map((tab) => tab.key);
  return keys.includes(pane.value) ? pane.value : (keys[0] ?? 'cards');
});

/** 分区标题：调用方覆盖优先，否则用默认名。 */
function titleOf(key: WorkspacePane): string {
  return props.titles?.[key] ?? tabs.find((tab) => tab.key === key)?.label ?? key;
}

/** 分区说明：调用方覆盖优先，否则用默认说明。 */
function hintOf(key: WorkspacePane): string {
  return props.hints?.[key] ?? tabs.find((tab) => tab.key === key)?.hint ?? '';
}

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

/** 切换到指定分区。其它分区仍挂着，只是不显示。 */
function jumpTo(key: WorkspacePane) {
  setPane(key);
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
