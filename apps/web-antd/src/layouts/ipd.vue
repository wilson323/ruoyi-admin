<script lang="ts" setup>
/**
 * IPD 工作台容器（2026-09-11 owner 指令：菜单与 UI 统一到 AI 管理平台框架）。
 *
 * 历史：本文件曾为 IPD 自绘 Shell（topbar / sidebar / 双悬浮入口 / 三弹窗，
 * ZK-IPD 原型 1:1 复刻）。统一后顶栏、侧栏、菜单由 vben BasicLayout 承担
 * （后端菜单「AI 平台 + IPD 工作台」合并为同一份侧栏菜单），本组件只保留
 * IPD 专属的阶段轨道：仅当路由带 projectId（单个项目页）时显示项目切换、
 * 六阶段和传统/AI 模式。产品线、目录、工作台等空间页不挂这条轨道。
 * 页面在其下方 router-view 渲染。
 *
 * 路由：/ipd 路由树并入 Root.children（router/routes/index.ts），与平台动态路由
 * 共用同一 BasicLayout 实例；本组件由 ipdLayoutRoute.component 挂载。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { PhCalendarBlank as CalendarBlank } from '@phosphor-icons/vue';

import { listProjects, type Project } from '../api/ipd/project';
import AiAssistant from '../views/ipd/_shared/ai-assistant.vue';
import { useIpdAiWorkspace } from '../views/ipd/_shared/ai-workspace/use-ai-workspace';
import type { WorkspaceMode } from '../views/ipd/_shared/ai-workspace/workspace-mode';
import '../views/ipd/_shared/ipd-theme.css';
import '../views/ipd/_shared/ipd-a11y.css';

/** 原型六阶段常量（code 对齐后端 Project.currentStage 枚举）。 */
const stages = [
  { code: 'CONCEPT', name: '概念' },
  { code: 'PLAN', name: '计划' },
  { code: 'DEV', name: '开发' },
  { code: 'VALID', name: '验证' },
  { code: 'LAUNCH', name: '发布' },
  { code: 'LIFECYCLE', name: '生命周期' },
];

const today = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date());

/** 当前打开的项目（路由 projectId）。空间页没有这个参数，不显示项目轨道。 */
const route = useRoute();
const router = useRouter();
const projects = ref<Project[]>([]);
const CURRENT_PROJECT_KEY = 'ipd:current-project';
/** 子页表单改项目时派发，项目页只改路由，不整页 reload。 */
const PROJECT_SYNC_EVENT = 'ipd:current-project-changed';
const { mode: aiMode } = useIpdAiWorkspace();

/**
 * 路由里的项目 id。项目列表、新建、产品线、目录、工作台都没有这个参数。
 */
const routeProjectId = computed(() => {
  const id = route.params.projectId;
  return typeof id === 'string' ? id : '';
});

/** 只有单个项目页才挂阶段轨道。 */
const projectScoped = computed(() => routeProjectId.value.length > 0);

/** 顶栏只发出模式意图；AI 宿主统一负责停止旧流及清理卡片。 */
function selectAiMode(mode: WorkspaceMode) {
  window.dispatchEvent(new CustomEvent('ipd:ai-mode-select', { detail: { mode } }));
}

/**
 * 把打开中的项目写入副驾读取的键。不刷新页面，项目页以路由为准。
 */
function rememberProject(id: string) {
  if (!id) return;
  window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  window.dispatchEvent(new CustomEvent('ipd:active-project-updated', { detail: { projectId: id } }));
}

/**
 * 子页同步事件：更新顶栏选中项，不触发 reload（避免打断表单）。
 */
function onProjectSync(event: Event) {
  const detail = (event as CustomEvent<{ projectId?: string }>).detail;
  const id = typeof detail?.projectId === 'string' ? detail.projectId : '';
  if (!id) return;
  if (projectScoped.value) {
    switchProject(id);
    return;
  }
  rememberProject(id);
}

/**
 * 项目页才拉项目列表，供轨道下拉使用。空间页不请求、也不默认选中第一个项目。
 */
async function loadProjects() {
  try {
    projects.value = await listProjects();
  } catch {
    projects.value = [];
  }
}

onMounted(() => {
  window.addEventListener(PROJECT_SYNC_EVENT, onProjectSync);
});

watch(routeProjectId, (id) => {
  if (!id) return;
  rememberProject(id);
  if (projects.value.length === 0) void loadProjects();
}, { immediate: true });

onUnmounted(() => {
  window.removeEventListener(PROJECT_SYNC_EVENT, onProjectSync);
});

const currentProject = computed(
  () => projects.value.find((p) => p.id === routeProjectId.value),
);

/** 项目选项文案：原型为「名称 · 负责人」；后端暂无负责人字段，回退项目编号。 */
function projectLabel(p: Project): string {
  return p.code ? `${p.name} · ${p.code}` : p.name;
}

/**
 * 切换项目：替换路由中的 projectId，同一子页打开另一个项目。不整页刷新。
 */
function switchProject(id: string) {
  const current = routeProjectId.value;
  if (!current || !id || id === current) return;
  const marker = `/projects/${current}`;
  const at = route.path.indexOf(marker);
  if (at < 0) return;
  const next = `${route.path.slice(0, at)}/projects/${id}${route.path.slice(at + marker.length)}`;
  void router.push({ path: next, query: route.query });
}
</script>

<template>
  <div class="ipd-stage-shell">
    <div v-if="projectScoped" class="stage-rail" data-testid="ipd-stage-rail">
      <label class="rail-project">
        <span>项目</span>
        <select
          id="ipd-global-project-select"
          name="ipd_global_project_id"
          :value="routeProjectId"
          data-testid="ipd-project-select"
          @change="switchProject(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ projectLabel(p) }}
          </option>
        </select>
      </label>
      <div class="rail-stages">
        <div
          v-for="(stage, index) in stages"
          :key="stage.code"
          :class="{ active: currentProject?.currentStage === stage.code }"
          class="stage-node"
        >
          <span>{{ index + 1 }}</span>
          <strong>{{ stage.name }}</strong>
          <i v-if="index < stages.length - 1" />
        </div>
      </div>
      <div class="rail-ai-mode" role="group" aria-label="工作方式">
        <button
          :aria-pressed="aiMode === 'classic'"
          :class="{ active: aiMode === 'classic' }"
          data-testid="ipd-mode-classic"
          type="button"
          @click="selectAiMode('classic')"
        >传统模式</button>
        <button
          :aria-pressed="aiMode === 'ai'"
          :class="{ active: aiMode === 'ai' }"
          data-testid="ipd-mode-ai"
          type="button"
          @click="selectAiMode('ai')"
        >AI 模式</button>
      </div>
      <div class="today">
        <CalendarBlank :size="16" />
        今天 {{ today }}
        <small>时区：Asia/Shanghai</small>
      </div>
    </div>
    <div class="ipd-stage-content">
      <router-view />
    </div>
    <!-- R215 AI 融合批次3：全局 AI 副驾入口（后端三档上下文 + RAG，见 ai-copilot.ts 契约注释） -->
    <AiAssistant :project-current-stage="currentProject?.currentStage" :stages="stages" />
  </div>
</template>

<style>
/* ==== IPD 阶段轨道（自旧自绘壳 stage-rail 迁移；顶栏/侧栏由 vben BasicLayout 承担）====
 * 色板沿用 ipd-theme.css 的 --ipd-* token（html.dark 下自动翻转）；
 * ZK-IPD 原型一致性口径：六阶段节点与连接线视觉沿用原型 styles.css 取值。 */
.ipd-stage-shell {
  min-height: 100%;
  color: var(--ipd-text);
}
.ipd-stage-shell .stage-rail {
  display: flex;
  align-items: stretch;
  min-height: 68px;
  padding: 0 16px;
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}
.ipd-stage-shell .rail-project {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding-right: 14px;
  border-right: 1px solid var(--ipd-line);
  color: var(--ipd-muted);
  font-size: 13px;
  white-space: nowrap;
}
.ipd-stage-shell .rail-project select {
  max-width: 200px;
  color: var(--ipd-text);
  background: transparent;
  border: 0;
  outline: none;
  appearance: none;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.ipd-stage-shell .rail-ai-mode {
  display: flex;
  align-self: center;
  flex-shrink: 0;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ipd-line);
  border-radius: 10px;
  background: var(--ipd-bg);
}
.ipd-stage-shell .rail-ai-mode button {
  padding: 7px 11px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ipd-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.ipd-stage-shell .rail-ai-mode button.active {
  background: var(--ipd-surface);
  color: var(--ipd-blue);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ipd-navy) 10%, transparent);
}
html.dark .ipd-stage-shell .rail-ai-mode button.active {
  color: var(--ipd-blue-dark);
}
.ipd-stage-shell .rail-ai-mode button:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
/* V12-F1：outline:none 的替代——键盘聚焦时显式 token 焦点环（同特异性压过上方 none） */
.ipd-stage-shell .rail-project select:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ipd-stage-shell .rail-stages {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.ipd-stage-shell .stage-node {
  min-width: 145px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ipd-muted);
  position: relative;
  padding: 0 13px;
}
.ipd-stage-shell .stage-node > span {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--ipd-line);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  z-index: 1;
}
.ipd-stage-shell .stage-node strong {
  font-size: 13px;
  white-space: nowrap;
  z-index: 1;
}
.ipd-stage-shell .stage-node i {
  position: absolute;
  height: 2px;
  width: 44px;
  background: var(--ipd-line);
  right: -22px;
  top: 50%;
  margin-top: -1px;
}
.ipd-stage-shell .stage-node.active {
  color: var(--ipd-blue);
  border-bottom: 3px solid var(--ipd-blue);
}
.ipd-stage-shell .stage-node.active > span {
  background: var(--ipd-blue);
  color: hsl(var(--primary-foreground));
}
html.dark .ipd-stage-shell .stage-node.active > span {
  color: var(--ipd-navy);
}
.ipd-stage-shell .stage-node.active i {
  background: var(--ipd-blue);
}
.ipd-stage-shell .today {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ipd-muted);
  padding: 0 8px 0 16px;
  font-size: 12px;
  white-space: nowrap;
}
.ipd-stage-shell .today small {
  display: block;
  margin-left: 4px;
  color: var(--ipd-muted);
}

/* ==== 暗色模式补全（迁移自旧自绘壳 html.dark 段）==== */
html.dark .ipd-stage-shell .stage-node {
  color: var(--ipd-muted);
}
html.dark .ipd-stage-shell .stage-node > span {
  background: var(--ipd-line);
}
html.dark .ipd-stage-shell .stage-node i {
  background: var(--ipd-line);
}
html.dark .ipd-stage-shell .today {
  color: var(--ipd-muted);
}
html.dark .ipd-stage-shell .today small {
  color: var(--ipd-muted);
}
@media (max-width: 1024px) {
  .ipd-stage-shell .today {
    display: none;
  }
}
</style>
