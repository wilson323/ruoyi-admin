<script setup lang="ts">
/**
 * 项目详情壳（路由父级，9 个子页签导航 + 子路由出口）。
 * 子页签内容：overview / flow / audit 等其余页签组件由各自看板卡实现，
 * documents / changes 两页签由本卡（P0-10.14 / P0-10.25 详情 tab 卡）实现。
 * 壳只负责：项目头部信息（GET /projects/{id}）+ 页签导航，不承载领域逻辑。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Button, Spin } from 'ant-design-vue';

import { PENDING_TEXT, formatDate } from '../../_shared/format';
import { ipdApiErrorText } from '../../../../api/ipd/ai-document';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { ipdGet } from '../../../../api/ipd/http';

interface ProjectSummary {
  code: null | string;
  currentStage: null | string;
  id: string;
  launchDate: null | string;
  level: null | string;
  lifecycleStatus: null | string;
  name: null | string;
  status: null | string;
}

/** 六阶段编码对照 ProjectBootstrapService.STAGES（CONCEPT/PLAN/DEV/VALID/LAUNCH/LIFECYCLE）。 */
const STAGE_TEXTS: Record<string, string> = {
  CONCEPT: '概念',
  DEV: '开发',
  LIFECYCLE: '生命周期',
  LAUNCH: '发布',
  PLAN: '计划',
  VALID: '验证',
};

/** 页签顺序与路由注册顺序一致（router/routes/modules/ipd.ts IpdProjectDetail.children）。 */
const TABS = [
  { key: 'overview', title: '概览' },
  { key: 'flow', title: 'IPD 流程' },
  { key: 'gates', title: 'Gate 评审' },
  { key: 'changes', title: '需求与变更' },
  { key: 'kpi', title: 'KPI 考核' },
  { key: 'incentive', title: '激励台账' },
  { key: 'documents', title: '文档与交付物' },
  { key: 'audit', title: '项目日志' },
  // 协作圈（看板卡 c5254e23）：ProjectCircleController /api/v1/project-circle 6 端点唯一数据源
  { key: 'circle', title: '协作圈' },
] as const;

const route = useRoute();

const projectId = computed(() => String(route.params.projectId ?? ''));
const projectIdValid = computed(() => /^\d+$/.test(projectId.value));

const loading = ref(false);
const loadError = ref<null | string>(null);
const project = ref<null | ProjectSummary>(null);

const activeKey = computed(() => {
  const segments = String(route.path).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'overview';
});

function parseProject(data: unknown): ProjectSummary {
  const record = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  if (!record || !/^\d+$/.test(String(record.id ?? ''))) {
    throw new IpdRequestError('项目数据格式异常，请稍后重试');
  }
  return {
    code: typeof record.code === 'string' ? record.code : null,
    currentStage: typeof record.currentStage === 'string' ? record.currentStage : null,
    id: String(record.id),
    launchDate: typeof record.launchDate === 'string' ? record.launchDate.replace(' ', 'T') : null,
    level: typeof record.level === 'string' ? record.level : null,
    lifecycleStatus: typeof record.lifecycleStatus === 'string' ? record.lifecycleStatus : null,
    name: typeof record.name === 'string' ? record.name : null,
    status: typeof record.status === 'string' ? record.status : null,
  };
}

async function loadProject() {
  loading.value = true;
  loadError.value = null;
  try {
    project.value = parseProject(await ipdGet<unknown>(`/projects/${projectId.value}`));
  } catch (cause) {
    project.value = null;
    loadError.value = ipdApiErrorText(cause, '项目信息加载失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}

function tabPath(key: string): string {
  return `/ipd/projects/${projectId.value}/${key}`;
}

onMounted(() => {
  if (projectIdValid.value) void loadProject();
});
</script>

<template>
  <div class="p-4">
    <template v-if="!projectIdValid">
      <Alert
        message="链接无效"
        description="项目参数缺失或格式不正确，请从「我的项目」列表重新进入。"
        show-icon
        type="error"
      />
    </template>

    <template v-else-if="loading">
      <div class="flex min-h-[240px] items-center justify-center">
        <Spin size="large" tip="正在加载项目信息……" />
      </div>
    </template>

    <template v-else-if="loadError">
      <Alert show-icon type="error" role="alert">
        <template #message>{{ loadError }}</template>
        <template #description>
          <Button class="mt-2" @click="loadProject">重新加载</Button>
        </template>
      </Alert>
    </template>

    <template v-else-if="project">
      <Card class="mb-4">
        <div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <h1 class="m-0 text-xl font-semibold">{{ project.name || PENDING_TEXT }}</h1>
          <span class="text-muted-foreground text-sm">项目编号：{{ project.code || PENDING_TEXT }}</span>
          <span class="text-muted-foreground text-sm">
            当前阶段：{{ project.currentStage ? (STAGE_TEXTS[project.currentStage] ?? project.currentStage) : PENDING_TEXT }}
          </span>
          <span class="text-muted-foreground text-sm">等级：{{ project.level || PENDING_TEXT }}</span>
          <span class="text-muted-foreground text-sm">上市日期：{{ formatDate(project.launchDate) }}</span>
        </div>
      </Card>

      <nav class="mb-4 flex flex-wrap gap-2 border-b border-gray-200 pb-2" aria-label="项目详情页签">
        <RouterLink
          v-for="tab in TABS"
          :key="tab.key"
          v-slot="{ navigate }"
          :to="tabPath(tab.key)"
          custom
        >
          <button
            :class="[
              'rounded px-3 py-1.5 text-sm transition-colors',
              activeKey === tab.key
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            ]"
            :aria-current="activeKey === tab.key ? 'page' : undefined"
            type="button"
            @click="navigate"
          >
            {{ tab.title }}
          </button>
        </RouterLink>
      </nav>

      <RouterView />
    </template>

    <template v-else>
      <!-- 后端可达但未返回项目数据时的兜底，避免静默空白（G-06）。 -->
      <Alert
        message="项目信息为空"
        description="未获取到项目数据，请点击上方「重新加载」重试。"
        show-icon
        type="warning"
      />
    </template>
  </div>
</template>
