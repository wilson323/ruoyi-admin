<script setup lang="ts">
/**
 * 页17 产品新增·编辑（卡 P0-10.17；后端 P1-1.2 /api/v1/products）。
 *
 * 双形态：
 * - /ipd/products/create → 新增（POST /products）；
 * - /ipd/products/:productId/edit → 编辑（GET /products/:id 回填 + PUT /products/:id）。
 *
 * 后端真值：
 * - 新增白名单 productCode/productName/modelCode/source/groupId（CODE-01 不收 status/projectId）；
 * - 编辑白名单 productCode/productName/modelCode/groupId（source 不可改）；
 * - listingStatus 状态变更走 POST /products/:id/status，不在编辑体内提交。
 *
 * 五态：加载/编辑表单/空态/拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { ProductGroup, ProductSource } from '../../../../api/ipd/product';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Input,
  Select,
  Space,
  Spin,
  message as antMessage,
} from 'ant-design-vue';

import {
  createProduct,
  getProduct,
  listProductGroups,
  updateProduct,
} from '../../../../api/ipd/product';
import { IpdRequestError } from '../../../../api/ipd/auth';

type Phase = 'error' | 'form' | 'loading';

const route = useRoute();
const router = useRouter();

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}
const isTransportError = (cause: unknown): boolean =>
  cause instanceof IpdRequestError && cause.kind === 'transport';

const phase = ref<Phase>('loading');
const offline = ref(false);
const errorMsg = ref('');
const saving = ref(false);

const editingId = computed(() => {
  const raw = route.params.productId;
  return typeof raw === 'string' && raw ? raw : '';
});
const isEdit = computed(() => Boolean(editingId.value));

const sourceOptions: { label: string; value: ProductSource }[] = [
  { label: 'PM 新增（在研）', value: 'PM_NEW' },
  { label: '超管导入（在售）', value: 'ADMIN_IMPORT' },
];
const groups = ref<ProductGroup[]>([]);
const groupOptions = computed(() => [
  { label: '待选择', value: '' },
  ...groups.value.map((g) => ({ label: g.groupName, value: g.id })),
]);

const form = reactive({
  groupId: '' as string,
  modelCode: '',
  productCode: '',
  productName: '',
  source: 'PM_NEW' as ProductSource,
});
const formRef = ref();
const rules = {
  groupId: [{ required: false, message: '请选择产品组' }],
  modelCode: [
    { required: true, whitespace: true, message: '请输入在售型号编码' },
    { max: 64, message: '型号编码不能超过 64 个字符' },
  ],
  productCode: [
    { required: true, whitespace: true, message: '请输入产品编码' },
    { max: 64, message: '产品编码不能超过 64 个字符' },
  ],
  productName: [
    { required: true, whitespace: true, message: '请输入产品名称' },
    { max: 128, message: '产品名称不能超过 128 个字符' },
  ],
  source: [{ required: true, message: '请选择产品来源' }],
};

async function loadForm() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    groups.value = await listProductGroups();
    if (isEdit.value) {
      const detail = await getProduct(editingId.value);
      form.productCode = detail.productCode;
      form.productName = detail.productName;
      form.modelCode = detail.modelCode ?? '';
      form.groupId = detail.groupId ?? '';
      form.source = (detail.source as ProductSource) || 'PM_NEW';
    }
    phase.value = 'form';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(loadForm);

async function onSave() {
  if (saving.value) return;
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  saving.value = true;
  const payload = {
    productCode: form.productCode.trim(),
    productName: form.productName.trim(),
    modelCode: form.modelCode.trim(),
    groupId: form.groupId ? form.groupId : null,
    source: form.source,
  };
  try {
    if (isEdit.value) {
      await updateProduct(editingId.value, {
        productCode: payload.productCode,
        productName: payload.productName,
        modelCode: payload.modelCode,
        groupId: payload.groupId,
      });
      antMessage.success('产品档案已更新');
    } else {
      await createProduct(payload);
      antMessage.success('产品已创建');
    }
    router.push('/ipd/products');
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    saving.value = false;
  }
}

function goBack() {
  router.push('/ipd/products');
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Card>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Space align="center">
          <Button @click="goBack">返回产品目录</Button>
          <span class="text-lg font-semibold">
            {{ isEdit ? '编辑产品档案' : '新增产品' }}
          </span>
          <span class="text-muted-foreground text-sm">
            产品档案独立于项目长期存在；编码一旦创建不可修改。
          </span>
        </Space>
      </div>
    </Card>

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin :tip="isEdit ? '正在加载产品档案' : '正在加载产品组'" />
    </Card>

    <Alert
      v-else-if="phase === 'error'"
      :message="errorMsg"
      show-icon
      type="error"
      role="alert"
    >
      <template v-if="offline" #action>
        <Button danger size="small" @click="loadForm">重新加载</Button>
      </template>
    </Alert>

    <Card v-else>
      <Alert
        class="mb-4"
        :message="isEdit
          ? '产品来源在创建后不可修改；状态变更请回到列表使用「启用/停用」按钮。'
          : '新增仅超级管理员可选择超管导入；PM 新增会在保存后默认进入在研状态。'"
        show-icon
        type="info"
      />
      <Form
        ref="formRef"
        :label-col="{ span: 5 }"
        :model="form"
        :rules="rules"
        :wrapper-col="{ span: 16 }"
        layout="horizontal"
      >
        <FormItem :required="true" label="产品编码" name="productCode">
          <Input
            v-model:value="form.productCode"
            :disabled="isEdit"
            :maxlength="64"
            placeholder="如 PD-1001"
          />
        </FormItem>
        <FormItem label="产品名称" name="productName">
          <Input v-model:value="form.productName" :maxlength="128" placeholder="如 智能门锁 X1" />
        </FormItem>
        <FormItem label="在售型号编码" name="modelCode">
          <Input
            v-model:value="form.modelCode"
            :maxlength="64"
            placeholder="超管导入必填；PM 新增可留空"
          />
        </FormItem>
        <FormItem label="归属产品组" name="groupId">
          <Select
            v-model:value="form.groupId"
            :options="groupOptions"
            placeholder="选择产品组（可选）"
          />
        </FormItem>
        <FormItem v-if="!isEdit" label="产品来源" name="source">
          <Select
            v-model:value="form.source"
            :options="sourceOptions"
            placeholder="选择来源"
          />
        </FormItem>
        <FormItem :wrapper-col="{ offset: 5, span: 16 }">
          <Space>
            <Button
              :loading="saving"
              html-type="submit"
              type="primary"
              @click="onSave"
            >
              {{ isEdit ? '保存修改' : '创建产品' }}
            </Button>
            <Button @click="goBack">取消</Button>
          </Space>
        </FormItem>
      </Form>
    </Card>
  </div>
</template>