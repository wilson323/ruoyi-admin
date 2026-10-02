<script lang="ts" setup>
/**
 * 站内待办 + AI 任务直达抽屉（R232 P2-04；页03 站内信落位，api/ipd/notification.ts 既有消费点）。
 *
 * <p>数据面全部走既有端点，零新通知格式：
 * - 待办列表 = GET /api/v1/notifications 收件箱（NotificationService 载荷原样），
 *   前端待办只取 kind=ACTION（NotificationService 语义：FYI=知会 / ACTION=可执行行动）；
 * - AI 任务直达 = sourceType=ai_agent_task + sourceId=taskId 单查（todo-link.resolveAiTaskTodo）
 *   → 深链落到 AI 文档审批卡（跨设备不靠会话回放：notification_events + ai_agent_tasks 均持久化）；
 * - 任务时间线 = GET /api/v1/ai-agent-tasks?projectId=（任务卡卡片组，状态到 result_summary 粒度）。
 *
 * <p>fail 并存路径：非 AI 任务行 / 解析失败 → 显示 actionUrl 手动找入口（不吞不卡死）。
 * C08 零直写：本组件只读通知与任务，「直达审批卡」只做路由跳转，审批动作在既有审核页真人提交。
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Button, Drawer, Empty, Spin, Tag } from 'ant-design-vue';

import type { IpdNotification } from '../../../../api/ipd/notification';
import { listNotifications } from '../../../../api/ipd/notification';
import type { AiAgentTaskView } from '../../../../api/ipd/stage-action';
import { fetchAiAgentTasksByProject } from '../../../../api/ipd/stage-action';
import TaskCard from './task-card.vue';
import {
  actionUrlFallback,
  aiTaskDeepLink,
  isAiTaskTodo,
  resolveAiTaskTodo,
} from './todo-link';

interface Props {
  /** 抽屉开关（v-model:open）。 */
  open: boolean;
  /** 可选项目 ID：有值时渲染「任务时间线」卡片组（fetchAiAgentTasksByProject）。 */
  projectId?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();

const router = useRouter();

const loading = ref(false);
const loadError = ref<null | string>(null);
const rows = ref<IpdNotification[]>([]);
const timeline = ref<AiAgentTaskView[]>([]);
const timelineLoading = ref(false);
const resolvingId = ref<null | string>(null);

/** 前端待办语义：只取 ACTION（FYI 为跨组知会不进待办列表）。 */
const todoRows = computed(() =>
  rows.value.filter((n) => (n.kind ?? '').toUpperCase() === 'ACTION'),
);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    rows.value = await listNotifications(false);
  } catch (cause) {
    rows.value = [];
    loadError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
  if (props.projectId) {
    timelineLoading.value = true;
    try {
      timeline.value = await fetchAiAgentTasksByProject(props.projectId);
    } catch {
      timeline.value = [];
    } finally {
      timelineLoading.value = false;
    }
  } else {
    timeline.value = [];
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);

function close() {
  emit('update:open', false);
}

/** 待办行点击：AI 任务单查直达审批卡；失败/非 AI 回退 actionUrl 手动找并存路径。 */
async function onRowClick(row: IpdNotification) {
  if (resolvingId.value) return;
  resolvingId.value = row.id;
  try {
    const target = await resolveAiTaskTodo(row);
    await router.push(target.deepLink).catch(() => {});
    close();
  } finally {
    resolvingId.value = null;
  }
}

/** 任务卡「直达审批卡」：任务行已在手，直接按 aiDocId 深链（C08：仅路由跳转）。 */
function onOpenReview(task: AiAgentTaskView) {
  void router.push(aiTaskDeepLink(task)).catch(() => {});
  close();
}
</script>

<template>
  <Drawer
    :open="props.open"
    placement="right"
    title="站内待办（AI 任务直达）"
    width="520"
    data-testid="ai-task-todo-drawer"
    @update:open="emit('update:open', $event)"
  >
    <Alert
      message="AI 生成内容仅供参考，审批动作请在审核页目检后手动提交（BR-AI-04 / C08）。"
      show-icon
      type="warning"
      data-testid="ai-card-alert"
    />

    <section class="todo-section">
      <h3 class="section-title">待我处理（kind=ACTION）</h3>
      <p v-if="loadError" class="empty-hint">收件箱加载失败：{{ loadError }}</p>
      <Spin v-else-if="loading" />
      <Empty v-else-if="todoRows.length === 0" description="暂无可执行待办" />
      <ul v-else class="todo-list" data-testid="ai-task-todo-list">
        <li v-for="row in todoRows" :key="row.id" class="todo-row">
          <div class="todo-main">
            <p class="todo-title">{{ row.title ?? row.id }}</p>
            <p class="todo-content">{{ row.content ?? '' }}</p>
            <p class="todo-meta">
              <Tag v-if="isAiTaskTodo(row)" color="processing">AI 执行任务</Tag>
              <Tag v-else color="default">业务待办</Tag>
              <span>{{ row.createTime ?? '' }}</span>
            </p>
          </div>
          <div class="todo-actions">
            <Button
              size="small"
              type="primary"
              :loading="resolvingId === row.id"
              data-testid="ai-todo-direct-link"
              @click="onRowClick(row)"
            >
              {{ isAiTaskTodo(row) ? '直达审批卡' : '去处理' }}
            </Button>
            <small v-if="isAiTaskTodo(row)" class="fallback-hint">
              手动找并存路径：{{ actionUrlFallback(row) }}
            </small>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="props.projectId" class="todo-section">
      <h3 class="section-title">AI 任务时间线（卡片组）</h3>
      <Spin v-if="timelineLoading" />
      <Empty v-else-if="timeline.length === 0" description="本项目暂无 AI 执行任务" />
      <div v-else class="timeline-list" data-testid="ai-task-timeline">
        <TaskCard
          v-for="task in timeline"
          :key="task.id"
          :task="task"
          @open-review="onOpenReview"
        />
      </div>
    </section>
  </Drawer>
</template>

<style scoped>
.todo-section {
  margin-top: 16px;
}
.section-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 650;
  color: var(--ipd-text, #26303f);
}
.todo-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.todo-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px;
  border: 1px solid var(--ipd-line, #e2e8f0);
  border-radius: 8px;
  background: var(--ipd-surface, #fff);
}
.todo-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-text, #26303f);
}
.todo-content {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ipd-muted, #6b7488);
  word-break: break-word;
}
.todo-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ipd-muted, #6b7488);
}
.todo-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}
.fallback-hint,
.empty-hint {
  font-size: 12px;
  color: var(--ipd-muted, #6b7488);
}
.timeline-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
