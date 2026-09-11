<script lang="ts" setup>
/**
 * IPD 工作台容器（2026-09-11 owner 指令：菜单与 UI 统一到 AI 管理平台框架）。
 *
 * 历史：本文件曾为 IPD 自绘 Shell（topbar / sidebar / 双悬浮入口 / 三弹窗，
 * ZK-IPD 原型 1:1 复刻）。统一后顶栏、侧栏、菜单由 vben BasicLayout 承担
 * （后端菜单「AI 平台 + IPD 工作台」合并为同一份侧栏菜单），本组件只保留
 * IPD 专属的阶段轨道：全局项目切换 + 六阶段进度 + 今日日期，
 * 页面在其下方 router-view 渲染。
 *
 * 路由：/ipd 路由树并入 Root.children（router/routes/index.ts），与平台动态路由
 * 共用同一 BasicLayout 实例；本组件由 ipdLayoutRoute.component 挂载。
 */
import { computed, onMounted, ref } from 'vue';

import { PhCalendarBlank as CalendarBlank } from '@phosphor-icons/vue';

import { listProjects, type Project } from '../api/ipd/project';
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

/** 全局当前项目（迁移自旧自绘壳顶栏下拉）：listProjects() 拉全量；切换等价原型 refresh(projectId)。 */
const projects = ref<Project[]>([]);
const currentProjectId = ref('');
const CURRENT_PROJECT_KEY = 'ipd:current-project';

onMounted(async () => {
  try {
    projects.value = await listProjects();
    const saved = window.localStorage.getItem(CURRENT_PROJECT_KEY);
    currentProjectId.value =
      projects.value.some((p) => p.id === saved) && saved
        ? saved
        : (projects.value[0]?.id ?? '');
  } catch {
    projects.value = [];
  }
});

const currentProject = computed(
  () => projects.value.find((p) => p.id === currentProjectId.value) ?? projects.value[0],
);

/** 项目选项文案：原型为「名称 · 负责人」；后端暂无负责人字段，回退项目编号。 */
function projectLabel(p: Project): string {
  return p.code ? `${p.name} · ${p.code}` : p.name;
}

/** 切换全局当前项目：持久化后整页刷新，复刻原型 bootstrap 重载语义。 */
function switchProject(id: string) {
  if (id === currentProjectId.value) return;
  window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  window.location.reload();
}
</script>

<template>
  <div class="ipd-stage-shell">
    <div class="stage-rail" data-testid="ipd-stage-rail">
      <label class="rail-project">
        <span>项目</span>
        <select
          :value="currentProjectId"
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
      <div class="today">
        <CalendarBlank :size="16" />
        今天 {{ today }}
        <small>时区：Asia/Shanghai</small>
      </div>
    </div>
    <div class="ipd-stage-content">
      <router-view />
    </div>
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
  color: #616b7e;
  position: relative;
  padding: 0 13px;
}
.ipd-stage-shell .stage-node > span {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #e5e8ed;
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
  background: #dfe3ea;
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
  color: white;
}
.ipd-stage-shell .stage-node.active i {
  background: var(--ipd-blue);
}
.ipd-stage-shell .today {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4e586d;
  padding: 0 8px 0 16px;
  font-size: 12px;
  white-space: nowrap;
}
.ipd-stage-shell .today small {
  display: block;
  margin-left: 4px;
  color: #8b94a4;
}

/* ==== 暗色模式补全（迁移自旧自绘壳 html.dark 段）==== */
html.dark .ipd-stage-shell .stage-node {
  color: var(--ipd-muted);
}
html.dark .ipd-stage-shell .stage-node > span {
  background: #223049;
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
</style>
