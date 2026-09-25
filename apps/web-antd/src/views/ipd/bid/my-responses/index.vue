<script setup lang="ts">
/**
 * 研发 PM「我的应标」列表（R215 GAP-F9；卡 3ef76d39，BidController#listByRdPm）。
 *
 * 端点真值：GET /api/v1/bid-responses/by-rd-pm/{rdPmId}?pageNo=&pageSize=
 * （@GetMapping BidController.java:170，权限注解 ipd:project:query :169 + requireInternal :176；
 * IDOR 三分支放行：本人 / SUPER_ADMIN / 关联项目在职 ProjectMember，service javadoc:166）。
 *
 * 取数坑（准备包钉死）：rdPmId 从 /auth/me 的 person.id（string，api/ipd/auth.ts:102 有 /^\d+$/
 * 校验先例）取；禁从 vben userStore 拿 userId——store/ipd-auth.ts:135 处它是
 * `as unknown as number` 类型强转，类型面诱导数值运算，19 位雪花一经算术即精度碎。
 * 超管/项目成员代查场景本期不做 UI（端点天然支持三分支，卡名聚焦「我的」）。
 * pageSize 有后端 200 硬上限（service javadoc:167），页内选项最高 200，越界由后端钳制。
 */
import { onMounted, ref } from 'vue';
import { Alert, Button, Card, Empty, Table, Tag } from 'ant-design-vue';

import type { BidResponse, IpdPage } from '../../../../api/ipd/bid';

import { listBidResponsesByRdPm } from '../../../../api/ipd/bid';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { PENDING_TEXT } from '../../_shared/format';
import { bidResponseStatusLabel, bidResponseStatusTone } from '../../_shared/ipd-enums';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import '../../_shared/ipd-theme.css';

defineOptions({ name: 'IpdBidMyResponses', meta: { ipdCard: 'R215-GAP-F9' } });

const auth = useIpdAuthStore();

const rows = ref<BidResponse[]>([]);
const total = ref(0);
const pageNo = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const errorMsg = ref('');

const columns = [
  { title: '应标 ID', dataIndex: 'id', key: 'id', width: 200 },
  { title: '所属招标单', key: 'invitation', width: 220 },
  { title: '状态', key: 'status', width: 120 },
  { title: '应标说明', dataIndex: 'responseNote', key: 'responseNote' },
  { title: '应标时间', dataIndex: 'respondedAt', key: 'respondedAt', width: 190 },
];

async function load(): Promise<void> {
  const rdPmId = auth.identity?.person.id ?? '';
  if (!rdPmId) {
    errorMsg.value = '未取到登录身份（/auth/me person.id 缺失），请重新登录后重试';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    const page: IpdPage<BidResponse> = await listBidResponsesByRdPm(rdPmId, {
      pageNo: pageNo.value,
      pageSize: pageSize.value,
    });
    rows.value = page.records;
    total.value = page.total;
  } catch (cause) {
    rows.value = [];
    total.value = 0;
    errorMsg.value = ipdErrorText(cause, {
      domain: 'bid',
      fallback: cause instanceof IpdRequestError ? cause.message : '我的应标加载失败，请稍后重试',
    });
  } finally {
    loading.value = false;
  }
}

function onPageChange(pag: { current?: number; pageSize?: number }): void {
  pageNo.value = Number(pag.current ?? 1);
  pageSize.value = Number(pag.pageSize ?? 20);
  load().catch(() => { /* 错误已进 errorMsg 呈现 */ });
}

onMounted(() => {
  // identity 未装载时先补拉 /auth/me（best-effort；失败走「未取到登录身份」错误态）
  const boot = async (): Promise<void> => {
    if (!auth.identity) {
      try { await auth.refreshIdentity(); } catch { /* 落到 load 内的空身份防御 */ }
    }
    await load();
  };
  boot().catch(() => { /* 视图内已消化 */ });
});
</script>

<template>
  <div class="ipd-my-responses p-4">
    <Alert
      class="mb-4"
      type="info"
      show-icon
      message="我的应标：当前登录研发 PM 提交过的全部应标记录（分页）。数据权限由服务端会话推导（本人可见；超管/关联项目成员可由接口代查，本页面聚焦「我的」）。"
    />
    <Card title="我的应标列表">
      <div class="mb-3">
        <span class="mr-3 text-xs text-gray-500">
          身份 ID：<span class="font-mono">{{ auth.identity?.person.id ?? PENDING_TEXT }}</span>
        </span>
        <Button size="small" :loading="loading" @click="load">刷新</Button>
      </div>
      <Alert v-if="errorMsg" class="mb-3" :message="errorMsg" type="error" show-icon role="alert" />
      <Table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="{ current: pageNo, pageSize, total, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }"
        row-key="id"
        size="small"
        bordered
        @change="onPageChange"
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'invitation'">
            <!-- 无独立招标单详情路由（bid/list 以 Drawer 呈现详情）→ 链接回研发招募列表定位 -->
            <RouterLink class="font-mono text-xs" to="/ipd/bids">{{ record.invitationId }}</RouterLink>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="bidResponseStatusTone(String(record.status))">{{ bidResponseStatusLabel(String(record.status)) }}</Tag>
          </template>
          <template v-else-if="column.key === 'respondedAt'">
            <span class="font-mono text-xs">{{ record.respondedAt ?? PENDING_TEXT }}</span>
          </template>
        </template>
        <template #emptyText>
          <Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无应标记录" />
        </template>
      </Table>
    </Card>
  </div>
</template>
