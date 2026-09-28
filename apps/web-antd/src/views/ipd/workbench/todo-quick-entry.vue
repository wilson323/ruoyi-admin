<script setup lang="ts">
/**
 * 工作台·产品空间（=工作空间）「待办事项快捷入口」卡。
 *
 * 数据（真实接口）：fetchWorkbenchTasks({ bucket: 'pending', limit: 50 })
 * → 按当前产品空间的 projectIds 过滤（不同产品空间不同数据范围），最多列 5 条。
 * 每条「去处理」按 task.deepLink 直达处理页。
 *
 * 四态（不假绿）：
 *   loading —— 待办或数据范围加载中；
 *   error —— fetchWorkbenchTasks reject →「待办数据加载失败」+ 重试按钮（点击重发请求）；
 *   pending —— 数据范围未知（workspace 失败）→「待补充」，禁止当 0 渲染；
 *   empty —— 过滤后为空 →「该产品空间暂无待办」。
 * 失败/未知时头部计数隐藏（禁止把失败渲染成 0 或成功）。
 */
import { computed, ref, watch } from 'vue';

import type { WorkbenchTask } from '../../../api/ipd/workbench';
import { fetchWorkbenchTasks } from '../../../api/ipd/workbench';
import { WORKBENCH_TASK_STATUS_TEXT, taskTypeText } from '../_shared/ipd-enums';
import type { SpaceScope } from './space-context';

interface Props {
  scope: SpaceScope;
  spaceId: string;
  spaceName: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ 'open-task': [deepLink: string] }>();

type TodoState = 'error' | 'loading' | 'ready';
type TodoView = 'empty' | 'error' | 'list' | 'loading' | 'pending';

const state = ref<TodoState>('loading');
const tasks = ref<WorkbenchTask[]>([]);
/** 并发守卫：空间快速切换时丢弃过期响应。 */
let loadToken = 0;

async function load(): Promise<void> {
  const token = ++loadToken;
  state.value = 'loading';
  tasks.value = [];
  try {
    const page = await fetchWorkbenchTasks({ bucket: 'pending', limit: 50 });
    if (token !== loadToken) return;
    tasks.value = page.tasks ?? [];
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

/** 当前产品空间数据范围内的待办（scope.ready 时按项目 id 过滤）。 */
const scopedTasks = computed<WorkbenchTask[]>(() => {
  if (props.scope.status !== 'ready') return [];
  const ids = new Set(props.scope.projects.map((p) => p.id));
  return tasks.value.filter((t) => ids.has(t.projectId));
});

const visible = computed(() => scopedTasks.value.slice(0, 5));

/** 卡头计数：仅在待办与数据范围都为真值时展示（失败/未知不渲染 0）。 */
const scopeCount = computed<null | number>(() =>
  state.value === 'ready' && props.scope.status === 'ready' ? scopedTasks.value.length : null,
);

const view = computed<TodoView>(() => {
  if (state.value === 'error') return 'error';
  if (state.value === 'loading' || props.scope.status === 'loading') return 'loading';
  if (props.scope.status === 'error') return 'pending';
  return visible.value.length > 0 ? 'list' : 'empty';
});

function statusText(status: string): string {
  return WORKBENCH_TASK_STATUS_TEXT[status] ?? status;
}

function dueText(due: null | number | string | undefined): string {
  if (due === null || due === undefined || due === '') return '无截止';
  const d = new Date(due);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd} 截止`;
}

function onOpen(task: WorkbenchTask): void {
  if (task.deepLink) emit('open-task', task.deepLink);
}
</script>

<template>
  <section class="ipd-wb-space-card" data-testid="wb-todo-quick">
    <header class="ipd-wb-section-header">
      <h2 class="ipd-wb-section-title">待办事项快捷入口</h2>
      <span class="ipd-wb-section-meta">
        当前产品空间：{{ spaceName }}<template v-if="scopeCount !== null"> · {{ scopeCount }} 项</template>
      </span>
    </header>

    <ul v-if="view === 'list'" class="ipd-wb-todo-list" data-testid="wb-todo-quick-list">
      <li v-for="t in visible" :key="t.id" class="ipd-wb-todo-row" data-testid="wb-todo-item">
        <div class="ipd-wb-todo-main">
          <p class="ipd-wb-todo-title">{{ t.title ?? t.actionCode ?? '待办事项' }}</p>
          <p class="ipd-wb-todo-meta">
            <span class="ipd-wb-todo-type">{{ taskTypeText(t.taskType) }}</span>
            <span> · {{ statusText(t.status) }}</span>
            <span> · {{ dueText(t.dueDate) }}</span>
          </p>
        </div>
        <button
          type="button"
          class="ipd-wb-todo-go"
          data-testid="wb-todo-go"
          :disabled="!t.deepLink"
          @click="onOpen(t)"
        >
          去处理
        </button>
      </li>
    </ul>

    <div v-else-if="view === 'loading'" class="ipd-wb-empty" data-testid="wb-todo-quick-loading">
      待办数据加载中…
    </div>

    <div v-else-if="view === 'error'" class="ipd-wb-empty" data-testid="wb-todo-quick-error">
      <p class="ipd-wb-fail-text">待办数据加载失败</p>
      <button
        type="button"
        class="ipd-wb-retry-btn"
        data-testid="wb-todo-quick-retry"
        @click="load"
      >
        重试
      </button>
    </div>

    <div v-else-if="view === 'pending'" class="ipd-wb-empty" data-testid="wb-todo-quick-pending">
      该产品空间数据范围待补充
    </div>

    <div v-else class="ipd-wb-empty" data-testid="wb-todo-quick-empty">
      该产品空间暂无待办
    </div>
  </section>
</template>

<style scoped>
/* 待办快捷入口卡（与 ipd-wb-* 同视觉语言；唯一断点 768px） */
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

.ipd-wb-todo-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.ipd-wb-todo-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
}

.ipd-wb-todo-main {
  flex: 1;
  min-width: 0;
}

.ipd-wb-todo-title {
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-text, #172033);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ipd-wb-todo-meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-todo-type {
  font-weight: 600;
  color: var(--ipd-blue, #245bf4);
}

.ipd-wb-todo-go {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--ipd-blue, #245bf4);
  border: none;
  border-radius: 6px;
}

.ipd-wb-todo-go:disabled {
  color: var(--ipd-muted, #697388);
  cursor: not-allowed;
  background: var(--ipd-line, #dfe4ed);
}
</style>
