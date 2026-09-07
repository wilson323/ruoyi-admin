<script setup lang="ts">
/**
 * 页14 项目详情-文档与交付物（看板卡 P0-10.14）。
 *
 * 已交付端点（P1-10.1，AiDocumentController）：
 * - POST /api/v1/ai-documents            登记 AI 原始输出 v1（版本链首环）
 * - GET  /api/v1/ai-documents/{id}/versions  完整版本链
 * - POST /api/v1/ai-documents/{id}/revise    人工改版（baseVersionId HEAD 校验，非最新即 409）
 * - POST /api/v1/ai-documents/{id}/versions/{versionId}/review  人工审核通过
 * 未交付：按项目列出文档的 GET 端点 → 列表区挂占位（G-06 不展示任何模拟数据）。
 */
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Textarea,
  Timeline,
  TimelineItem,
  Tooltip,
  message,
} from 'ant-design-vue';

import { PENDING_TEXT } from '../../_shared/format';
import {
  type AiDocument,
  ipdApiErrorText,
  listAiDocumentVersions,
  registerAiDocument,
  reviewAiDocumentVersion,
  reviseAiDocument,
} from '../../../../api/ipd/ai-document';
import { IpdRequestError } from '../../../../api/ipd/auth';

const DOC_TYPE_OPTIONS = [
  { label: '市场需求文档（MRD）', value: 'MRD' },
  { label: '商业需求文档（BRD）', value: 'BRD' },
  { label: '产品需求文档（PRD）', value: 'PRD' },
  { label: '产品 Charter', value: 'CHARTER' },
  { label: '测试验证报告', value: 'TEST_REPORT' },
  { label: '发布说明', value: 'RELEASE_NOTE' },
  { label: '评审材料', value: 'REVIEW' },
  { label: '其他', value: 'OTHER' },
];

const DOC_TYPE_TEXTS: Record<string, string> = Object.fromEntries(
  DOC_TYPE_OPTIONS.map((option) => [option.value, option.label]),
);

const STATUS_META: Record<string, { color: string; text: string }> = {
  ARCHIVED: { color: 'default', text: '已归档' },
  GENERATED: { color: 'warning', text: '待审核' },
  REVIEWED: { color: 'success', text: '已审核' },
};

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));

// ---------- 登记 AI 输出 v1 ----------
const registerForm = reactive({
  content: '',
  docType: 'PRD',
  model: '',
  title: '',
  tokenCompletion: null as null | number,
  tokenPrompt: null as null | number,
});
const registerSubmitting = ref(false);
const registerError = ref<null | string>(null);
const registerResult = ref<null | AiDocument>(null);

/** InputNumber 不收 null：与 tokenPrompt/tokenCompletion（null|number）双向适配。 */
function tokenModel(key: 'tokenCompletion' | 'tokenPrompt') {
  return computed<number | string | undefined>({
    get: () => (registerForm[key] == null ? undefined : registerForm[key]),
    set: (value) => {
      registerForm[key] = value == null || value === '' ? null : Number(value);
    },
  });
}
const tokenPromptModel = tokenModel('tokenPrompt');
const tokenCompletionModel = tokenModel('tokenCompletion');

async function submitRegister() {
  if (!registerForm.title.trim() || registerForm.title.length > 200) {
    registerError.value = '请填写文档标题（不超过 200 字）。';
    return;
  }
  if (!registerForm.content.trim()) {
    registerError.value = '请填写文档内容。';
    return;
  }
  registerSubmitting.value = true;
  registerError.value = null;
  try {
    registerResult.value = await registerAiDocument({
      content: registerForm.content,
      docType: registerForm.docType || null,
      model: registerForm.model.trim() || null,
      projectId: projectId.value,
      title: registerForm.title.trim(),
      tokenCompletion: registerForm.tokenCompletion,
      tokenPrompt: registerForm.tokenPrompt,
    });
    message.success('AI 输出已登记为版本链首版（v1）');
  } catch (cause) {
    registerResult.value = null;
    registerError.value = ipdApiErrorText(cause);
  } finally {
    registerSubmitting.value = false;
  }
}

// ---------- 版本链 ----------
const docIdInput = ref('');
const chain = ref<AiDocument[]>([]);
const chainLoading = ref(false);
const chainError = ref<null | string>(null);
const chainLoaded = ref(false);

const head = computed(() => (chain.value.length > 0 ? chain.value[chain.value.length - 1] : null));

function statusMeta(status: string) {
  return STATUS_META[status] ?? { color: 'processing', text: status };
}

function docTypeText(doc: AiDocument): string {
  if (!doc.docType) return PENDING_TEXT;
  return DOC_TYPE_TEXTS[doc.docType] ?? doc.docType;
}

function shortSha(doc: AiDocument): string {
  return doc.contentSha256 ? `${doc.contentSha256.slice(0, 12)}…` : PENDING_TEXT;
}

async function loadChain(documentId: string) {
  const id = documentId.trim();
  if (!/^\d+$/.test(id)) {
    chainLoaded.value = false;
    chainError.value = '请输入正确的文档 ID（纯数字）。';
    return;
  }
  chainLoading.value = true;
  chainError.value = null;
  try {
    chain.value = await listAiDocumentVersions(id);
    chainLoaded.value = true;
  } catch (cause) {
    chain.value = [];
    chainLoaded.value = true;
    chainError.value = ipdApiErrorText(cause, '版本链加载失败，请稍后重试');
  } finally {
    chainLoading.value = false;
  }
}

function viewChainOfRegistered() {
  if (registerResult.value) void loadChain(registerResult.value.id);
}

// ---------- 人工审核 ----------
const reviewingVersionId = ref<null | string>(null);

async function submitReview(doc: AiDocument) {
  if (reviewingVersionId.value) return;
  reviewingVersionId.value = doc.id;
  try {
    await reviewAiDocumentVersion(doc.id, doc.id);
    message.success(`v${doc.versionNo} 已审核通过`);
    const anchorId = doc.parentVersionId ?? doc.id;
    await loadChain(anchorId);
  } catch (cause) {
    message.error(ipdApiErrorText(cause));
  } finally {
    reviewingVersionId.value = null;
  }
}

// ---------- 人工改版（HEAD 校验） ----------
const reviseOpen = ref(false);
const reviseSubmitting = ref(false);
const reviseError = ref<null | string>(null);
const reviseForm = reactive({ content: '', title: '' });

function openRevise() {
  if (!head.value) return;
  reviseForm.content = '';
  reviseForm.title = head.value.title;
  reviseError.value = null;
  reviseOpen.value = true;
}

async function submitRevise() {
  if (!head.value) return;
  if (!reviseForm.content.trim()) {
    reviseError.value = '请填写改版内容。';
    return;
  }
  reviseSubmitting.value = true;
  reviseError.value = null;
  try {
    const next = await reviseAiDocument(head.value.id, {
      baseVersionId: head.value.id,
      content: reviseForm.content,
      title: reviseForm.title.trim() || null,
    });
    reviseOpen.value = false;
    message.success(`人工改版已生成 v${next.versionNo}，原版本保留`);
    await loadChain(next.id);
  } catch (cause) {
    // 人工改版 HEAD 校验：基准非当前最新版（并发改版）→ 409 50002，给出专属文案并自动刷新链
    if (cause instanceof IpdRequestError && cause.code === 50002) {
      reviseError.value = '基准版本已不是当前最新版（可能已被其他成员改版），请确认后重新提交。';
      reviseOpen.value = false;
      if (head.value) await loadChain(head.value.id);
      return;
    }
    reviseError.value = ipdApiErrorText(cause);
  } finally {
    reviseSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 文档列表：读端点未交付，占位（G-06） -->
    <Card>
      <Alert
        message="文档列表接口尚未交付"
        show-icon
        type="info"
      >
        <template #description>
          <p>看板卡：P0-10.14；后端依赖：按项目列出 AI 文档的 GET 端点（/api/v1/ai-documents?projectId=）未交付。</p>
          <p>接口交付前本区不展示任何模拟数据；以下版本链操作基于已交付的 P1-10.1 端点。</p>
        </template>
      </Alert>
    </Card>

    <!-- 登记 AI 输出 v1 -->
    <Card title="登记 AI 输出（版本链 v1 锚点）">
      <Alert
        class="mb-4"
        message="AI 模型生成（P4-2）尚未交付；当前可在此登记已获得的 AI 原始输出，作为不可丢失版本链的 v1 锚点。"
        show-icon
        type="info"
      />
      <Form layout="horizontal" :label-col="{ style: { width: '120px' } }">
        <FormItem label="文档标题" required>
          <Input
            v-model:value="registerForm.title"
            :maxlength="200"
            placeholder="请输入文档标题"
            show-count
          />
        </FormItem>
        <FormItem label="文档类型">
          <Select v-model:value="registerForm.docType" :options="DOC_TYPE_OPTIONS" placeholder="请选择文档类型" />
        </FormItem>
        <FormItem label="文档内容" required>
          <Textarea
            v-model:value="registerForm.content"
            :rows="6"
            placeholder="粘贴 AI 原始输出内容"
          />
        </FormItem>
        <FormItem label="生成模型">
          <Input v-model:value="registerForm.model" :maxlength="64" placeholder="选填，如 deepseek-chat" />
        </FormItem>
        <FormItem label="Token 消耗">
          <Space>
            <InputNumber
              v-model:value="tokenPromptModel"
              :min="0"
              :precision="0"
              placeholder="提示词"
            />
            <InputNumber
              v-model:value="tokenCompletionModel"
              :min="0"
              :precision="0"
              placeholder="补全"
            />
          </Space>
        </FormItem>
        <FormItem label=" " :colon="false">
          <Button :loading="registerSubmitting" type="primary" @click="submitRegister">登记 AI 输出</Button>
        </FormItem>
      </Form>

      <Alert
        v-if="registerError"
        class="mt-2"
        show-icon
        type="error"
        role="alert"
        :message="registerError"
      />
      <Alert v-if="registerResult" class="mt-2" show-icon type="success">
        <template #message>已登记 v{{ registerResult.versionNo }}：{{ registerResult.title }}</template>
        <template #description>
          <p>文档 ID：{{ registerResult.id }}</p>
          <p>内容摘要（sha256）：{{ registerResult.contentSha256 || PENDING_TEXT }}</p>
          <Button size="small" type="primary" @click="viewChainOfRegistered">查看该文档版本链</Button>
        </template>
      </Alert>
    </Card>

    <!-- 版本链 -->
    <Card title="版本链（v1..vN，历史版本只读）">
      <Space compact class="mb-4">
        <Input
          v-model:value="docIdInput"
          style="width: 280px"
          placeholder="输入文档 ID 查看版本链"
          @press-enter="loadChain(docIdInput)"
        />
        <Button :loading="chainLoading" type="primary" @click="loadChain(docIdInput)">加载版本链</Button>
      </Space>

      <Alert v-if="chainError" class="mb-4" show-icon type="error" role="alert" :message="chainError" />

      <div v-if="chainLoading" class="py-8 text-center text-muted-foreground">正在加载版本链……</div>

      <Empty
        v-else-if="!chainLoaded"
        description="暂无版本链。请输入文档 ID 加载，或先在上方登记 AI 输出。"
      />

      <template v-else-if="chain.length > 0">
        <Alert v-if="head" class="mb-4" show-icon type="info">
          <template #message>当前最新版：v{{ head.versionNo }}（ID {{ head.id }}）</template>
        </Alert>
        <Timeline>
          <TimelineItem
            v-for="doc in chain"
            :key="doc.id"
            :color="doc.id === head?.id ? 'blue' : 'gray'"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">v{{ doc.versionNo }}</span>
              <span>{{ doc.title }}</span>
              <Tag :color="statusMeta(doc.status).color">{{ statusMeta(doc.status).text }}</Tag>
              <Tooltip :title="doc.contentSha256 || PENDING_TEXT">
                <span class="text-muted-foreground font-mono text-xs">{{ shortSha(doc) }}</span>
              </Tooltip>
            </div>
            <div class="text-muted-foreground mt-1 text-xs">
              类型：{{ docTypeText(doc) }}
              <template v-if="doc.model"> · 模型：{{ doc.model }}</template>
              <template v-if="doc.reviewedAt"> · 审核时间：{{ doc.reviewedAt.replace('T', ' ') }}</template>
            </div>
            <details class="mt-2 text-sm">
              <summary class="text-primary cursor-pointer">查看内容</summary>
              <pre class="bg-muted mt-2 max-h-64 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">{{ doc.content }}</pre>
            </details>
            <Space class="mt-2">
              <Button
                v-if="doc.status === 'GENERATED'"
                :loading="reviewingVersionId === doc.id"
                size="small"
                type="primary"
                @click="submitReview(doc)"
              >
                审核通过
              </Button>
              <Button v-if="doc.id === head?.id" size="small" @click="openRevise">基于此版本人工改版</Button>
            </Space>
          </TimelineItem>
        </Timeline>
      </template>

      <Empty v-else description="该文档不存在版本数据，请确认文档 ID 是否正确。" />

      <Modal
        v-model:open="reviseOpen"
        :confirm-loading="reviseSubmitting"
        :title="`人工改版（基于 v${head?.versionNo ?? PENDING_TEXT}）`"
        ok-text="提交人工改版"
        cancel-text="取消"
        @ok="submitRevise"
      >
        <Alert
          class="mb-3"
          message="改版以「当前最新版」为基准（乐观锁校验）；基准过期将拒绝提交，原版本一律保留。"
          show-icon
          type="info"
        />
        <Form layout="horizontal" :label-col="{ style: { width: '90px' } }">
          <FormItem label="文档标题">
            <Input v-model:value="reviseForm.title" :maxlength="200" placeholder="留空沿用原标题" />
          </FormItem>
          <FormItem label="改版内容" required>
            <Textarea v-model:value="reviseForm.content" :rows="6" placeholder="输入修改后的完整内容" />
          </FormItem>
        </Form>
        <Alert v-if="reviseError" show-icon type="error" role="alert" :message="reviseError" />
      </Modal>
    </Card>
  </div>
</template>
