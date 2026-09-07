<script setup lang="ts">
/**
 * 项目详情 - Gate 评审 子页签（卡 P0-10.23；后端 GateReviewController 已交付：
 * GET /gates/{gateId}/review + POST /gates/{gateId}/sign|reopen|extend-deadline|arbitrate|final-ruling）。
 *
 * 路由：/ipd/projects/:projectId/gates —— 由路由注入 projectId。
 *
 * 真缺口登记（避免契约漂移）：
 * 1. 原型 /api/key-gates?projectId=（项目维度 Gate 列表）后端未交付——Gate 经 Gate 编号定位；
 *    当前页用「项目维度 Gate 列表缺：手动输入 Gate 编号」明确告知，并嵌入既有 GatePanel 复核流程。
 * 2. 原型材料归档（会议纪要/评审材料 FormData 上传）与五节点顺序签署链后端未交付，
 *    维持真缺口登记，不做假数据。
 * 3. Gate 要素判定（[CONSISTENCY-4]）已落地：countVetoFailures 控提交按钮 disabled，
 *    PASS/FAIL/条件通过 三选一，条件项必填 closeDeadline+responsiblePersonId。
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Button, Card, Empty, Input, Tag } from 'ant-design-vue';

import GatePanel from '../../review/gate-panel.vue';

defineOptions({ name: 'IpdProjectGates', meta: { ipdCard: 'P0-10.23' } });

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));

// Gate 评审面板复用：GatePanel 内部用 gateIdInput 触发，按 gateId 定位评审视图。
const gateId = ref('');
const loading = ref(false);
const errorMsg = ref('');

const PANEL_KEY = computed(() => `gate-panel-${projectId.value}-${gateId.value}`);

function load(): void {
  const id = gateId.value.trim();
  if (!id) {
    errorMsg.value = '请填写 Gate 编号';
    return;
  }
  errorMsg.value = '';
  // GatePanel 自身 watch gateIdInput 重新拉数据；此处只需清错。
  loading.value = true;
  loading.value = false;
}
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`项目 Gate 评审：项目 ${projectId || '尚未选择'} · 后端 GateReviewController：GET /gates/{gateId}/review · POST /gates/{gateId}/{sign|reopen|extend-deadline|arbitrate|final-ruling}。原型 /api/key-gates（项目维度 Gate 列表）后端未交付，Gate 经 Gate 编号定位（审计/通知侧提供编号）。`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="Gate 定位">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号</div>
          <Input
            :value="projectId"
            disabled
            placeholder="由路由注入（/ipd/projects/:projectId/gates）"
            style="width: 220px"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">Gate 编号</div>
          <Input
            v-model:value="gateId"
            placeholder="如 G2026-Q4-01"
            style="width: 200px"
            @keyup.enter="load"
          />
        </div>
        <Button type="primary" :loading="loading" @click="load">定位评审</Button>
      </div>
      <div class="mt-3">
        <Tag color="warning">真缺口</Tag>
        <span class="ml-2 text-xs text-gray-500">
          项目维度 Gate 列表端点（/api/key-gates）后端未交付，需手动输入 Gate 编号进入评审；
          Gate 编号通常由审计/通知侧创建评审时下发。
        </span>
      </div>
      <div v-if="errorMsg" class="mt-2 text-xs text-red-600">{{ errorMsg }}</div>
    </Card>

    <Card v-if="gateId.trim()" class="mb-4" title="Gate 评审面板（嵌入式 GatePanel）">
      <GatePanel :key="PANEL_KEY" />
    </Card>

    <Card v-else class="mb-4" title="Gate 评审面板">
      <Empty description="请先在上方输入 Gate 编号后加载评审面板" />
    </Card>

    <div class="mt-2 text-xs text-gray-500">
      双签盲签视图（在途互盲仅"对方已提交"）、签署（每方每轮一条，任一 REJECT ⇒ REJECTED）、
      reopen（round+1，第 3 轮组长列席）、超管延期（最多 3 次）、组长仲裁、超管终裁——按 GateReviewController 契约 1:1 渲染。
    </div>
  </div>
</template>

<style scoped></style>
