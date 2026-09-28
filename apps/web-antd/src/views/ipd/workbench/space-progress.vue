<script setup lang="ts">
/**
 * 工作台·产品空间（=工作空间）「{第一个项目名} · 阶段进度」卡。
 *
 * 数据链（全部真实接口，禁固定示例/模拟/写死数组）：
 *   fetchProductWorkspace(spaceId) → projects[0]（后端返回序第一个，不排序臆断）
 *   → 并行 getProject(firstProjectId) + listStageActions(firstProjectId)。
 *
 * 四态（每态真实分支，不假绿）：
 *   loading —— 链路加载中；
 *   no-project —— 该产品空间暂无项目（projects 为空）→「待补充」态，不渲染假 rail；
 *   error —— fetchProductWorkspace / getProject / listStageActions 任一 reject
 *            →「阶段进度加载失败」+ 重试按钮（点击重跑该空间加载）；
 *   ready —— 六阶段 rail（STAGE_ORDER，currentStage 真值高亮）+ 动作级进度聚合。
 *
 * 阶段高亮真值：getProject 的 currentStage，缺失时回退 workspace 项目的 currentStage。
 * 已知约束（flow.vue 头注）：无 stageId→阶段编码映射端点，动作只做级聚合，不按 stageId 分组。
 */
import { computed, ref, watch } from 'vue';

import type { ProductWorkspace, WorkspaceProject } from '../../../api/ipd/product-workspace';
import { fetchProductWorkspace } from '../../../api/ipd/product-workspace';
import type { Project } from '../../../api/ipd/project';
import { getProject } from '../../../api/ipd/project';
import type { StageAction } from '../../../api/ipd/stage-action';
import { listStageActions } from '../../../api/ipd/stage-action';
import { STAGE_ORDER, stageText } from '../project/project-display';
import type { SpaceScope } from './space-context';
import { summarizeStageActions } from './space-context';

interface Props {
  spaceId: string;
  spaceName: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'open-flow': [projectId: string];
  'scope-change': [scope: SpaceScope];
}>();

type ProgressState = 'error' | 'loading' | 'no-project' | 'ready';

const state = ref<ProgressState>('loading');
/** workspace.projects[0]（后端返回序）。 */
const project = ref<WorkspaceProject | null>(null);
/** getProject 真值（currentStage 权威来源）。 */
const detail = ref<Project | null>(null);
/** listStageActions 真值（动作级进度聚合来源）。 */
const actions = ref<StageAction[]>([]);
/** 并发守卫：空间快速切换时丢弃过期响应。 */
let loadToken = 0;

async function load(): Promise<void> {
  const token = ++loadToken;
  state.value = 'loading';
  project.value = null;
  detail.value = null;
  actions.value = [];
  emit('scope-change', { status: 'loading' });

  let workspace: ProductWorkspace;
  try {
    workspace = await fetchProductWorkspace(props.spaceId);
  } catch {
    if (token !== loadToken) return;
    state.value = 'error';
    emit('scope-change', { status: 'error' });
    return;
  }
  if (token !== loadToken) return;

  const projects = workspace.projects ?? [];
  emit('scope-change', { projects, status: 'ready' });
  const first = projects[0];
  if (!first || !first.id) {
    // 该产品空间暂无项目 → 待补充态（禁止渲染假 rail 数据）
    state.value = 'no-project';
    return;
  }
  project.value = first;

  try {
    const [detailRow, actionRows] = await Promise.all([
      getProject(first.id),
      listStageActions(first.id),
    ]);
    if (token !== loadToken) return;
    detail.value = detailRow;
    actions.value = actionRows;
    state.value = 'ready';
  } catch {
    if (token !== loadToken) return;
    state.value = 'error';
  }
}

watch(
  () => props.spaceId,
  () => {
    void load();
  },
  { immediate: true },
);

/** 阶段高亮真值：getProject.currentStage → workspace 项目 currentStage。 */
const currentStageCode = computed(
  () => detail.value?.currentStage ?? project.value?.currentStage ?? null,
);

/** 六阶段 rail 骨架（STAGE_ORDER），当前阶段由真实 currentStage 高亮。 */
const railItems = computed(() => {
  const activeIndex = STAGE_ORDER.findIndex((s) => s.code === currentStageCode.value);
  return STAGE_ORDER.map((stage, index) => ({
    code: stage.code,
    label: stage.label,
    tone:
      activeIndex < 0 ? '' : index < activeIndex ? 'is-done' : index === activeIndex ? 'is-active' : '',
  }));
});

const projectName = computed(
  () => detail.value?.name || project.value?.name || '',
);

/** 动作级进度聚合（listStageActions 真值；总数/DONE/IN_PROGRESS/阻断待办）。 */
const actionStats = computed(() => summarizeStageActions(actions.value));

function onOpenFlow(): void {
  const id = project.value?.id ?? '';
  if (id) emit('open-flow', id);
}
</script>

<template>
  <section class="ipd-wb-space-card" data-testid="wb-space-progress">
    <header class="ipd-wb-section-header">
      <h2 class="ipd-wb-section-title">
        {{ projectName ? `${projectName} · 阶段进度` : '阶段进度' }}
      </h2>
      <span class="ipd-wb-section-meta">当前产品空间：{{ spaceName }}</span>
    </header>

    <div v-if="state === 'loading'" class="ipd-wb-empty" data-testid="wb-space-progress-loading">
      阶段进度加载中…
    </div>

    <div v-else-if="state === 'error'" class="ipd-wb-empty" data-testid="wb-space-progress-error">
      <p class="ipd-wb-fail-text">阶段进度加载失败</p>
      <button
        type="button"
        class="ipd-wb-retry-btn"
        data-testid="wb-space-progress-retry"
        @click="load"
      >
        重试
      </button>
    </div>

    <div v-else-if="state === 'no-project'" class="ipd-wb-empty" data-testid="wb-space-progress-no-project">
      该产品空间暂无项目，待补充
    </div>

    <template v-else>
      <div class="ipd-wb-stage-rail" data-testid="wb-stage-rail">
        <div
          v-for="item in railItems"
          :key="item.code"
          class="ipd-wb-stage-item"
          :class="item.tone"
          data-testid="wb-stage-item"
        >
          <span class="ipd-wb-stage-dot" />
          <span class="ipd-wb-stage-label">{{ item.label }}</span>
        </div>
      </div>
      <p class="ipd-wb-stage-current">
        当前阶段：{{ stageText(currentStageCode) }}
      </p>
      <div class="ipd-wb-action-stats" data-testid="wb-action-stats">
        <span data-testid="wb-stat-total">动作总数 {{ actionStats.total }}</span>
        <span data-testid="wb-stat-done">已完成 {{ actionStats.done }}</span>
        <span data-testid="wb-stat-in-progress">进行中 {{ actionStats.inProgress }}</span>
        <span class="ipd-wb-stat-blocking" data-testid="wb-stat-blocking">阻断待办 {{ actionStats.blockingPending }}</span>
      </div>
      <button
        type="button"
        class="ipd-wb-coach-btn"
        data-testid="wb-space-flow-btn"
        @click="onOpenFlow"
      >
        查看项目流程
      </button>
    </template>
  </section>
</template>

<style scoped>
/* 产品空间阶段进度卡（与 ipd-wb-* 同视觉语言；唯一断点 768px） */
@media (max-width: 768px) {
  .ipd-wb-stage-rail { flex-wrap: wrap; }

  .ipd-wb-stage-item { flex: 1 1 30%; }
}

.ipd-wb-space-card {
  padding: 18px 20px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

.ipd-wb-empty {
  padding: 28px 12px;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
  text-align: center;
}

.ipd-wb-fail-text {
  margin: 0 0 10px;
  font-weight: 600;
  color: var(--ipd-red, #e45757);
}

.ipd-wb-retry-btn {
  padding: 6px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-blue, #245bf4);
  cursor: pointer;
  background: var(--ipd-blue-soft, #edf2ff);
  border: 1px solid var(--ipd-blue, #245bf4);
  border-radius: 6px;
}

.ipd-wb-stage-rail {
  display: flex;
  gap: 8px;
}

.ipd-wb-stage-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  padding: 10px 6px;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
}

.ipd-wb-stage-dot {
  width: 8px;
  height: 8px;
  background: var(--ipd-line, #dfe4ed);
  border-radius: 50%;
}

.ipd-wb-stage-item.is-done {
  color: var(--ipd-text, #172033);
  background: #f5f7fb;
}

.ipd-wb-stage-item.is-done .ipd-wb-stage-dot { background: var(--ipd-muted, #697388); }

.ipd-wb-stage-item.is-active {
  font-weight: 700;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-color: var(--ipd-blue, #245bf4);
}

.ipd-wb-stage-item.is-active .ipd-wb-stage-dot { background: var(--ipd-blue, #245bf4); }

.ipd-wb-stage-current {
  margin: 12px 0;
  font-size: 13px;
  color: var(--ipd-text, #172033);
}

.ipd-wb-action-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-stat-blocking {
  font-weight: 600;
  color: var(--ipd-red, #e45757);
}

.ipd-wb-coach-btn {
  width: 100%;
  height: 38px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--ipd-blue, #245bf4);
  border: none;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}
</style>
