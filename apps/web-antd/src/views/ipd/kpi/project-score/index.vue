<script setup lang="ts">
/**
 * 页31 项目绩效评定（卡 P0-10.31；后端 ProjectScoreController 已交付）。
 * 2026-09-08 契约对齐：改 GET /project-scores/{projectId}/{personId} 单视图
 * （三角色并排 + 加权 + 版本），原 /list /project-score-tasks/my 为臆造路径。
 * 「我的评分任务」列表端点后端未交付（仅超管 POST /project-score-tasks/scan），
 * 页内登记真缺口。
 */
import { computed, ref } from 'vue';
import { Alert, Button, Card, Descriptions, DescriptionsItem, Empty, Input, Tag } from 'ant-design-vue';

import {
  type ProjectScoreView,
  getProjectScore,
  settleProjectScore,
} from '../../../../api/ipd/project-score';
import { ipdErrorText } from '../../_shared/ipd-error-text';

defineOptions({ name: 'IpdKpiScore', meta: { ipdCard: 'P0-10.31' } });

const projectId = ref('');
const personId = ref('');
const view = ref<null | ProjectScoreView>(null);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

async function load(): Promise<void> {
  const pid = projectId.value.trim();
  const uid = personId.value.trim();
  if (!pid || !uid || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    view.value = await getProjectScore(pid, uid);
    loaded.value = true;
  } catch (cause) {
    view.value = null;
    errorMsg.value = ipdErrorText(cause, { fallback: '项目绩效加载失败' });
  } finally {
    loading.value = false;
  }
}

async function settle(): Promise<void> {
  const pid = projectId.value.trim();
  const uid = personId.value.trim();
  if (!pid || !uid || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    view.value = await settleProjectScore(pid, uid);
    loaded.value = true;
  } catch (cause) {
    errorMsg.value = ipdErrorText(cause, { fallback: '结算失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && !view.value);
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="项目绩效：自评 0.2 + 市场组长 0.4 + 研发组长 0.4，三者之和必须 = 1.0；双 PM 项目分独立；重提生成新版本，三角色齐备后可结算。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="按项目 + 人员查询（双 PM 各自独立评分）">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号（必填）</div>
          <Input v-model:value="projectId" placeholder="请输入项目编号" style="width: 200px" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">人员编号（必填，被评 PM）</div>
          <Input v-model:value="personId" placeholder="请输入被评 PM 人员编号" style="width: 200px" />
        </div>
        <Button type="primary" :loading="loading" :disabled="!projectId.trim() || !personId.trim()" @click="load">
          查询评分
        </Button>
        <Button
          :disabled="!projectId.trim() || !personId.trim() || loading || !view"
          :loading="loading"
          @click="settle"
        >
          结算当前版本
        </Button>
      </div>
    </Card>

    <Card class="mb-4" title="评分视图">
      <Empty v-if="errorMsg || isEmpty || !view" :description="errorMsg || (isEmpty ? '该项目人员暂无评分记录' : '请输入项目 + 人员编号后查询')" />
      <Descriptions v-else :column="3" bordered size="small">
        <DescriptionsItem label="项目编号">{{ view.projectId }}</DescriptionsItem>
        <DescriptionsItem label="被评 PM">{{ view.personId }}</DescriptionsItem>
        <DescriptionsItem label="PM 角色">{{ view.pmRole ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="自评（权重 0.2）">{{ view.selfScore ?? '未提交' }}</DescriptionsItem>
        <DescriptionsItem label="市场组长评（权重 0.4）">{{ view.marketLeaderScore ?? '未提交' }}</DescriptionsItem>
        <DescriptionsItem label="研发组长评（权重 0.4）">{{ view.rdLeaderScore ?? '未提交' }}</DescriptionsItem>
        <DescriptionsItem label="加权得分">{{ view.weightedScore ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="评分版本">v{{ view.versionNo ?? '—' }}（规则 v{{ view.ruleVersion ?? '—' }}）</DescriptionsItem>
        <DescriptionsItem label="结算状态">
          <Tag :color="view.settled ? 'green' : 'default'">{{ view.settled ? '已结算' : '未结算' }}</Tag>
        </DescriptionsItem>
      </Descriptions>
    </Card>

    <Card title="我的评分任务">
      <Alert
        message="真缺口登记：「评定人在途评分任务」列表端点后端未交付（ProjectScoreTaskController 仅提供超管 POST /api/v1/project-score-tasks/scan 扫描），待后端补 GET 评分任务端点后接线。当前请通过上方「按项目 + 人员查询」查看评分进度。"
        show-icon
        type="warning"
      />
    </Card>
  </div>
</template>
