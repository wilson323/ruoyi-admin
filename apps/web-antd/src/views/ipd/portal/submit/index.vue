<script setup lang="ts">
// 卡片 P0-10.38：需求门户-游客提交（免登录顶层页，不套后台布局）。
// 五态：成功（查询码大字展示）/ 拒绝（业务码中文文案）/ 空态（产品列表空，仅「其他/未找到」）/ 加载 / 断网。
import type { PortalProduct } from '../../../../api/ipd/portal';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Button, Form, Input, Select, Upload } from 'ant-design-vue';
import { CheckCircleFilled } from '@ant-design/icons-vue';

import { fetchPortalProducts, submitPortalDemand } from '../../../../api/ipd/portal';
import PortalShell from '../portal-shell.vue';
import '../../_shared/ipd-theme.css';

const router = useRouter();
const form = reactive({
  contact: '',
  customerName: '',
  feedbackPerson: '',
  functionalRequirement: '',
  /** 选中的三情形：'OTHER'=其他/未找到（提交 productId=null）；否则为产品 ID（字符串）；''=未选。 */
  productChoice: '',
  /** 规格字段模型：rawModel 仅在第③类（其他/未找到）可空。 */
  rawModel: '',
  /** 蜜罐字段：对人不渲染为可见控件，非空即判定为机器人（页38 用例4）。 */
  website: '',
});
/** 附件列表（占位）。ZK-IPD 设计稿要求：≤5 份、单份 ≤20MB、支持图片/Word/Excel/PPT/PDF/常见视频。 */
const attachments = ref<Array<{ name: string; size: number; uid: string }>>([]);
/** 附件单份 20MB 上限（ZK-IPD 设计稿规定）。 */
const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024;
/** 附件允许类型（与 ZK-IPD 一致）。 */
const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp4,.mov,.avi,.mkv';
/** 附件最多 5 份。 */
const ATTACHMENT_MAX_COUNT = 5;
const products = ref<PortalProduct[]>([]);
const productsBusy = ref(false);
/** 产品列表加载失败/为空时置位：表单不阻断，降级为仅「其他/未找到」+ 手动填型号。 */
const productsDegraded = ref(false);
/** 三情形分组（BR-REQ-02b：在售/在研/其他）。 */
const productOptions = computed(() => [
  {
    options: products.value
      .filter((item) => item.listingStatus === 'ON_SALE')
      .map((item) => ({
        label: item.modelCode ? `${item.modelCode}（${item.productName}）` : item.productName,
        value: item.id,
      })),
    label: '在售产品',
  },
  {
    options: products.value
      .filter((item) => item.listingStatus === 'IN_DEV')
      .map((item) => ({
        label: item.modelCode ? `${item.modelCode}「在研」` : `${item.productName}「在研」`,
        value: item.id,
      })),
    label: '在研产品',
  },
  {
    options: [{ label: '其他/未找到', value: 'OTHER' }],
    label: '其他',
  },
]);
const submitting = ref(false);
const errorText = ref('');
/** 非空 = 提交成功，整卡切换为成功态（不再显示表单）。 */
const result = ref<null | { code: string; status: string }>(null);
const copied = ref(false);

/** 规格字段模型：rawModel 仅在第③类（其他/未找到）可空，其余情形必填。 */
const rawModelRequired = computed(() => form.productChoice !== '' && form.productChoice !== 'OTHER');
const rawModelRules = computed(() => [
  { message: '请输入产品型号', required: rawModelRequired.value, whitespace: true },
  { max: 64, message: '产品型号不能超过 64 个字符' },
]);

onMounted(() => {
  void loadProducts();
});

/** 产品选择源加载失败不阻断提交：降级为仅「其他/未找到」+ 手动填型号（G-06：不造假数据）。 */
async function loadProducts() {
  productsBusy.value = true;
  productsDegraded.value = false;
  try {
    products.value = await fetchPortalProducts();
    productsDegraded.value = products.value.length === 0;
  } catch {
    products.value = [];
    productsDegraded.value = true;
  } finally {
    productsBusy.value = false;
  }
}

function onProductChange() {
  const picked = products.value.find((item) => item.id === form.productChoice);
  if (picked) {
    form.rawModel = picked.modelCode ?? picked.productName;
  }
  if (form.productChoice === 'OTHER') {
    form.rawModel = '';
  }
}

async function submitDemand() {
  if (submitting.value) return;
  submitting.value = true;
  errorText.value = '';
  copied.value = false;
  try {
    result.value = await submitPortalDemand({
      contact: form.contact.trim() || undefined,
      customerName: form.customerName.trim(),
      feedbackPerson: form.feedbackPerson.trim(),
      functionalRequirement: form.functionalRequirement.trim(),
      productId: form.productChoice && form.productChoice !== 'OTHER' ? form.productChoice : null,
      rawModel: form.rawModel.trim() || null,
      website: form.website,
    });
  } catch (cause) {
    errorText.value = cause instanceof Error ? cause.message : '提交失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

function resetForAnother() {
  result.value = null;
  errorText.value = '';
  copied.value = false;
  form.contact = '';
  form.customerName = '';
  form.feedbackPerson = '';
  form.functionalRequirement = '';
  form.rawModel = '';
  form.website = '';
  form.productChoice = '';
  attachments.value = [];
  void loadProducts();
}

/**
 * 附件上传前校验：单份 ≤20MB、总数 ≤5（ZK-IPD 设计稿规定）。
 * 当前仅做前端占位与格式校验；multipart 实际上传由后端聚合接口 P-3 接入。
 */
function handleBeforeUpload(file: File): boolean {
  if (attachments.value.length >= ATTACHMENT_MAX_COUNT) {
    errorText.value = `附件最多 ${ATTACHMENT_MAX_COUNT} 份，已满`;
    return false;
  }
  if (file.size > ATTACHMENT_MAX_SIZE) {
    errorText.value = `${file.name} 超过 20MB，无法上传`;
    return false;
  }
  errorText.value = '';
  attachments.value.push({ name: file.name, size: file.size, uid: `${file.name}-${file.size}` });
  return false; // 阻止 ant 自动上传；后端 P-3 接入后改为 true
}

async function copyCode() {
  const code = result.value?.code ?? '';
  try {
    await navigator.clipboard.writeText(code);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <PortalShell>
    <h1 class="mb-2 text-xl font-semibold" data-testid="portal-submit-title">提交产品需求</h1>
    <p class="mb-6 text-sm text-[#909399]">无需注册或登录。提交成功后请保存 8 位查询码，凭查询码可随时查询处理进度。</p>

    <!-- 成功态：查询码大字展示（规格 §2：≥28px + 复制按钮 + 保存提示） -->
    <div v-if="result" class="flex flex-col items-center py-4 text-center" data-testid="portal-submit-success">
      <CheckCircleFilled class="mb-4 text-5xl text-[#57D188]" />
      <h2 class="mb-2 text-lg font-semibold">提交成功</h2>
      <p class="mb-4 text-sm text-[#606266]">请保存好以下 8 位查询码，它是查询进度的唯一凭据。</p>
      <div class="mb-3 rounded-lg bg-[#F5F7FA] px-8 py-4">
        <span class="font-mono text-[32px] font-semibold tracking-[0.2em] text-[#006BE6]" data-testid="portal-code">{{ result.code }}</span>
        <Button type="link" data-testid="portal-code-copy" @click="copyCode">复制</Button>
        <span v-if="copied" class="ml-1 text-xs text-[#57D188]" data-testid="portal-code-copied">已复制</span>
      </div>
      <Alert class="mb-3 w-full" type="warning" show-icon
        message="请截图或抄写保存查询码，离开本页后系统不再展示此码。" />
      <Alert v-if="result.status === 'SUBMITTED'" class="mb-3 w-full" type="info" show-icon
        message="需求已进入待受理队列，工作人员会尽快处理。" />
      <div class="mt-2 flex gap-3">
        <Button data-testid="portal-goto-track" @click="router.push(`/portal/track?code=${result.code}`)">前往查询进度</Button>
        <Button type="primary" @click="resetForAnother">再提交一条</Button>
      </div>
    </div>

    <!-- 表单态：v-show 而非 v-else 卸载——提交成功后允许「再提交一条」复用，且保持表单实例 -->
    <div v-show="!result">
      <Form :model="form" layout="vertical" @finish="submitDemand">
      <Alert v-if="errorText" class="mb-4" type="error" show-icon :message="errorText" role="alert" data-testid="portal-submit-error" />
      <Alert v-if="productsDegraded" class="mb-4" type="warning" show-icon
        message="产品列表暂时无法获取，可选择「其他/未找到」并手动填写产品型号后提交。" data-testid="portal-products-degraded" />
      <Form.Item label="客户名称" name="customerName"
        :rules="[{ required: true, whitespace: true, message: '请输入客户名称' }, { min: 2, message: '客户名称至少 2 个字' }, { max: 120, message: '客户名称不能超过 120 个字' }]">
        <Input v-model:value="form.customerName" :maxlength="120" :disabled="submitting" placeholder="请输入您的企业名称" />
      </Form.Item>
      <Form.Item label="反馈人" name="feedbackPerson"
        :rules="[{ required: true, whitespace: true, message: '请输入反馈人姓名' }, { min: 2, message: '反馈人至少 2 个字' }, { max: 80, message: '反馈人不能超过 80 个字' }]">
        <Input v-model:value="form.feedbackPerson" :maxlength="80" :disabled="submitting" placeholder="请输入您的姓名" />
      </Form.Item>
      <Form.Item label="联系方式（选填）" name="contact" :rules="[{ max: 128, message: '联系方式不能超过 128 个字' }]">
        <Input v-model:value="form.contact" :maxlength="128" :disabled="submitting" placeholder="电话或邮箱，便于我们与您确认需求" />
      </Form.Item>
      <Form.Item label="产品情形" name="productChoice" :rules="[{ required: true, message: '请选择产品情形' }]">
        <Select v-model:value="form.productChoice" :options="productOptions" :loading="productsBusy" :disabled="submitting"
          placeholder="请选择在售 / 在研产品，未找到请选「其他/未找到」" data-testid="portal-product-select" @change="onProductChange" />
      </Form.Item>
      <Form.Item label="产品型号" name="rawModel" :rules="rawModelRules">
        <Input v-model:value="form.rawModel" :maxlength="64" :disabled="submitting || form.productChoice === 'OTHER'"
          placeholder="选择产品后自动带入，可修改；选「其他/未找到」可留空" />
      </Form.Item>
      <Form.Item label="功能需求描述" name="functionalRequirement"
        :rules="[{ required: true, whitespace: true, message: '请描述功能需求' }, { min: 6, message: '功能需求至少 6 个字' }, { max: 4000, message: '功能需求不能超过 4000 个字' }]">
        <Input.TextArea v-model:value="form.functionalRequirement" :maxlength="4000" show-count :rows="6" :disabled="submitting"
          placeholder="至少 6 个字，请描述使用场景与期望功能" />
      </Form.Item>
      <!-- 附件上传（ZK-IPD 设计稿：≤5 份、单份 ≤20MB；后端聚合上传待 P-3 交付） -->
      <Form.Item label="附件（可选）" name="attachments" extra="支持图片、Word、Excel、PPT、PDF 和常见视频；最多 5 份、单份不超过 20MB。">
        <Upload.Dragger
          :multiple="true"
          :max-count="5"
          :accept="ATTACHMENT_ACCEPT"
          :before-upload="(file) => handleBeforeUpload(file)"
          :file-list="attachments"
          :disabled="submitting"
          list-type="text"
          data-testid="portal-attachment-upload"
        >
          <p class="ant-upload-drag-icon">📎</p>
          <p class="ant-upload-text">点击选择或拖入附件</p>
          <p class="ant-upload-hint text-xs text-[#909399]">支持 .png / .jpg / .webp / .pdf / .doc / .docx / .xls / .xlsx / .ppt / .pptx / .mp4 等</p>
        </Upload.Dragger>
        <div v-if="attachments.length > 0" class="mt-2 text-xs text-[#606266]">
          已选择 {{ attachments.length }}/5 份附件
          <span class="ml-2 text-[#909399]">（提交后跟随需求进入产品需求池）</span>
        </div>
      </Form.Item>
      <!-- 蜜罐字段：对人不渲染为可见控件（tabindex=-1 且移出屏幕），非空即被服务端拒绝并记审计 spam_rejected -->
      <div class="absolute -left-[9999px] top-0" aria-hidden="true">
        <label>Website<input v-model="form.website" type="text" tabindex="-1" autocomplete="off" /></label>
      </div>
      <Button block type="primary" html-type="submit" size="large" :loading="submitting" data-testid="portal-submit-button">提交需求</Button>
      </Form>
    </div>
  </PortalShell>
</template>
