<script lang="ts" setup>
/**
 * 多智能体/蜂群进度卡（AG-UI 单轨，2026-09-29）。
 *
 * 纯展示组件（C08 零直写）：渲染 foldSwarmEvents 产出的 SwarmProgressVm——各子智能体任务的
 * 状态/耗时/产出摘要 + 步骤节拍。数据全部来自 AG-UI 的 SUBAGENT_ 与 STEP_ 事件帧（经 useAgent 订阅），
 * 组件内零写入/零请求路径（不落库、不发请求）。
 *
 * 交互借鉴 AI Elements 的 Reasoning（Collapse 可折叠/展开）+ Task（Timeline 步骤清单）模式，用
 * Ant Design Vue 复刻——不引入 AI Elements 本身（React + shadcn/ui + Next.js 前提，与本项目
 * Vue 3 + Ant Design Vue 栈零兼容）。
 *
 * 色板沿用 _shared/ipd-theme.css 的 --ipd-* 令牌（暗色自动翻转，零硬编码色值、无全局根变量重定义）；
 * 状态色走 Ant Tag preset tone、步骤色走 Timeline preset color（零新色值）。
 */
import { ref, watch } from 'vue';

import {
  Collapse,
  CollapsePanel,
  Empty,
  Tag,
  Timeline,
  TimelineItem,
} from 'ant-design-vue';

import {
  formatDuration,
  swarmStatusMeta,
  type SwarmProgressVm,
} from './swarm-progress';

/** 组件 props（顶层具名 interface + defineProps<Props>()，见 gate-precheck-card.vue 注记）。 */
interface Props {
  /** 蜂群进度 VM（= foldSwarmEvents 产出，字段零增删）。 */
  vm: SwarmProgressVm;
}

const props = defineProps<Props>();

/** Empty 简版占位图（antd 静态资源，非硬编码色值）。 */
const simpleEmptyImage = Empty.PRESENTED_IMAGE_SIMPLE;

/** 任务面板 key（subagentRunId，主流程回退 'main'）。 */
function taskKey(subagentRunId: string): string {
  return subagentRunId || 'main';
}

/** 步骤状态 → Timeline preset color（antd 预设名，非硬编码 hex）。 */
function stepColor(status: 'finished' | 'running'): string {
  return status === 'finished' ? 'green' : 'blue';
}

/**
 * 受控展开键：新到达的子任务默认展开（进度可见），用户手动折叠后不强制重开。
 * 仅追加缺失键，避免覆盖用户交互（Reasoning 模式：可折叠/展开）。
 */
const activeKeys = ref<string[]>([]);
watch(
  () => props.vm.tasks.map((t) => taskKey(t.subagentRunId)),
  (keys) => {
    for (const key of keys) {
      if (!activeKeys.value.includes(key)) activeKeys.value.push(key);
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="ipd-swarm" data-testid="ipd-swarm-progress">
    <header class="swarm-head">
      <h3 class="swarm-title">多智能体执行进度</h3>
      <div class="swarm-counts" data-testid="ipd-swarm-counts">
        <Tag color="processing">执行中 {{ vm.running }}</Tag>
        <Tag color="success">已完成 {{ vm.finished }}</Tag>
        <Tag color="error">失败 {{ vm.errored }}</Tag>
        <Tag>共 {{ vm.total }}</Tag>
      </div>
    </header>

    <Empty
      v-if="vm.tasks.length === 0"
      :image="simpleEmptyImage"
      description="暂无子智能体任务"
      data-testid="ipd-swarm-empty"
    />

    <Collapse v-else v-model:active-key="activeKeys" class="swarm-tasks">
      <CollapsePanel
        v-for="task in vm.tasks"
        :key="taskKey(task.subagentRunId)"
        force-render
      >
        <template #header>
          <span
            class="task-name"
            :data-testid="`ipd-swarm-task-${taskKey(task.subagentRunId)}`"
          >
            {{ task.name }}
          </span>
          <Tag :color="swarmStatusMeta(task.status).tone">
            {{ swarmStatusMeta(task.status).label }}
          </Tag>
          <span class="task-duration">{{ formatDuration(task.durationMs) }}</span>
        </template>

        <p v-if="task.description" class="task-desc">{{ task.description }}</p>

        <Timeline v-if="task.steps.length > 0" class="task-steps">
          <TimelineItem
            v-for="(step, index) in task.steps"
            :key="`${step.stepName}-${index}`"
            :color="stepColor(step.status)"
          >
            {{ step.stepName }}
          </TimelineItem>
        </Timeline>

        <p
          v-if="task.outputSummary"
          class="task-output"
          :data-testid="`ipd-swarm-output-${taskKey(task.subagentRunId)}`"
        >
          <span class="label">产出</span>{{ task.outputSummary }}
        </p>
        <p v-if="task.errorMessage" class="task-error">
          <span class="label">失败</span>{{ task.errorMessage }}
        </p>
      </CollapsePanel>
    </Collapse>

    <small class="swarm-hint">
      进度来自 AG-UI 事件帧实时订阅，纯展示不落库（C08）；数据由大模型/编排产出，未经审核仅供参考（BR-AI-04）。
    </small>
  </section>
</template>

<style scoped>
/* 色板沿用 _shared/ipd-theme.css 的 --ipd-* 令牌（暗色自动翻转，零硬编码色值、无全局根变量重定义） */
.ipd-swarm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 10px;
  background: var(--ipd-surface);
}
.swarm-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}
.swarm-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--ipd-text);
}
.swarm-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.task-name {
  margin-right: 8px;
  font-weight: 600;
  color: var(--ipd-text);
}
.task-duration {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ipd-muted);
}
.task-desc {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--ipd-muted);
}
.task-steps {
  margin: 4px 0 8px;
}
.task-output,
.task-error {
  margin: 4px 0 0;
  font-size: 13px;
  word-break: break-word;
}
.task-output {
  color: var(--ipd-text);
}
.task-error {
  color: var(--ipd-red);
}
.task-output .label,
.task-error .label {
  margin-right: 6px;
  font-size: 12px;
  color: var(--ipd-muted);
}
.swarm-hint {
  color: var(--ipd-muted);
}
</style>
