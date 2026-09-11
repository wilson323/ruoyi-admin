<script setup lang="ts">
/**
 * 页42 AI 文档助手（独立页）。
 *
 * 按 AiDocumentController（P1-10.1 + P4-2.2 + P4-2.3）已交付端点实现闭环：
 * 选择项目/文档类型 → AI 生成（原始资料 → 模型 → v1 待审核）→ 人工审核 / 拒绝 →
 * 归档 → 版本对比 / 字段级 diff。
 * 8 端点契约（docs/前端拉入派单登记-20260907.md §3.4）：generate / revise / review /
 * archive / reject / versions / history / diff。
 * BR-AI-03：AI 输出未经审核不生效；BR-AI-04：系统不做内容过滤直接透传，UI 须有风险提示。
 * 未交付（页内提示，G-06）：按项目列出文档的读端点。
 * 人工改版入口在页14（项目详情-文档与交付物）；归档走 P0-6.2 删除审核流程。
 */
import { computed, onMounted, reactive, ref, type Ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
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
  type AiDocumentDiffField,
  archiveAiDocumentVersion,
  generateAiDocument,
  getAiDocumentDiff,
  ipdApiErrorText,
  listAiDocumentVersions,
  registerAiDocument,
  rejectAiDocumentVersion,
  reviewAiDocumentVersion,
} from '../../../api/ipd/ai-document';
import { listProjects } from '../../../api/ipd/project';
import { IPD_PERMISSION_CODES } from '../_shared/ipd-permission-codes';

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
  REJECTED: { color: 'error', text: '已拒绝' },
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

async function loadProjects() {
  projectsLoading.value = true;
  projectsError.value = null;
  try {
    // 经 api 层 normalizeProject 统一解包（真机行是 {project:{...}} 包裹，2026-09-07 实证）。
    projects.value = (await listProjects()).map((project) => ({
      code: project.code,
      id: project.id,
      name: project.name || null,
    }));
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

// ---------- AI 生成（P4-2.2） ----------
const generateForm = reactive({
  prompt: '',
  title: '',
});
const generateSubmitting = ref(false);
const generateError = ref<null | string>(null);
const generateResult = ref<null | AiDocument>(null);

async function submitGenerate() {
  if (!selectedProjectId.value) {
    generateError.value = '请先在上方选择项目。';
    return;
  }
  if (!generateForm.title.trim() || generateForm.title.length > 200) {
    generateError.value = '请填写文档标题（不超过 200 字）。';
    return;
  }
  if (!generateForm.prompt.trim()) {
    generateError.value = '请填写原始资料或生成指令。';
    return;
  }
  generateSubmitting.value = true;
  generateError.value = null;
  try {
    generateResult.value = await generateAiDocument({
      docType: selectedDocType.value || null,
      projectId: selectedProjectId.value,
      prompt: generateForm.prompt,
      title: generateForm.title.trim(),
    });
    message.success('AI 生成完成，已登记为待审核版本 v1');
    docIdInput.value = generateResult.value.id;
    await loadChain(generateResult.value.id);
  } catch (cause) {
    generateResult.value = null;
    generateError.value = ipdApiErrorText(cause);
  } finally {
    generateSubmitting.value = false;
  }
}

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

// ---------- 版本链与人工审核 / 拒绝 / 归档 ----------
const docIdInput = ref('');
const chain = ref<AiDocument[]>([]);
const chainLoading = ref(false);
const chainError = ref<null | string>(null);
const chainLoaded = ref(false);
const reviewingVersionId = ref<null | string>(null);
const archivingVersionId = ref<null | string>(null);

const head = computed(() => (chain.value.length > 0 ? chain.value[chain.value.length - 1] : null));
const currentDocId = computed(() => head.value?.id ?? (chain.value[0]?.id ?? null));

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
  if (doc.status !== 'GENERATED') {
    message.warning(`v${doc.versionNo} 当前状态 ${doc.status}，无需再次审核`);
    return;
  }
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

// ---------- 拒绝 Modal（comment 必填） ----------
interface RejectDraft {
  comment: string;
  doc: AiDocument | null;
  docId: string | null;
}
const rejectModal = reactive<RejectDraft>({ comment: '', doc: null, docId: null });
const rejectModalOpen = ref(false);
const rejectSubmitting = ref(false);
const rejectFormRef = ref();
/** comment 非空才允许提交（双重保护：Form rule 报错 + 按钮 disabled 防绕过）。 */
const rejectCommentReady = computed(() => rejectModal.comment.trim().length > 0);
/** OK 按钮 disabled 计算属性：响应式传递给 Modal（inline 字面量不会被 Modal 反应式追踪）。 */
const okButtonProps = computed(() => ({ disabled: !rejectCommentReady.value }));

function openRejectModal(doc: AiDocument) {
  if (doc.status !== 'GENERATED') {
    message.warning(`v${doc.versionNo} 当前状态 ${doc.status}，无法拒绝`);
    return;
  }
  rejectModal.doc = doc;
  rejectModal.docId = doc.id;
  rejectModal.comment = '';
  rejectModalOpen.value = true;
}

async function submitReject() {
  if (!rejectModal.doc || !rejectModal.docId || !currentDocId.value) return;
  if (!rejectCommentReady.value) return;
  rejectSubmitting.value = true;
  try {
    await rejectFormRef.value?.validate();
    await rejectAiDocumentVersion(rejectModal.docId, rejectModal.docId, {
      comment: rejectModal.comment.trim(),
    });
    message.success(`v${rejectModal.doc.versionNo} 已拒绝`);
    rejectModalOpen.value = false;
    await loadChain(currentDocId.value);
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'errorFields' in cause) return; // AntDV validate 抛错
    message.error(ipdApiErrorText(cause));
  } finally {
    rejectSubmitting.value = false;
  }
}

// ---------- 归档（REVIEWED → ARCHIVED） ----------
async function submitArchive(doc: AiDocument) {
  if (archivingVersionId.value) return;
  if (doc.status !== 'REVIEWED') {
    message.warning(`v${doc.versionNo} 当前状态 ${doc.status}，需先审核通过才能归档`);
    return;
  }
  archivingVersionId.value = doc.id;
  try {
    await archiveAiDocumentVersion(doc.id, doc.id);
    message.success(`v${doc.versionNo} 已归档`);
    const anchorId = doc.parentVersionId ?? doc.id;
    await loadChain(anchorId);
  } catch (cause) {
    message.error(ipdApiErrorText(cause));
  } finally {
    archivingVersionId.value = null;
  }
}

// ---------- 字段级 diff（P4-2.3 /ai-documents/{id}/diff?from=&to=） ----------
const diffOpen = ref(false);
const diffLoading = ref(false);
const diffError = ref<null | string>(null);
const diffFields = ref<AiDocumentDiffField[]>([]);
const diffPair = ref<{ fromId: string; fromNo: number; toId: string; toNo: number } | null>(null);

/** 字段级 diff 单行渲染：added=绿 / removed=红 / modified=黄 / unchanged=灰。 */
function diffValueClass(changeType: 'added' | 'modified' | 'removed' | 'unchanged'): string {
  if (changeType === 'added') return 'text-green-700';
  if (changeType === 'removed') return 'text-red-700 line-through';
  if (changeType === 'modified') return 'text-amber-700';
  return 'text-muted-foreground';
}

async function openDiffWithPrevious() {
  if (!head.value || chain.value.length < 2 || !currentDocId.value) {
    message.warning('至少需要 2 个版本才能进行对比');
    return;
  }
  const to = head.value;
  const previousIndex = chain.value.length - 2;
  const from = chain.value[previousIndex];
  if (!from) return;
  diffPair.value = {
    fromId: from.id,
    fromNo: from.versionNo,
    toId: to.id,
    toNo: to.versionNo,
  };
  diffOpen.value = true;
  diffLoading.value = true;
  diffError.value = null;
  try {
    const result = await getAiDocumentDiff(currentDocId.value, from.id, to.id);
    diffFields.value = result.fields;
  } catch (cause) {
    diffFields.value = [];
    diffError.value = ipdApiErrorText(cause, 'Diff 加载失败，请稍后重试');
  } finally {
    diffLoading.value = false;
  }
}

// ---------- 版本对比（左右双栏） ----------
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
      message="AI 生成已接入（P4-2.2）：生成结果登记为待审核 v1，未经人工审核不得作为正式交付物（BR-AI-03）。系统不做内容过滤、直接透传模型输出（BR-AI-04），请人工把控内容风险。归档状态机：GENERATED → REVIEWED → ARCHIVED；GENERATED 状态可通过「审核拒绝」进入 REJECTED。"
      show-icon
      type="warning"
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

    <!-- ② AI 生成（P4-2.2） -->
    <Card title="AI 生成（录入原始资料 → 模型润色/补齐/标准化）">
      <Alert
        class="mb-3"
        message="风险提示：模型输出由系统原样透传、不过滤（BR-AI-04）；生成结果为待审核状态，须经人工审核确认后方可使用。"
        show-icon
        type="warning"
      />
      <Form layout="horizontal" :label-col="{ style: { width: '110px' } }">
        <FormItem label="文档标题" required>
          <Input
            v-model:value="generateForm.title"
            :maxlength="200"
            placeholder="请输入生成文档的标题"
            show-count
          />
        </FormItem>
        <FormItem label="原始资料" required>
          <Textarea
            v-model:value="generateForm.prompt"
            :maxlength="30000"
            :rows="8"
            show-count
            placeholder="粘贴原始资料 / 输入生成指令（不超过 30000 字符），例如：用户反馈要点、竞品速览、希望覆盖的章节……"
          />
        </FormItem>
        <FormItem label=" " :colon="false">
          <Space>
            <Button :loading="generateSubmitting" type="primary" v-access:code="IPD_PERMISSION_CODES.AI_DOCUMENT_CREATE" @click="submitGenerate">
              {{ generateSubmitting ? '生成中（约需数十秒）……' : '开始生成' }}
            </Button>
          </Space>
        </FormItem>
      </Form>
      <Alert v-if="generateError" class="mt-2" show-icon type="error" role="alert" :message="generateError" />
      <Alert v-if="generateResult" class="mt-2" show-icon type="success">
        <template #message>已生成 v{{ generateResult.versionNo }}（待审核）：{{ generateResult.title }}</template>
        <template #description>
          文档 ID：{{ generateResult.id }}；模型：{{ generateResult.model || PENDING_TEXT }}；
          Token 消耗：提示 {{ generateResult.tokenPrompt ?? PENDING_TEXT }} + 补全 {{ generateResult.tokenCompletion ?? PENDING_TEXT }}；
          版本链已在下方加载，请人工审核确认。
        </template>
      </Alert>
    </Card>

    <!-- ③ 登记 AI 输出 v1 -->
    <Card title="登记外部 AI 输出（版本链 v1 锚点）">
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
          <Button :loading="registerSubmitting" type="primary" v-access:code="IPD_PERMISSION_CODES.AI_DOCUMENT_CREATE" @click="submitRegister">登记 AI 输出</Button>
        </FormItem>
      </Form>
      <Alert v-if="registerError" class="mt-2" show-icon type="error" role="alert" :message="registerError" />
      <Alert v-if="registerResult" class="mt-2" show-icon type="success">
        <template #message>已登记 v{{ registerResult.versionNo }}：{{ registerResult.title }}</template>
        <template #description>文档 ID：{{ registerResult.id }}；版本链已在下方加载。</template>
      </Alert>
    </Card>

    <!-- ③ 版本链与人工审核 / 拒绝 / 归档 -->
    <Card title="版本链与人工审核">
      <Space compact class="mb-4">
        <Input
          v-model:value="docIdInput"
          style="width: 280px"
          placeholder="输入文档 ID 加载版本链"
          @press-enter="loadChain(docIdInput)"
        />
        <Button :loading="chainLoading" type="primary" @click="loadChain(docIdInput)">加载版本链</Button>
        <Button
          v-if="chain.length >= 2 && currentDocId"
          :loading="diffLoading"
          type="default"
          @click="openDiffWithPrevious"
        >
          与上一版对比（diff）
        </Button>
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
          <!-- BR-AI-04：后端不审，前端 UI 校验义务；见下方 Alert 文案。 -->
          <template v-if="doc.status === 'GENERATED'">
            <Alert
              class="mt-2"
              description="确认无误请走审核流；后端不做内容过滤，前端风险提示为唯一校验锚点。"
              message="AI 生成、未经审核"
              role="alert"
              show-icon
              type="warning"
            />
            <Space class="mt-2">
              <Button
                :loading="reviewingVersionId === doc.id"
                size="small"
                type="primary"
                v-access:code="IPD_PERMISSION_CODES.AI_DOCUMENT_REVIEW"
                @click="submitReview(doc)"
              >
                审核通过
              </Button>
              <Button
                :loading="rejectSubmitting && rejectModal.docId === doc.id"
                danger
                size="small"
                v-access:code="IPD_PERMISSION_CODES.AI_DOCUMENT_REVIEW"
                @click="openRejectModal(doc)"
              >
                审核拒绝
              </Button>
            </Space>
          </template>
          <!-- 状态机：archive 仅 REVIEWED 可用（后端 REQUIRED REVIEWED）。 -->
          <template v-else-if="doc.status === 'REVIEWED'">
            <Space class="mt-2">
              <Button
                :loading="archivingVersionId === doc.id"
                size="small"
                type="default"
                v-access:code="IPD_PERMISSION_CODES.AI_DOCUMENT_REVISE"
                @click="submitArchive(doc)"
              >
                归档
              </Button>
              <span class="text-muted-foreground text-xs">审核已通过；归档后不可再修改内容。</span>
            </Space>
          </template>
          <template v-else-if="doc.status === 'REJECTED'">
            <Alert
              class="mt-2"
              message="该版本已被驳回，不可再走 review/archive。"
              show-icon
              type="error"
              role="alert"
            />
          </template>
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

    <!-- ⑤ 拒绝 Modal（comment 必填） -->
    <Modal
      v-model:open="rejectModalOpen"
      :confirm-loading="rejectSubmitting"
      :mask-closable="false"
      :ok-button-props="okButtonProps"
      cancel-text="取消"
      ok-text="确认拒绝"
      title="审核拒绝"
      @ok="submitReject"
    >
      <Alert
        class="mb-3"
        message="拒绝原因将写入版本日志，用于回溯。请客观描述问题（如事实错误 / 风险不可接受 / 与产品定位不符）。"
        show-icon
        type="warning"
      />
      <Form ref="rejectFormRef" :model="rejectModal" layout="vertical">
        <FormItem
          label="拒绝原因"
          name="comment"
          required
          :rules="[
            { required: true, message: '请填写拒绝原因' },
            { min: 2, message: '拒绝原因至少 2 个字符' },
          ]"
        >
          <Input.TextArea
            v-model:value="rejectModal.comment"
            :maxlength="500"
            :rows="4"
            placeholder="例如：与 PRD 模板不符、需求边界不清晰、目标用户群定义错误等"
            show-count
          />
        </FormItem>
        <FormItem v-if="rejectModal.doc" label="目标版本">
          <Tag color="warning">v{{ rejectModal.doc.versionNo }}</Tag>
          <span class="ml-2">{{ rejectModal.doc.title }}</span>
        </FormItem>
      </Form>
      <div class="text-muted-foreground text-xs">
        comment 为必填项（后端 reject 端点强制校验）；拒绝后状态变更为 REJECTED，版本链只读。
      </div>
    </Modal>

    <!-- ⑥ 字段级 diff 抽屉 -->
    <Drawer
      v-model:open="diffOpen"
      :footer="null"
      :title="diffPair ? `v${diffPair.fromNo} → v${diffPair.toNo} 字段级 diff` : '字段级 diff'"
      width="720px"
    >
      <Spin v-if="diffLoading" tip="正在加载字段级 diff……" />
      <Alert
        v-else-if="diffError"
        :message="diffError"
        role="alert"
        show-icon
        type="error"
      />
      <Empty
        v-else-if="diffFields.length === 0"
        description="两版本字段完全一致，无 diff。"
      />
      <table v-else class="w-full border-collapse text-xs">
        <thead>
          <tr class="border-b text-left">
            <th class="py-2 pr-2">字段</th>
            <th class="py-2 pr-2">变化</th>
            <th class="py-2 pr-2">from (v{{ diffPair?.fromNo ?? '' }})</th>
            <th class="py-2 pr-2">to (v{{ diffPair?.toNo ?? '' }})</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="field in diffFields"
            :key="field.field"
            class="border-b align-top"
          >
            <td class="py-2 pr-2 font-mono">{{ field.field }}</td>
            <td class="py-2 pr-2">
              <Tag v-if="field.changeType === 'added'" color="green">新增</Tag>
              <Tag v-else-if="field.changeType === 'removed'" color="red">删除</Tag>
              <Tag v-else-if="field.changeType === 'modified'" color="orange">变更</Tag>
              <Tag v-else color="default">未变</Tag>
            </td>
            <td :class="['py-2 pr-2', diffValueClass(field.changeType)]">
              <span v-if="field.from === null" class="text-muted-foreground">∅</span>
              <pre v-else class="max-h-40 overflow-auto whitespace-pre-wrap">{{ field.from }}</pre>
            </td>
            <td :class="['py-2 pr-2', diffValueClass(field.changeType)]">
              <span v-if="field.to === null" class="text-muted-foreground">∅</span>
              <pre v-else class="max-h-40 overflow-auto whitespace-pre-wrap">{{ field.to }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </Drawer>
  </div>
</template>
