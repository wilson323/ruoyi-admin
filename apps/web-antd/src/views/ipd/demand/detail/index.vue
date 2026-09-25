<script setup lang="ts">
/**
 * 需求详情（R215-E2E-C 看板卡 f4445a05 补缺口；后端 GET /api/v1/demands/{id}）。
 *
 * 字段集 1:1 对齐 DemandController list/detail 共用 VO（14 字段），不臆造后端没有的字段：
 * id / productId / productName / projectId / source / submitterName / customerName /
 * title / status / marketPmId / marketPmName / rdPmId / rdPmName / createdAt。
 * 路由：/ipd/requirements/:id（IpdRequirementDetail，hideInMenu + activePath 回高亮列表）。
 * ID 纪律：19 位雪花 id 全程 string 透传，禁止 Number()。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Alert, Button, Card, Descriptions, DescriptionsItem, Spin, Tag } from 'ant-design-vue';

import { IpdRequestError } from '../../../../api/ipd/auth';
import { type IpdDemand, fetchDemandDetail } from '../../../../api/ipd/demand';
import { PENDING_TEXT, formatDateTime } from '../../_shared/format';
import { demandStateLabel } from '../../_shared/ipd-enums';

defineOptions({ name: 'IpdRequirementDetail' });

const route = useRoute();
const router = useRouter();

const demandId = computed(() => String(route.params.id ?? ''));

const loading = ref(false);
const errorMsg = ref('');
const isNetwork = ref(false);
const detail = ref<IpdDemand | null>(null);

function errorText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '需求详情加载失败，请稍后重试';
}

async function load() {
  if (!demandId.value) {
    errorMsg.value = '需求 ID 缺失，请返回需求管理列表重新进入详情';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  isNetwork.value = false;
  try {
    detail.value = await fetchDemandDetail(demandId.value);
  } catch (cause) {
    detail.value = null;
    isNetwork.value = cause instanceof IpdRequestError && cause.kind === 'transport';
    errorMsg.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function sourceText(source: null | string): string {
  if (source === 'PORTAL_GUEST') return '游客门户';
  if (source === 'INTERNAL') return '内部';
  return source ?? PENDING_TEXT;
}

onMounted(load);
</script>

<template>
  <div class="p-4">
    <Card :title="`需求详情 #${demandId || PENDING_TEXT}`">
      <template #extra>
        <Button size="small" @click="router.push('/ipd/requirements')">返回需求管理</Button>
      </template>

      <Spin v-if="loading" tip="加载中..." />
      <Alert
        v-else-if="errorMsg"
        :message="isNetwork ? '网络异常' : '加载失败'"
        :type="isNetwork ? 'warning' : 'error'"
        show-icon
      >
        <template #description>
          <div class="flex flex-col items-start gap-2">
            <span>{{ errorMsg }}</span>
            <Button size="small" @click="load">重新加载</Button>
          </div>
        </template>
      </Alert>
      <Descriptions v-else-if="detail" :column="2" bordered size="small">
        <DescriptionsItem label="需求编号">#{{ detail.id }}</DescriptionsItem>
        <DescriptionsItem label="状态">
          <Tag>{{ demandStateLabel(detail.status, detail.status) }}</Tag>
        </DescriptionsItem>
        <DescriptionsItem label="标题" :span="2">{{ detail.title ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="来源">{{ sourceText(detail.source) }}</DescriptionsItem>
        <DescriptionsItem label="提交时间">{{ formatDateTime(detail.createdAt) }}</DescriptionsItem>
        <DescriptionsItem label="客户">{{ detail.customerName ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="提交人">{{ detail.submitterName ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="归属产品">{{ detail.productName ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="产品ID">{{ detail.productId ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="关联项目ID">{{ detail.projectId ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="市场PM">{{ detail.marketPmName ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="研发PM">{{ detail.rdPmName ?? PENDING_TEXT }}</DescriptionsItem>
      </Descriptions>
      <p v-else class="text-xs text-gray-500">暂无数据</p>
    </Card>
  </div>
</template>
