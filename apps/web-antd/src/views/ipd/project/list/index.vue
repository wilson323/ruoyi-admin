<script setup lang="ts">
/**
 * 页07 我的项目-列表（卡 P0-10.7；后端 ProjectController#list 已交付）。
 *
 * 布局：顶栏（新建/导入 + 角色范围 banner + 关键词搜索）→ 拒绝/断网态 → 空态 → 表格。
 * 表格列：项目编码 / 名称 / 当前阶段 / 立项级别 / 立项销售额 / 来源 / 状态 / 操作。
 *
 * 规格 vs 代码差异（按 G-04 以代码为准）：
 * - 后端 GET /api/v1/projects 仅支持 ?keyword=，不支持规格中 ?scope=；
 * - requireInternal 内部角色全员可见，前端按角色显示范围 banner，但不做客户端硬过滤（后端 BR-ORG-06 细化尚未接入）；
 * - 返回裸 List<Project>，不做 IPage 分页；前端做分页仅作可视化提示。
 */
import { computed, onMounted, ref } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import type { ProjectListItem } from '../../../../api/ipd/project';
import { listProjectItems } from '../../../../api/ipd/project';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import {
  catchupText,
  levelText,
  projectDateText,
  projectMoneyText,
  projectStatusColor,
  projectStatusText,
  sourceText,
  stageColor,
  stageText,
  templateText,
} from '../project-display';
import { isTransportError, ipdErrorText } from '../../_shared/ipd-error-text';
import { createFilterState, useFilterSync } from '../../_shared/use-filter-sync';
import '../../_shared/ipd-theme.css';

const router = useRouter();
const route = useRoute();
const auth = useIpdAuthStore();

/** 本组件挂在父路由 /ipd/projects 上：子路由（create/详情九页签）激活时退化为纯 RouterView 出口，
 * 避免列表与子页叠加渲染（真机走查 2026-09-07 实证：缺出口时详情路由只改标题不渲染）；
 * 无路由名（组件单测 mount）视作列表态。 */
const isIndexRoute = computed(() => route.name === undefined || route.name === 'IpdProjects');

const loading = ref(false);
const loadError = ref<unknown>(null);
const rows = ref<ProjectListItem[]>([]);
/** V7 系统漂移修复：关键词筛选走 URL ?keyword= 双向绑定，可分享 / 刷新不丢。 */
const filters = createFilterState({ keyword: '' });
useFilterSync(filters, { ignored: [] });

const myPersonType = computed(() => auth.identity?.person.personType ?? '');

/** 角色可见范围 banner 文本（前端只展示，不做硬过滤）。 */
const scopeBanner = computed(() => {
  switch (myPersonType.value) {
    case 'SUPER_ADMIN':
      return { tone: 'info' as const, text: '当前角色：超级管理员，可查看全部项目' };
    case 'GROUP_LEADER':
      return { tone: 'info' as const, text: '当前角色：产品组长，按 BR-ORG-06 应仅查看本组项目；当前后端为内部全员可见' };
    case 'MARKET_PM':
    case 'RD_PM':
      return { tone: 'info' as const, text: '当前角色：市场PM/研发PM，按 BR-ORG-06 应仅查看本人负责项目；当前后端为内部全员可见' };
    default:
      return { tone: 'info' as const, text: '当前角色权限不足时仅返回内部可见项目' };
  }
});

const canCreate = computed(() => ['MARKET_PM', 'GROUP_LEADER', 'SUPER_ADMIN'].includes(myPersonType.value));
const canLegacyImport = computed(() => myPersonType.value === 'SUPER_ADMIN');
const createDeniedReason = '新建项目通常由市场PM 操作，当前角色暂不可用。如需代创建请联系超级管理员。';
const legacyImportDeniedReason = '存量导入属于超管专区，当前角色暂不可用。如需代导入请联系超级管理员。';

const columns = [
  { title: '项目编码', key: 'code', width: 160 },
  { title: '项目名称', key: 'name', width: 220 },
  { title: '模板类型', key: 'templateType', width: 100 },
  { title: '当前阶段', key: 'currentStage', width: 110 },
  { title: '立项级别', key: 'level', width: 120 },
  { title: '立项销售额', key: 'targetSalesAmount', width: 140 },
  { title: '来源', key: 'source', width: 100 },
  { title: '状态', key: 'status', width: 100 },
  { title: '上市日期', key: 'launchDate', width: 140 },
  { title: '场景复核', key: 'scenario', width: 110 },
  { title: '操作', key: 'actions', width: 160 },
];

/** 客户端按关键词过滤；规格 vs 代码差异：后端 ?keyword= 仅做服务端过滤，前端再叠一层。 */
const filteredRows = computed(() => {
  const kw = filters.keyword.trim().toLowerCase();
  if (!kw) return rows.value;
  return rows.value.filter((row) =>
    [row.code, row.name].filter(Boolean).some((field) => String(field).toLowerCase().includes(kw)),
  );
});

const pagination = computed(() => ({
  current: 1,
  pageSize: 20,
  total: filteredRows.value.length,
  showTotal: (total: number) => `共 ${total} 条`,
  showSizeChanger: false,
}));

const emptyText = computed(() => {
  if (filters.keyword.trim()) return '暂无符合关键词的项目。可清空关键词或点击「刷新」重试。';
  if (canCreate.value) return '暂无项目。可点击「新建项目」创建，或由超级管理员「存量项目导入」补录。';
  return '暂无项目。请联系超级管理员或市场PM 创建。';
});

function openCreate(): void {
  router.push('/ipd/projects/create');
}

function openLegacyImport(): void {
  router.push('/ipd/projects/legacy-import');
}

/** Table bodyCell 的 record 不做类型收窄：在此收敛断言（与 audit/logs 同模式）。 */
function openDetail(record: Record<string, any>): void {
  router.push(`/ipd/projects/${String(record.id ?? '')}/overview`);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    rows.value = await listProjectItems(filters.keyword.trim() || undefined);
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <RouterView v-if="!isIndexRoute" />
  <div v-else class="p-4">
    <Card class="mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <Space wrap>
          <Tooltip v-if="!canCreate" :title="createDeniedReason">
            <Button type="primary" disabled>新建项目</Button>
          </Tooltip>
          <Button v-else type="primary" @click="openCreate">新建项目</Button>

          <Tooltip v-if="!canLegacyImport" :title="legacyImportDeniedReason">
            <Button disabled>存量项目导入</Button>
          </Tooltip>
          <Button v-else @click="openLegacyImport">存量项目导入</Button>
        </Space>

        <Space>
          <Input.Search
            v-model:value="filters.keyword"
            placeholder="按项目编码或名称搜索"
            class="!w-64"
            allow-clear
            enter-button
            @search="load"
          />
          <Button @click="load">刷新</Button>
        </Space>
      </div>
    </Card>

    <Alert
      :message="scopeBanner.text"
      :type="scopeBanner.tone"
      show-icon
      class="mb-4"
    />

    <Card>
      <Alert
        v-if="loadError"
        class="mb-4"
        :message="loadError
          ? (isTransportError(loadError)
            ? '无法连接服务，请检查网络后重试'
            : ipdErrorText(loadError, { domain: 'project', fallback: '项目列表加载失败，请稍后重试' }))
          : ''"
        type="error"
        show-icon
      >
        <template #description>
          <Button size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <Empty
        v-else-if="!loading && filteredRows.length === 0"
        :description="emptyText"
      />

      <Table
        v-else
        :columns="columns"
        :data-source="filteredRows"
        :loading="loading"
        :pagination="pagination"
        :scroll="{ x: 1400 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'code'">
            <Button type="link" class="!px-0" @click="openDetail(record)">
              {{ record.code || '待补充' }}
            </Button>
            <Tag v-if="record.catchupStatus === 'IN_PROGRESS'" color="warning" class="!ml-1">
              {{ catchupText(record.catchupStatus) }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'name'">{{ record.name || '待补充' }}</template>
          <template v-else-if="column.key === 'templateType'">{{ templateText(record.templateType) }}</template>
          <template v-else-if="column.key === 'currentStage'">
            <Tag :color="stageColor(record.currentStage)">{{ stageText(record.currentStage) }}</Tag>
          </template>
          <template v-else-if="column.key === 'level'">{{ levelText(record.level) }}</template>
          <template v-else-if="column.key === 'targetSalesAmount'">
            <span class="tabular-nums">{{ projectMoneyText(record.targetSalesAmount) }}</span>
          </template>
          <template v-else-if="column.key === 'source'">{{ sourceText(record.source) }}</template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="projectStatusColor(record.status)">{{ projectStatusText(record.status) }}</Tag>
          </template>
          <template v-else-if="column.key === 'launchDate'">{{ projectDateText(record.launchDate) }}</template>
          <template v-else-if="column.key === 'scenario'">
            <!-- P1-9.2：14 天场景复核倒计时；≤3 天 critical 红色告警 -->
            <template v-if="record.scenarioDaysRemaining === null">—</template>
            <template v-else>
              <span :class="record.critical ? 'font-semibold text-red-500' : ''">
                {{ record.scenarioDaysRemaining }} 天
              </span>
              <Tag v-if="record.critical" color="red" class="!ml-1">临界</Tag>
            </template>
          </template>
          <template v-else-if="column.key === 'actions'">
            <Space size="small" wrap>
              <Button size="small" type="link" @click="openDetail(record)">进入详情</Button>
            </Space>
          </template>
        </template>
      </Table>
    </Card>
  </div>
</template>