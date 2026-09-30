<script setup lang="ts">
/**
 * 页43 删除审核-归档区（卡 P0-10.43；仅超管，后端归档列表/彻底清除已交付）。
 * BR-DEL-03：两级通过后软删除进入归档区；「彻底清除」为不可恢复的物理清除，
 * 仅对已删除记录开放，二次确认后执行；删除动作本身写入审计链。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Form, Input, Modal, Table, message } from 'ant-design-vue';

import {
  listDeletionArchive,
  purgeDeletionRequest,
  type DeletionRequest,
} from '../../../../api/ipd/deletion';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { formatDateTime } from '../../_shared/format';
import { DELETION_STATUS_TEXT } from '../../_shared/ipd-enums';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import { useApprovalQueue } from '../../_shared/use-approval-queue';

const auth = useIpdAuthStore();
const isAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');

/* D-3⑧ 渐进改造：列表加载 + 行级清除动作收进 useApprovalQueue 共享 composable
   （消除 rows/loading/busyId/try-catch-toast/reload 骨架重复；行为与改造前逐点对齐：
   非超管零请求、成功文案、失败兜底「清除失败」、成功后 reload 权威刷新、ID 字符串透传）。 */
const { busyId: purgingId, load, rows, runRowAction, loading } = useApprovalQueue<DeletionRequest>({
  canLoad: () => isAdmin.value,
  fetchList: listDeletionArchive,
  getId: (row) => String(row.id ?? ''),
  loadErrorFallback: '加载归档区失败',
});

const purgeTarget = ref<Record<string, any> | null>(null);
const clearedReason = ref('');

/** 表格 slot 的 record 是宽松对象；composable 内经 getId 收敛为 string id。 */
async function purge() {
  const record = purgeTarget.value;
  const reason = clearedReason.value.trim();
  if (!record) return;
  if (!reason) {
    message.warning('请填写清除原因');
    return Promise.reject(new Error('missing-reason'));
  }
  await runRowAction({
    action: (id) => purgeDeletionRequest(id, reason),
    errorFallback: '清除失败',
    row: record,
    successText: '已彻底清除，该记录不可恢复',
  });
  purgeTarget.value = null;
  clearedReason.value = '';
}

onMounted(load);

const columns = [
  { title: '申请编号', dataIndex: 'id', key: 'id' },
  { title: '删除对象', key: 'entity' },
  { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  { title: '状态', key: 'status' },
  { title: '执行时间', key: 'executedAt' },
  { title: '申请时间', key: 'createTime' },
  { title: '操作', key: 'actions', width: 130 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="归档区存放两级审核通过后软删除的对象（BR-DEL-03）。「彻底清除」为不可恢复操作，将物理删除目标数据并写入审计，请谨慎执行。"
      show-icon
      type="warning"
    />

    <Card v-if="isAdmin" v-access:code="IPD_PERMISSION_CODES.DELETION_REQUEST_PURGE" title="归档记录">
      <Table :columns="columns" :data-source="rows" :loading="loading" :pagination="false" row-key="id" size="small">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'entity'">{{ record.entityType }} / {{ record.entityId }}</template>
          <template v-else-if="column.key === 'status'">
            {{ DELETION_STATUS_TEXT[record.status] ?? record.status }}
          </template>
          <template v-else-if="column.key === 'executedAt'">{{ formatDateTime(record.executedAt) }}</template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
          <template v-else-if="column.key === 'actions'">
            <Button
              v-access:code="IPD_PERMISSION_CODES.DELETION_REQUEST_PURGE"
              danger
              :loading="purgingId === record.id"
              size="small"
              type="link"
              @click="purgeTarget = record; clearedReason = ''"
            >彻底清除</Button>
          </template>
        </template>
      </Table>
    </Card>
    <Card v-else>
      <Alert message="归档区仅超级管理员可见（BR-ORG-06）。" show-icon type="warning" />
    </Card>
    <Modal
      :open="purgeTarget !== null"
      title="彻底清除需二次确认"
      ok-text="确认清除"
      ok-type="danger"
      cancel-text="取消"
      @ok="purge"
      @cancel="purgeTarget = null"
    >
      <p>确认尾号将按申请编号 {{ purgeTarget?.id }} 提交。清除不可恢复。</p>
      <Form layout="vertical">
        <Form.Item label="清除原因" required>
          <Input v-model:value="clearedReason" placeholder="填写清除原因" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
