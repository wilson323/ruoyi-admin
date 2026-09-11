<script setup lang="ts">
/**
 * 页10 项目详情-项目概览（卡 P0-10.10；后端 GET /projects/{id} 已交付）。
 *
 * 摘要（产品/模板/来源/补齐状态）+ 四立项基准值（修改需双签 BR-INC-04，本页只读）
 * + 差异化系数与定值理由（BR-INC-05）+ 项目状态流转 + G-02 删除申请入口。
 * spec 中的 cert-checklist / PATCH level-coefficient / KPI 入口后端未交付，不展示（G-04）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Grid,
  Space,
  Spin,
  Tag,
  message,
} from 'ant-design-vue';

import {
  changeProjectStatus,
  getProject,
  type Project,
  type ProjectStatus,
} from '../../../../api/ipd/project';
import { PENDING_TEXT } from '../../_shared/format';
import { isTransportError, ipdErrorText } from '../../_shared/ipd-error-text';
import {
  catchupText,
  coefficientText,
  levelText,
  parseMarkets,
  projectDateTimeText,
  projectMoneyText,
  projectStatusColor,
  projectStatusText,
  sourceText,
  stageColor,
  stageText,
  templateText,
} from '../project-display';

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId ?? ''));
const loading = ref(false);
const loadError = ref<unknown>(null);
const project = ref<null | Project>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    project.value = await getProject(projectId.value);
  } catch (cause) {
    project.value = null;
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** 状态机合法后继（前端只提供入口，最终由服务端校验）。 */
const NEXT_STATUS: Record<string, { label: string; value: ProjectStatus }[]> = {
  ACTIVE: [
    { label: '暂停项目', value: 'SUSPENDED' },
    { label: '归档结项', value: 'ARCHIVED' },
  ],
  ARCHIVED: [],
  DRAFT: [{ label: '进入组队', value: 'TEAMING' }],
  SUSPENDED: [
    { label: '恢复进行', value: 'ACTIVE' },
    { label: '归档结项', value: 'ARCHIVED' },
  ],
  TEAMING: [{ label: '启动项目', value: 'ACTIVE' }],
};

const nextStatuses = computed(() => NEXT_STATUS[project.value?.status ?? ''] ?? []);
const transiting = ref('');

async function transit(target: ProjectStatus, label: string): Promise<void> {
  if (transiting.value) return;
  transiting.value = target;
  try {
    project.value = await changeProjectStatus(projectId.value, target);
    message.success(`项目已${label}（${projectStatusText(project.value.status)}）`);
  } catch (cause) {
    message.error(
      isTransportError(cause)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(cause, { domain: 'project', fallback: '状态流转失败，请稍后重试' }),
    );
  } finally {
    transiting.value = '';
  }
}

/** G-02：全站唯一删除入口收敛到删除申请页，带预填 query。 */
function gotoDeletion(): void {
  router.push({ path: '/ipd/deletion/my-requests', query: { entityType: 'projects', entityId: projectId.value } });
}

/**
 * 「目标市场」列跨度（响应式）：与 :column="{ xs: 1, sm: 2, lg: 3 }" 对齐。
 * antd 对「显式 span > 本行剩余列」会收缩该列并弹 Sum of column span 警告——
 * 目标市场前共 9 项，仅 lg（3 列）档恰好整行填满可独占整行；sm/md/xs 档收为 1 格。
 */
const screens = Grid.useBreakpoint();
const marketSpan = computed(() => (screens.value.lg ? 3 : 1));
const markets = computed(() => parseMarkets(project.value?.targetMarkets ?? null));
/** 存量导入补齐提示（BR-PROD-03）。 */
const catchupBanner = computed(() => {
  if (project.value?.source !== 'LEGACY' || project.value.catchupStatus !== 'IN_PROGRESS') return '';
  return '该项目为存量导入，概念阶段起的缺失节点需逐一补齐；已标记「历史缺失」的动作自动豁免门禁。';
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card v-if="loading" class="text-center">
      <Spin>正在加载项目概览……</Spin>
    </Card>

    <Alert
      v-else-if="loadError"
      :message="isTransportError(loadError)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(loadError, { domain: 'project', fallback: '项目概览加载失败，请稍后重试' })"
      show-icon
      type="error"
    >
      <template #description>
        <Button size="small" @click="load">重新加载</Button>
      </template>
    </Alert>

    <template v-else-if="project">
      <Alert v-if="catchupBanner" :message="catchupBanner" show-icon type="warning" />

      <Card title="项目摘要">
        <Descriptions bordered :column="{ xs: 1, sm: 2, lg: 3 }" size="small">
          <DescriptionsItem label="项目编码">{{ project.code || PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="产品 ID">{{ project.productId || PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="模板类型">{{ templateText(project.templateType) }}</DescriptionsItem>
          <DescriptionsItem label="立项级别">{{ levelText(project.level) }}</DescriptionsItem>
          <DescriptionsItem label="当前阶段">
            <Tag :color="stageColor(project.currentStage)">{{ stageText(project.currentStage) }}</Tag>
          </DescriptionsItem>
          <DescriptionsItem label="项目状态">
            <Tag :color="projectStatusColor(project.status)">{{ projectStatusText(project.status) }}</Tag>
          </DescriptionsItem>
          <DescriptionsItem label="来源">{{ sourceText(project.source) }}</DescriptionsItem>
          <DescriptionsItem label="补齐状态">{{ catchupText(project.catchupStatus) }}</DescriptionsItem>
          <DescriptionsItem label="主组 ID">{{ project.mainGroupId || PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="目标市场" :span="marketSpan">
            <Space v-if="markets.length" wrap>
              <Tag v-for="market in markets" :key="market" color="blue">{{ market }}</Tag>
            </Space>
            <span v-else>{{ PENDING_TEXT }}</span>
          </DescriptionsItem>
          <DescriptionsItem label="上市日期（修改需双签）">
            {{ project.launchDate ? projectDateTimeText(project.launchDate) : PENDING_TEXT }}
          </DescriptionsItem>
          <DescriptionsItem label="差异化系数（BR-INC-05）">
            {{ coefficientText(project.levelCoefficient) }}
          </DescriptionsItem>
          <!-- 末项不写 span：antd getFilledItem 对「span=undefined」自动补满本行剩余列且不弹警告；
               显式 span 超限才会被收缩并弹 Sum of column span 警告。 -->
          <DescriptionsItem label="系数定值理由（S/B 必填）">
            {{ project.levelCoefficientReason || PENDING_TEXT }}
          </DescriptionsItem>
        </Descriptions>
      </Card>

      <Card title="立项基准（修改需双签）">
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项目标销售额（元）</div>
            <div class="tabular-nums mt-1 text-lg font-semibold">{{ projectMoneyText(project.targetSalesAmount) }}</div>
          </div>
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项目标渠道商数</div>
            <div class="tabular-nums mt-1 text-lg font-semibold">{{ project.targetChannelCount ?? PENDING_TEXT }}</div>
          </div>
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项 NPS（0-100）</div>
            <div class="tabular-nums mt-1 text-lg font-semibold">{{ project.targetNps ?? PENDING_TEXT }}</div>
          </div>
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项目标场景数</div>
            <div class="tabular-nums mt-1 text-lg font-semibold">{{ project.targetSceneCount ?? PENDING_TEXT }}</div>
          </div>
        </div>
      </Card>

      <Card title="项目治理">
        <Space wrap>
          <Button
            v-for="next in nextStatuses"
            :key="next.value"
            :loading="transiting === next.value"
            :danger="next.value === 'ARCHIVED'"
            @click="transit(next.value, next.label)"
          >
            {{ next.label }}
          </Button>
          <span v-if="nextStatuses.length === 0" class="text-muted-foreground text-sm">
            当前状态无可用流转（已归档或状态锁定）
          </span>
          <Button danger type="primary" @click="gotoDeletion">发起删除申请</Button>
        </Space>
        <div class="text-muted-foreground mt-2 text-xs">
          状态流转与删除均由服务端最终权限校验；删除走两级审核（组长初审 → 超管终审），不做即时删除（G-02）。
        </div>
      </Card>
    </template>
  </div>
</template>
