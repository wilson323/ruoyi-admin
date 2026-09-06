<script setup lang="ts">
/**
 * 项目详情 - 激励台账 子页签（卡 P0-10.37；后端 BonusPoolController 已交付，
 * 见 /ipd/incentive/bonus-pool/index.vue，本页引导至该页并展示项目维度摘要占位）。
 * 按 G-06 准则：未取得项目维奖金池摘要端点时挂后端依赖说明，不展示任何模拟数据。
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Card } from 'ant-design-vue';

import BackendPending from '../../_shared/backend-pending.vue';

defineOptions({ name: 'IpdProjectIncentive', meta: { ipdCard: 'P0-10.37' } });

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`项目激励台账：${projectId || '尚未选择项目'}`"
      show-icon
      type="info"
    />
    <Card>
      <BackendPending
        backend="BonusPoolController（list/compute/freeze/distribute）已交付；项目维聚合读端点缺，由 /ipd/incentive/bonus-pool 提供完整操作"
        card="P0-10.37"
        note="项目维激励台账子页签——本项目维度奖金池摘要读端点未交付；请到「奖金池核算」页按 projectId+period 查询后核对。"
      />
    </Card>
  </div>
</template>
