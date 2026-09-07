<script setup lang="ts">
/**
 * 页15 项目详情-项目日志（卡 P0-10.15；复用 /audit-logs/scope 分层分页）。
 * 本页展示当前项目的审计轨迹：范围仍按会话角色分层（PM=本人 / 组长=本组 / 超管=全局），
 * 项目维度过滤在服务端 entity 过滤交付前仅作用于当前页（本地过滤）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Button, Card, Drawer, Descriptions, DescriptionsItem, Table, Tag, message } from 'ant-design-vue';

import {
  type AuditLog,
  type AuditScopePage,
  filterAuditByEntity,
  pageAuditByScope,
  parseAuditPayload,
} from '../../../../api/ipd/audit';
import { formatDateTime } from '../../_shared/format';

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));

const state = reactive({ pageNo: 1, pageSize: 20 });
const data = ref<AuditScopePage | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await pageAuditByScope(state.pageNo, state.pageSize);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载项目日志失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const allRecords = computed(() => data.value?.page.records ?? []);
const projectRows = computed(() => filterAuditByEntity(allRecords.value, projectId.value));

const pagination = computed(() => ({
  current: data.value?.page.current ?? 1,
  pageSize: state.pageSize,
  total: data.value?.page.total ?? 0,
  showSizeChanger: false,
  onChange: (page: number) => {
    state.pageNo = page;
    void load();
  },
}));

const scopeText = computed(() => {
  const scope = data.value?.scope;
  if (scope === 'GLOBAL') return '全局';
  if (scope === 'GROUP') return '本组';
  if (scope === 'OWN') return '仅本人';
  return '—';
});

const detail = ref<AuditLog | null>(null);
/** 表格 slot 的 record 是宽松对象，在此收口断言（vue-tsc 对 bodyCell 不做类型收窄）。 */
function openDetail(row: Record<string, any>): void {
  detail.value = row as AuditLog;
}
function payloadText(raw: null | string | undefined): string {
  const parsed = parseAuditPayload(raw);
  if (parsed === null) return '（无）';
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

const columns = [
  { title: '序号', dataIndex: 'seq', key: 'seq', width: 80 },
  { title: '操作人', key: 'operator', width: 140 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 140 },
  { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  { title: '时间', key: 'createTime', width: 150 },
  { title: '操作', key: 'actions', width: 80 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`本项目日志按「${scopeText}」范围分层展示（BR-AUD-03）；项目维度过滤在服务端过滤交付前仅作用于当前页，翻页可查看范围 内全部记录。`"
      show-icon
      type="info"
    />

    <Card :title="`项目日志（${projectId}）`">
      <Table
        :columns="columns"
        :data-source="projectRows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'operator'">
            {{ record.operatorName ?? record.operatorId }}
            <span class="text-muted-foreground ml-1 text-xs">{{ record.operatorRole ?? '' }}</span>
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
          <template v-else-if="column.key === 'actions'">
            <Button size="small" type="link" @click="openDetail(record)">详情</Button>
          </template>
        </template>
        <template #emptyText>
          <span>当前页没有本项目（{{ projectId }}）的审计记录</span>
        </template>
      </Table>
    </Card>

    <Drawer :open="detail !== null" :title="detail ? `审计详情 #${detail.seq}` : ''" width="520" @close="detail = null">
      <Descriptions v-if="detail" bordered :column="1" size="small">
        <DescriptionsItem label="动作">
          <Tag>{{ detail.action }}</Tag>
        </DescriptionsItem>
        <DescriptionsItem label="对象">{{ detail.entityType ?? '—' }} / {{ detail.entityId ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="操作人">
          {{ detail.operatorName ?? detail.operatorId }}（{{ detail.operatorRole ?? '—' }}）
        </DescriptionsItem>
        <DescriptionsItem label="原因">{{ detail.reason ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="时间">{{ formatDateTime(detail.createTime) }}</DescriptionsItem>
        <DescriptionsItem label="变更前">
          <pre class="bg-muted max-h-48 overflow-auto rounded p-2 text-xs">{{ payloadText(detail.beforeData) }}</pre>
        </DescriptionsItem>
        <DescriptionsItem label="变更后">
          <pre class="bg-muted max-h-48 overflow-auto rounded p-2 text-xs">{{ payloadText(detail.afterData) }}</pre>
        </DescriptionsItem>
      </Descriptions>
    </Drawer>
  </div>
</template>
