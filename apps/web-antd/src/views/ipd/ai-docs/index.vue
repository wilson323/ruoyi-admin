<script setup lang="ts">
/**
 * 页42 AI 文档助手（独立页）。
 *
 * 按 AiDocumentController（P1-10.1）已交付端点实现版本链管理闭环：
 * 选择项目/文档类型 → 登记 AI 输出 v1 → 人工审核 → 版本对比。
 * 未交付（页内提示，G-06）：AI 模型生成 / 模型配置 / 预算（P4-2）；按项目列出文档的读端点。
 * 人工改版入口在页14（项目详情-文档与交付物）。
 */
import { computed, onMounted, reactive, ref, type Ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Textarea,
  message,
} from 'ant-design-vue';

import { PENDING_TEXT } from '../_shared/format';
import {
  type AiDocument,
  ipdApiErrorText,
  listAiDocumentVersions,
  registerAiDocument,
  reviewAiDocumentVersion,
} from '../../../api/ipd/ai-document';
import { ipdGet } from '../../../api/ipd/http';

interface ProjectOption {
  code: null | string;
  id: string;
  name: null | string;
}

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

// ---------- 项目与类型 ----------
const projects = ref<ProjectOption[]>([]);
const projectsLoading = ref(false);
const projectsError = ref<null | string>(null);
const selectedProjectId = ref<null | string>(
  typeof route.query.projectId === 'string' && /^\d+$/.test(route.query.projectId) ? route.query.projectId : null,
);
const selectedDocType = ref<string>('PRD');

/** Select 不收 null：与 selectedProjectId/compareLeftId/compareRightId（null|string）双向适配。 */
function selectModel(source: Ref<null | string>) {
  return computed<number | string | undefined>({
    get: () => source.value ?? undefined,
    set: (value) => {
      source.value = typeof value === 'string' ? value : null;
    },
  });
}
const selectedProjectIdModel = selectModel(selectedProjectId);

/** InputNumber 不收 null：与 tokenPrompt/tokenCompletion（null|number）双向适配。 */
function tokenModel(key: 'tokenCompletion' | 'tokenPrompt') {
  return computed<number | string | undefined>({
    get: () => (registerForm[key] == null ? undefined : registerForm[key]),
    set: (value) => {
      registerForm[key] = value == null || value === '' ? null : Number(value);
    },
  });
}

function parseProjects(data: unknown): ProjectOption[] {
  if (!Array.isArray(data)) throw new Error('项目列表数据格式异常');
  return data.map((item) => {
    const record = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    if (!/^\d+$/.test(String(record.id ?? ''))) throw new Error('项目列表数据格式异常');
    return {
      code: typeof record.code === 'string' ? record.code : null,
      id: String(record.id),
      name: typeof record.name === 'string' ? record.name : null,
    };
  });
}

async function loadProjects() {
  projectsLoading.value = true;
  projectsError.value = null;
  try {
    projects.value = parseProjects(await ipdGet<unknown>('/projects'));
  } catch (cause) {
    projects.value = [];
    projectsError.value = ipdApiErrorText(cause, '项目列表加载失败，请稍后重试');
  } finally {
    projectsLoading.value = false;
  }
}

const projectOptions = computed(() =>
  projects.value.map((project) => ({
    label: project.name ? `${project.name}（${project.code || PENDING_TEXT}）` : `项目 ${project.id}`,
    value: project.id,
  })),
);

// ---------- 登记 AI 输出 v1 ----------
const registerForm = reactive({
  content: '',
  model: '',
  title: '',
  tokenCompletion: null as null | number,
  tokenPrompt: null as null | number,
});
const tokenPromptModel = tokenModel('tokenPrompt');
const tokenCompletionModel = tokenModel('tokenCompletion');
const registerSubmitting = ref(false);
const registerError = ref<null | string>(null);
const registerResult = ref<null | AiDocument>(null);

async function submitRegister() {
  if (!selectedProjectId.value) {
    registerError.value = '请先在上方选择项目。';
    return;
  }
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
      docType: selectedDocType.value || null,
      model: registerForm.model.trim() || null,
      projectId: selectedProjectId.value,
      title: registerForm.title.trim(),
      tokenCompletion: registerForm.tokenCompletion,
      tokenPrompt: registerForm.tokenPrompt,
    });
    message.success('AI 输出已登记为版本链首版（v1）');
    docIdInput.value = registerResult.value.id;
    await loadChain(registerResult.value.id);
  } catch (cause) {
    registerResult.value = null;
    registerError.value = ipdApiErrorText(cause);
  } finally {
    registerSubmitting.value = false;
  }
}

// ---------- 版本链与人工审核 ----------
const docIdInput = ref('');
const chain = ref<AiDocument[]>([]);
const chainLoading = ref(false);
const chainError = ref<null | string>(null);
const chainLoaded = ref(false);
const reviewingVersionId = ref<null | string>(null);

const head = computed(() => (chain.value.length > 0 ? chain.value[chain.value.length - 1] : null));

function statusMeta(status: string) {
  return STATUS_META[status] ?? { color: 'processing', text: status };
}

function docTypeText(doc: AiDocument): string {
  if (!doc.docType) return PENDING_TEXT;
  return DOC_TYPE_TEXTS[doc.docType] ?? doc.docType;
}

async function loadChain(documentId: string) {
  const id = documentId.trim();
  if (!/^\d+$/.test(id)) {
    chainError.value = '请输入正确的文档 ID（纯数字）。';
    return;
  }
  chainLoading.value = true;
  chainError.value = null;
  try {
    chain.value = await listAiDocumentVersions(id);
    chainLoaded.value = true;
    // 对比区默认：v1 ↔ 最新版
    compareLeftId.value = chain.value[0]?.id ?? null;
    compareRightId.value = head.value?.id ?? null;
  } catch (cause) {
    chain.value = [];
    chainLoaded.value = true;
    chainError.value = ipdApiErrorText(cause, '版本链加载失败，请稍后重试');
  } finally {
    chainLoading.value = false;
  }
}

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

// ---------- 版本对比 ----------
const compareLeftId = ref<null | string>(null);
const compareRightId = ref<null | string>(null);
const compareLeftIdModel = selectModel(compareLeftId);
const compareRightIdModel = selectModel(compareRightId);

const versionOptions = computed(() =>
  chain.value.map((doc) => ({ label: `v${doc.versionNo} · ${doc.title}`, value: doc.id })),
);

const compareLeft = computed(() => chain.value.find((doc) => doc.id === compareLeftId.value) ?? null);
const compareRight = computed(() => chain.value.find((doc) => doc.id === compareRightId.value) ?? null);
const sameContent = computed(
  () =>
    compareLeft.value !== null &&
    compareRight.value !== null &&
    compareLeft.value.contentSha256 !== null &&
    compareLeft.value.contentSha256 === compareRight.value.contentSha256,
);

onMounted(() => {
  void loadProjects();
});
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="AI 模型生成、模型配置与预算控制（P4-2）尚未交付；当前页覆盖版本链闭环：登记 AI 输出 → 人工审核 → 版本对比。"
      show-icon
      type="info"
    />

    <!-- ① 选择项目与文档类型 -->
    <Card title="选择项目与文档类型">
      <Alert v-if="projectsError" class="mb-3" show-icon type="error" role="alert" :message="projectsError">
        <template #action>
          <Button size="small" @click="loadProjects">重新加载</Button>
        </template>
      </Alert>
      <div v-if="projectsLoading" class="py-4 text-center">
        <Spin tip="正在加载项目列表……" />
      </div>
      <Empty
        v-else-if="projects.length === 0"
        description="暂无可选项目。请确认账号可见项目范围后重试。"
      />
      <Form v-else layout="inline">
        <FormItem label="项目">
          <Select
            v-model:value="selectedProjectIdModel"
            :options="projectOptions"
            placeholder="请选择项目"
            show-search
            option-filter-prop="label"
            style="width: 320px"
          />
        </FormItem>
        <FormItem label="文档类型">
          <Select v-model:value="selectedDocType" :options="DOC_TYPE_OPTIONS" style="width: 220px" />
        </FormItem>
      </Form>
    </Card>

    <!-- ② 登记 AI 输出 v1 -->
    <Card title="登记 AI 输出（版本链 v1 锚点）">
      <Form layout="horizontal" :label-col="{ style: { width: '110px' } }">
        <FormItem label="文档标题" required>
          <Input v-model:value="registerForm.title" :maxlength="200" placeholder="请输入文档标题" show-count />
        </FormItem>
        <FormItem label="文档内容" required>
          <Textarea v-model:value="registerForm.content" :rows="6" placeholder="粘贴 AI 原始输出内容" />
        </FormItem>
        <FormItem label="生成模型">
          <Input v-model:value="registerForm.model" :maxlength="64" placeholder="选填，如 deepseek-chat" />
        </FormItem>
        <FormItem label="Token 消耗">
          <Space>
            <InputNumber v-model:value="tokenPromptModel" :min="0" :precision="0" placeholder="提示词" />
            <InputNumber v-model:value="tokenCompletionModel" :min="0" :precision="0" placeholder="补全" />
          </Space>
        </FormItem>
        <FormItem label=" " :colon="false">
          <Button :loading="registerSubmitting" type="primary" @click="submitRegister">登记 AI 输出</Button>
        </FormItem>
      </Form>
      <Alert v-if="registerError" class="mt-2" show-icon type="error" role="alert" :message="registerError" />
      <Alert v-if="registerResult" class="mt-2" show-icon type="success">
        <template #message>已登记 v{{ registerResult.versionNo }}：{{ registerResult.title }}</template>
        <template #description>文档 ID：{{ registerResult.id }}；版本链已在下方加载。</template>
      </Alert>
    </Card>

    <!-- ③ 版本链与人工审核 -->
    <Card title="版本链与人工审核">
      <Space compact class="mb-4">
        <Input
          v-model:value="docIdInput"
          style="width: 280px"
          placeholder="输入文档 ID 加载版本链"
          @press-enter="loadChain(docIdInput)"
        />
        <Button :loading="chainLoading" type="primary" @click="loadChain(docIdInput)">加载版本链</Button>
      </Space>

      <Alert v-if="chainError" class="mb-4" show-icon type="error" role="alert" :message="chainError" />

      <div v-if="chainLoading" class="py-6 text-center text-muted-foreground">正在加载版本链……</div>

      <Empty
        v-else-if="!chainLoaded"
        description="暂无版本链。请先登记 AI 输出，或输入文档 ID 加载。"
      />

      <ul v-else-if="chain.length > 0" class="m-0 list-none p-0">
        <li
          v-for="doc in chain"
          :key="doc.id"
          class="bg-muted mb-2 rounded p-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">v{{ doc.versionNo }}</span>
            <span>{{ doc.title }}</span>
            <Tag :color="statusMeta(doc.status).color">{{ statusMeta(doc.status).text }}</Tag>
            <span class="text-muted-foreground text-xs">类型：{{ docTypeText(doc) }}</span>
          </div>
          <div class="text-muted-foreground mt-1 font-mono text-xs">
            sha256：{{ doc.contentSha256 || PENDING_TEXT }}
          </div>
          <Button
            v-if="doc.status === 'GENERATED'"
            :loading="reviewingVersionId === doc.id"
            class="mt-2"
            size="small"
            type="primary"
            @click="submitReview(doc)"
          >
            审核通过
          </Button>
        </li>
      </ul>

      <Empty v-else description="该文档不存在版本数据，请确认文档 ID 是否正确。" />
    </Card>

    <!-- ④ 版本对比 -->
    <Card title="版本对比">
      <Empty
        v-if="!chainLoaded || chain.length === 0"
        description="暂无可对比的版本。请先加载版本链。"
      />
      <template v-else>
        <Space class="mb-4" wrap>
          <Select
            v-model:value="compareLeftIdModel"
            :options="versionOptions"
            placeholder="选择版本"
            style="width: 300px"
          />
          <span class="text-muted-foreground">对比</span>
          <Select
            v-model:value="compareRightIdModel"
            :options="versionOptions"
            placeholder="选择版本"
            style="width: 300px"
          />
        </Space>
        <Alert
          v-if="sameContent"
          class="mb-3"
          message="两个版本的内容摘要一致（内容相同）。"
          show-icon
          type="info"
        />
        <Row :gutter="16">
          <Col :span="12">
            <div class="bg-muted rounded p-3">
              <div class="mb-2 text-sm font-medium">
                {{ compareLeft ? `v${compareLeft.versionNo} · ${compareLeft.title}` : PENDING_TEXT }}
                <Tag v-if="compareLeft" :color="statusMeta(compareLeft.status).color">
                  {{ statusMeta(compareLeft.status).text }}
                </Tag>
              </div>
              <pre class="max-h-80 overflow-auto text-xs whitespace-pre-wrap">{{ compareLeft?.content || PENDING_TEXT }}</pre>
            </div>
          </Col>
          <Col :span="12">
            <div class="bg-muted rounded p-3">
              <div class="mb-2 text-sm font-medium">
                {{ compareRight ? `v${compareRight.versionNo} · ${compareRight.title}` : PENDING_TEXT }}
                <Tag v-if="compareRight" :color="statusMeta(compareRight.status).color">
                  {{ statusMeta(compareRight.status).text }}
                </Tag>
              </div>
              <pre class="max-h-80 overflow-auto text-xs whitespace-pre-wrap">{{ compareRight?.content || PENDING_TEXT }}</pre>
            </div>
          </Col>
        </Row>
      </template>
    </Card>
  </div>
</template>
