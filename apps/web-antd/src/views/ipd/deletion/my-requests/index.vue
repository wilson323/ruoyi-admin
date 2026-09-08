<script setup lang="ts">
/**
 * 页04 删除审核-我的申请（卡 P0-10.4；后端已交付提交/撤回，列表查询未交付）。
 * G-02：全站任何「删除」入口统一收敛到本页发起两级审核，不做即时删除；
 * BR-DEL-04：申请人 24 小时内、未终态可撤回；「我的申请」列表端点待后端交付，
 * 当前请保存返回的申请编号用于后续查询与撤回。
 */
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Input,
  Select,
  SelectOption,
  Textarea,
  message,
} from 'ant-design-vue';

import {
  DELETION_ENTITY_TYPES,
  submitDeletionRequest,
  withinWithdrawWindow,
  withdrawDeletionRequest,
  type DeletionEntityType,
  type DeletionRequest,
} from '../../../../api/ipd/deletion';
import { formatDateTime } from '../../_shared/format';
import { DELETION_STATUS_TEXT } from '../../_shared/ipd-enums';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

const route = useRoute() as unknown as { query?: Record<string, unknown> } | undefined;

/** G-02：项目概览等删除入口携 query 预填（entityType/entityId），非法值回落默认。 */
function prefilledEntityType(): DeletionEntityType {
  const q = String(route?.query?.entityType ?? '');
  return DELETION_ENTITY_TYPES.some((item) => item.value === q) ? (q as DeletionEntityType) : 'projects';
}

const form = reactive({
  entityType: prefilledEntityType(),
  entityId: String(route?.query?.entityId ?? ''),
  reason: '',
  snapshot: '',
});
const reasonTooShort = computed(() => form.reason.trim().length > 0 && form.reason.trim().length < 6);
const canSubmit = computed(() => form.entityId.trim() !== '' && form.reason.trim().length >= 6);
const submitting = ref(false);
const lastResult = ref<DeletionRequest | null>(null);

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    lastResult.value = await submitDeletionRequest({
      entityType: form.entityType,
      entityId: form.entityId.trim(),
      reason: form.reason.trim(),
      snapshot: form.snapshot.trim() || undefined,
    });
    message.success('删除申请已提交，进入组长初审（2 个工作日）');
    form.entityId = '';
    form.reason = '';
    form.snapshot = '';
  } catch (error) {
    message.error(error instanceof Error ? error.message : '提交失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
}

const withdrawId = ref('');
const withdrawing = ref(false);
const canWithdrawLast = computed(() => withinWithdrawWindow(lastResult.value?.createTime));

async function withdraw() {
  const id = withdrawId.value.trim();
  if (!id || withdrawing.value) return;
  withdrawing.value = true;
  try {
    lastResult.value = await withdrawDeletionRequest(id);
    message.success('申请已撤回');
    withdrawId.value = '';
  } catch (error) {
    message.error(error instanceof Error ? error.message : '撤回失败');
  } finally {
    withdrawing.value = false;
  }
}
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="全站任何「删除」入口都统一走删除申请两级审核（组长初审 → 超管终审），不做即时删除；申请人可在提交后 24 小时内撤回。「我的申请」列表查询待后端交付，请保存申请编号用于查询与撤回。"
      show-icon
      type="info"
    />

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="发起删除申请">
        <div class="flex flex-col gap-4">
          <div>
            <div class="mb-1 text-sm">删除对象类型</div>
            <Select v-model:value="form.entityType" class="w-full">
              <SelectOption v-for="item in DELETION_ENTITY_TYPES" :key="item.value" :value="item.value">
                {{ item.label }}
              </SelectOption>
            </Select>
          </div>
          <div>
            <div class="mb-1 text-sm">对象 ID</div>
            <Input v-model:value="form.entityId" placeholder="待删除实体的 ID" />
          </div>
          <div>
            <div class="mb-1 text-sm">删除原因（至少 6 个字符）</div>
            <Textarea v-model:value="form.reason" :rows="3" placeholder="说明删除原因，供两级审核参考" />
            <div v-if="reasonTooShort" class="text-destructive mt-1 text-xs">删除原因至少 6 个字符</div>
          </div>
          <div>
            <div class="mb-1 text-sm">补充说明（可选）</div>
            <Textarea v-model:value="form.snapshot" :rows="2" placeholder="替代资料、快照说明等补充信息" />
          </div>
          <Button danger :disabled="!canSubmit" :loading="submitting" type="primary" v-access:code="IPD_PERMISSION_CODES.DELETION_REQUEST_SUBMIT" @click="submit">
            发起删除申请
          </Button>
        </div>
      </Card>

      <div class="flex flex-col gap-4">
        <Card title="撤回申请">
          <div class="flex flex-col gap-4">
            <Alert message="仅申请人本人、提交后 24 小时内且未终态的申请可撤回（BR-DEL-04）。" show-icon type="warning" />
            <div class="flex gap-2">
              <Input v-model:value="withdrawId" placeholder="申请编号" />
              <Button :disabled="withdrawId.trim() === ''" :loading="withdrawing" @click="withdraw">撤回</Button>
            </div>
          </div>
        </Card>

        <Card v-if="lastResult" title="最近一次申请结果">
          <Descriptions bordered :column="1" size="small">
            <DescriptionsItem label="申请编号">{{ lastResult.id }}</DescriptionsItem>
            <DescriptionsItem label="状态">
              {{ DELETION_STATUS_TEXT[lastResult.status] ?? lastResult.status }}
            </DescriptionsItem>
            <DescriptionsItem label="删除对象">{{ lastResult.entityType }} / {{ lastResult.entityId }}</DescriptionsItem>
            <DescriptionsItem label="提交时间">{{ formatDateTime(lastResult.createTime) }}</DescriptionsItem>
            <DescriptionsItem label="组长初审截止">{{ formatDateTime(lastResult.leaderDueAt) }}</DescriptionsItem>
            <DescriptionsItem label="超管终审截止">{{ formatDateTime(lastResult.adminDueAt) }}</DescriptionsItem>
            <DescriptionsItem label="撤回窗口">
              {{ lastResult.status === 'WITHDRAWN' ? '已撤回' : (canWithdrawLast ? '24 小时内可撤回' : '已超出撤回窗口') }}
            </DescriptionsItem>
          </Descriptions>
          <div class="text-muted-foreground mt-2 text-xs">请保存申请编号 {{ lastResult.id }}，用于后续查询与撤回。</div>
        </Card>
      </div>
    </div>
  </div>
</template>
