<script setup lang="ts">
/**
 * 页11 项目详情-IPD 流程（卡 P0-10.11；后端 /stage-actions?projectId= + /advance-stage + /gate-checklist 已交付）。
 *
 * 六阶段进度（当前阶段高亮）→ 当前阶段门禁推进（advance-stage 失败时 400/10001
 * message 含明细，同时拉 gate-checklist 只读清单辅助定位）→ 全项目动作列表。
 *
 * 规格 vs 代码差异（G-04 以代码为准）：
 * - key-gates 五节点签署链（P2-5）后端未交付，阶段推进以 gate-checklist 只读清单呈现；
 * - 动作 stageId 是阶段表外键，无 stageId→编码映射端点，动作表不做阶段分组；
 * - 动作详情操作（深管/轻管分形态）在页 12/13（action-detail）完成，本页仅导航。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import {
  advanceProjectStage,
  getGateChecklist,
  getProject,
  type GateChecklistView,
  type Project,
} from '../../../../api/ipd/project';
import { listStageActions, type StageAction } from '../../../../api/ipd/stage-action';
import { isTransportError, ipdErrorText } from '../../_shared/ipd-error-text';
import {
  STAGE_ORDER,
  actionStatusColor,
  actionStatusText,
  depthColor,
  depthText,
  projectDateText,
  stageColor,
  stageText,
} from '../project-display';

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId ?? ''));
const loading = ref(false);
const loadError = ref<unknown>(null);
const project = ref<null | Project>(null);
const actions = ref<StageAction[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [detail, rows] = await Promise.all([getProject(projectId.value), listStageActions(projectId.value)]);
    project.value = detail;
    actions.value = rows;
    await loadChecklist();
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const currentStageIndex = computed(() => {
  const index = STAGE_ORDER.findIndex((stage) => stage.code === project.value?.currentStage);
  return index >= 0 ? index : 0;
});

const stepItems = computed(() =>
  STAGE_ORDER.map((stage, index) => ({
    title: stage.label,
    status:
      index < currentStageIndex.value
        ? ('finish' as const)
        : index === currentStageIndex.value
          ? ('process' as const)
          : ('wait' as const),
  })),
);

/** 动作统计（全项目；阻断性未完成单独计数 BR-IPD-06）。 */
const actionStats = computed(() => {
  const total = actions.value.length;
  const done = actions.value.filter((action) => action.status === 'DONE').length;
  const blockingOpen = actions.value.filter(
    (action) => action.isBlocking === '1' && action.status !== 'DONE' && action.status !== 'NA',
  ).length;
  return { blockingOpen, done, total };
});

const atLifecycle = computed(() => project.value?.currentStage === 'LIFECYCLE');

// ---------- 阶段推进与门禁清单 ----------

const advancing = ref(false);
const advanceError = ref('');
const checklist = ref<GateChecklistView | null>(null);
const checklistLoading = ref(false);

async function loadChecklist(): Promise<void> {
  checklistLoading.value = true;
  try {
    checklist.value = await getGateChecklist(projectId.value);
  } catch {
    checklist.value = null;
  } finally {
    checklistLoading.value = false;
  }
}

async function advance(): Promise<void> {
  if (advancing.value) return;
  advancing.value = true;
  advanceError.value = '';
  try {
    project.value = await advanceProjectStage(projectId.value);
    message.success(`已进入「${stageText(project.value.currentStage)}」`);
    await loadChecklist();
  } catch (cause) {
    advanceError.value = isTransportError(cause)
      ? '无法连接服务，请检查网络后重试'
      : ipdErrorText(cause, { domain: 'project', fallback: '阶段推进失败，请检查门禁清单' });
    await loadChecklist();
  } finally {
    advancing.value = false;
  }
}

const checklistColumns = [
  { key: 'name', title: '门禁项' },
  { key: 'status', title: '动作状态' },
  { key: 'ok', title: '门禁结果', width: 110 },
  { key: 'reason', title: '说明' },
];

// ---------- 动作列表 ----------

const actionColumns = [
  { dataIndex: 'actionCode', key: 'actionCode', title: '编码', width: 130 },
  { dataIndex: 'actionName', key: 'actionName', title: '动作名称' },
  { key: 'depth', title: '管理类型', width: 110 },
  { key: 'status', title: '状态', width: 100 },
  { dataIndex: 'ownerRole', key: 'ownerRole', title: '责任角色', width: 120 },
  { key: 'dueDate', title: '截止日期', width: 130 },
  { key: 'actions', title: '操作', width: 110 },
];

function openAction(row: Record<string, any>): void {
  const actionId = String(row.id ?? '');
  if (actionId) router.push(`/ipd/projects/${projectId.value}/actions/${actionId}`);
}

const actionPagination = computed(() => ({
  current: 1,
  pageSize: 50,
  showSizeChanger: false,
  showTotal: (total: number) => `共 ${total} 条`,
}));
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card v-if="loading" class="text-center">
      <Spin>正在加载 IPD 流程……</Spin>
    </Card>

    <Alert
      v-else-if="loadError"
      :message="isTransportError(loadError)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(loadError, { domain: 'project', fallback: 'IPD 流程加载失败，请稍后重试' })"
      show-icon
      type="error"
    >
      <template #description>
        <Button size="small" @click="load">重新加载</Button>
      </template>
    </Alert>

    <template v-else-if="project">
      <Card title="阶段进度">
        <Steps :current="currentStageIndex" :items="stepItems" />
        <div class="text-muted-foreground mt-3 text-xs">
          当前阶段：<Tag :color="stageColor(project.currentStage)">{{ stageText(project.currentStage) }}</Tag>
          动作完成 {{ actionStats.done }}/{{ actionStats.total }}；
          阻断性未完成 {{ actionStats.blockingOpen }} 项（BR-IPD-06 分级）
        </div>
      </Card>

      <Card title="阶段推进">
        <Alert
          v-if="advanceError"
          class="mb-4"
          :message="advanceError"
          show-icon
          type="error"
        />
        <Space wrap>
          <Button
            v-if="!atLifecycle"
            :loading="advancing"
            type="primary"
            @click="advance"
          >
            进入下一阶段
          </Button>
          <Button :loading="checklistLoading" @click="loadChecklist">刷新门禁清单</Button>
        </Space>
        <div v-if="atLifecycle" class="text-muted-foreground mt-2 text-sm">
          已处于生命周期阶段（最终阶段），无后续阶段推进。
        </div>

        <div v-if="checklist" class="mt-4">
          <div class="mb-2 text-sm font-medium">
            门禁清单（{{ stageText(checklist.stage ?? project.currentStage) }} /
            配置版本 {{ checklist.configVersion || '待补充' }}）
          </div>
          <Table
            :columns="checklistColumns"
            :data-source="checklist.items"
            :pagination="false"
            row-key="code"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                {{ record.status ? actionStatusText(record.status) : '未开始' }}
              </template>
              <template v-else-if="column.key === 'ok'">
                <Tag :color="record.ok ? 'success' : 'error'">{{ record.ok ? '已满足' : '未满足' }}</Tag>
              </template>
              <template v-else-if="column.key === 'reason'">
                <span :class="record.ok ? 'text-muted-foreground' : 'text-red-600'">{{ record.reason || '—' }}</span>
              </template>
            </template>
          </Table>
        </div>
        <div v-else-if="!checklistLoading" class="text-muted-foreground mt-4 text-sm">
          门禁清单暂不可用（当前阶段可能无配置），以推进按钮返回的服务端校验结果为准。
        </div>
      </Card>

      <Card title="阶段动作（全项目）">
        <Table
          :columns="actionColumns"
          :data-source="actions"
          :pagination="actionPagination"
          :scroll="{ x: 900 }"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'depth'">
              <Tag :color="depthColor(record.depth)">{{ depthText(record.depth) }}</Tag>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="actionStatusColor(record.status)">{{ actionStatusText(record.status) }}</Tag>
            </template>
            <template v-else-if="column.key === 'dueDate'">
              {{ record.dueDate ? projectDateText(record.dueDate) : '—' }}
            </template>
            <template v-else-if="column.key === 'actions'">
              <Button size="small" type="link" @click="openAction(record)">查看详情</Button>
            </template>
          </template>
        </Table>
        <div class="text-muted-foreground mt-2 text-xs">
          深管动作完成需登记交付物、轻管动作需录入实际完成日期等字段（BR-IPD-03/04），操作在动作详情页进行。
        </div>
      </Card>
    </template>
  </div>
</template>
