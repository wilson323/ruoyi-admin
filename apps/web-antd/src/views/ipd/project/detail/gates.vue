<script setup lang="ts">
/**
 * 页23/项目详情 - Gate 评审 子页（卡 P0-10.23；后端 GateReviewController 已交付：
 * GET /gates/{gateId}/review + POST /gates/{gateId}/sign|reopen|extend-deadline|arbitrate|final-ruling）。
 *
 * 路由：/ipd/projects/:projectId/gates —— 由路由注入 projectId。
 *
 * R30 生产就绪补齐（2026-09-11）：
 * 1. 项目维度 Gate 列表（GET /projects/{id}/gates，ProjectController）已交付——列表选中
 *    即评审，不再依赖手输 Gate 编号（手输保留为兜底定位）。
 * 2. 真缺口登记（维持）：材料归档（会议纪要/评审材料 FormData 上传）与五节点顺序签署链
 *    后端未交付，维持真缺口登记，不做假数据。
 * 3. Gate 要素判定（[CONSISTENCY-4]）已落地（GatePanel 内）：countVetoFailures 控提交
 *    按钮 disabled，PASS/FAIL/条件通过 三选一，条件项必填 closeDeadline+responsiblePersonId。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Button, Card, Empty, Input, Table, Tag } from 'ant-design-vue';

import GatePanel from '../../review/gate-panel.vue';
import { type ProjectGateItem, listProjectGates } from '../../../../api/ipd/gate-review';
import { formatDateTime } from '../../_shared/format';
import { ipdErrorText } from '../../_shared/ipd-error-text';

defineOptions({
  name: 'IpdProjectGates',
  meta: {
    ipdBackend: 'ProjectController GET /projects/{id}/gates（R30 项目维度列表）+ GateReviewController GET /gates/{gateId}/review + POST /gates/{gateId}/{sign|reopen|extend-deadline|arbitrate|final-ruling}。',
    ipdCard: 'P0-10.23',
  },
});

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));

// ---------- 项目维度 Gate 列表（R30 主路径） ----------
const gatesList = ref<ProjectGateItem[]>([]);
const listLoading = ref(false);
const listError = ref('');

async function loadGates(): Promise<void> {
  const id = projectId.value.trim();
  if (!id) return;
  listLoading.value = true;
  listError.value = '';
  try {
    gatesList.value = await listProjectGates(id);
  } catch (cause) {
    gatesList.value = [];
    listError.value = ipdErrorText(cause, { fallback: 'Gate 列表加载失败，请稍后重试' });
  } finally {
    listLoading.value = false;
  }
}

onMounted(loadGates);

// ---------- 评审定位：列表选中（主）+ 手输编号（兜底） ----------
const selectedGateId = ref('');
const manualGateId = ref('');

/** 当前激活的 Gate 编号：列表选中优先，手输兜底。 */
const activeGateId = computed(() => selectedGateId.value || manualGateId.value.trim());

const PANEL_KEY = computed(() => `gate-panel-${projectId.value}-${activeGateId.value}`);

function openReview(item: ProjectGateItem | Record<string, any>): void {
  selectedGateId.value = String(item.id ?? '');
}

const GATE_STATUS_COLOR: Record<string, string> = {
  ABSTAINED_TIMEOUT: 'default',
  APPROVED: 'success',
  PENDING: 'processing',
  REJECTED: 'error',
};

function statusColor(status: string): string {
  return GATE_STATUS_COLOR[status] ?? 'default';
}

const columns = [
  { title: 'Gate 编号', dataIndex: 'gateCode', key: 'gateCode', width: 160 },
  { title: '评审轮次', dataIndex: 'currentRound', key: 'currentRound', width: 90 },
  { title: '状态', key: 'status', width: 140 },
  { title: '签署期限', key: 'signDueAt', width: 170 },
  { title: '完结时间', key: 'concludedAt', width: 170 },
  { title: '操作', key: 'actions', width: 110 },
];

/** 后端 Date 字段序列化为毫秒时间戳（真库实测 1789388463000），ISO 字符串为兼容形态；
 * 统一走 _shared/format 的 formatDateTime（毫秒/秒/字符串三态兼容，同 bid-display 契约）。 */
function fmtDate(value: null | number | string | undefined): string {
  return formatDateTime(value, '—');
}
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`项目 Gate 评审：项目 ${projectId || '尚未选择'} · 列表 GET /projects/{id}/gates（R30 已交付）· 评审动作 GET /gates/{gateId}/review + POST /gates/{gateId}/{sign|reopen|extend-deadline|arbitrate|final-ruling}。`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="项目 Gate 列表（GET /projects/{id}/gates）">
      <Table
        :columns="columns"
        :data-source="gatesList"
        :loading="listLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <Tag :color="statusColor(record.status)">{{ record.status }}</Tag>
          </template>
          <template v-else-if="column.key === 'signDueAt'">{{ fmtDate(record.signDueAt) }}</template>
          <template v-else-if="column.key === 'concludedAt'">{{ fmtDate(record.concludedAt) }}</template>
          <template v-else-if="column.key === 'actions'">
            <Button size="small" type="link" @click="openReview(record)">打开评审</Button>
          </template>
        </template>
        <template #emptyText>
          <Empty :description="listError || (projectId ? '该项目尚无 Gate 评审（真实空态，可由 G3 自动创建入口或 POST /projects/{id}/gates 发起）' : '缺少项目编号')" />
        </template>
      </Table>
      <div class="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">手动定位（兜底）</div>
          <Input
            v-model:value="manualGateId"
            placeholder="Gate 编号（纯数字 ID）"
            style="width: 220px"
          />
        </div>
        <Button :loading="listLoading" @click="loadGates">刷新列表</Button>
      </div>
      <div class="mt-2 text-xs text-gray-500">
        列表为该项目的全部未删 Gate（新创建在前）；点击「打开评审」直接进入双签评审面板。
      </div>
    </Card>

    <Card v-if="activeGateId" class="mb-4" title="Gate 评审面板（嵌入式 GatePanel）">
      <GatePanel :key="PANEL_KEY" :initial-gate-id="activeGateId" />
    </Card>
    <Card v-else class="mb-4" title="Gate 评审面板">
      <Empty description="请在上方列表点击「打开评审」，或手动输入 Gate 编号定位" />
    </Card>

    <div class="mt-2 text-xs text-gray-500">
      双签盲签视图（在途互盲仅"对方已提交"）、签署（每方每轮一条，任一 REJECT ⇒ REJECTED）、
      reopen（round+1，第 3 轮组长列席）、超管延期（最多 3 次）、组长仲裁、超管终裁——按 GateReviewController 契约 1:1 渲染。
      材料归档（FormData）与五节点顺序签署链为后端真缺口，未做假数据。
    </div>
  </div>
</template>

<style scoped></style>
