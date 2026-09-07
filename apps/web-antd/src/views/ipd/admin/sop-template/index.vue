<script setup lang="ts">
/**
 * 页46 SOP 模板（卡 P0-10.46；后端 P1-3.3 /api/v1/sop-templates）。
 *
 * 版本生命周期（BR-IPD-07）：草稿 --发布--> 已发布 --被新版本替代--> 已归档；
 * 发布只影响此后实例化的项目，在研项目保持原版本（AC-IPD-27）。
 * 读=内部角色；复制/编辑/发布/历史恢复=仅超级管理员（后端 ipd:sop-template:edit）。
 * 五态：查询引导 / 加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { IpdSopTemplateItem } from '../../../../api/ipd/sop-template';

import { reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  copySopTemplate,
  currentSopTemplate,
  getSopTemplate,
  listSopTemplates,
  publishSopTemplate,
  revertSopTemplate,
  updateSopTemplate,
  type IpdSopTemplateDetail,
} from '../../../../api/ipd/sop-template';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

type Phase = 'error' | 'idle' | 'loading' | 'ready';

const statusMeta: Record<string, { color: string; text: string }> = {
  ARCHIVED: { color: 'default', text: '已归档' },
  DRAFT: { color: 'warning', text: '草稿' },
  PUBLISHED: { color: 'success', text: '已发布' },
};
function statusText(status: string): string {
  return statusMeta[status]?.text ?? '待补充';
}

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

const phase = ref<Phase>('idle');

/** v-else 分支里 phase 会被模板控制流收窄，函数参数不收窄，保持完整比较语义。 */
function isLoading(value: Phase): boolean {
  return value === 'loading';
}

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言。 */
function asSop(record: Record<string, any>): IpdSopTemplateItem {
  return record as IpdSopTemplateItem;
}
const offline = ref(false);
const errorMsg = ref('');
const actionCodeInput = ref('');
const queriedCode = ref('');
const rows = ref<IpdSopTemplateItem[]>([]);

/** 详情查看 */
const detail = ref<IpdSopTemplateDetail | null>(null);
const detailLoading = ref(false);
const detailOpen = ref(false);
const detailError = ref('');

/** 当前生效 SOP（按 actionCode 维度，与版本列表解耦；用于编辑前的"看生效版本"流程）。 */
const currentView = ref<IpdSopTemplateDetail | null>(null);
const currentLoading = ref(false);
const currentError = ref('');

/** 草稿编辑 */
const editOpen = ref(false);
const editSaving = ref(false);
const editId = ref('');
const editForm = reactive({ content: '', title: '' });
const editRules = {
  title: [
    { required: true, whitespace: true, message: '请输入 SOP 标题' },
    { max: 128, message: '标题不能超过128个字符' },
  ],
  content: [
    { required: true, whitespace: true, message: '请输入 SOP 正文' },
    { min: 2, message: '正文至少2个字符' },
  ],
};

/** 行级操作互斥锁：格式 `动作:id`，防止重复提交。 */
const rowBusy = ref('');

const columns = [
  { dataIndex: 'version', key: 'version', title: '版本', width: 80 },
  { dataIndex: 'title', key: 'title', title: '标题' },
  { dataIndex: 'status', key: 'status', title: '状态', width: 100 },
  { dataIndex: 'contentLen', key: 'contentLen', title: '正文字数', width: 100 },
  { key: 'actions', title: '操作', width: 260 },
];

async function load(code: string) {
  const trimmed = code.trim();
  if (!trimmed) {
    errorMsg.value = '请输入动作编码后查询';
    phase.value = 'error';
    return;
  }
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listSopTemplates(trimmed);
    queriedCode.value = trimmed;
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

async function openDetail(record: IpdSopTemplateItem) {
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  detail.value = null;
  try {
    detail.value = await getSopTemplate(record.id);
  } catch (cause) {
    detailError.value = rejectText(cause);
  } finally {
    detailLoading.value = false;
  }
}

async function loadCurrent(code: string) {
  const trimmed = code.trim();
  if (!trimmed) {
    currentView.value = null;
    currentError.value = '请输入动作编码后查看当前生效 SOP';
    return;
  }
  currentLoading.value = true;
  currentError.value = '';
  try {
    currentView.value = await currentSopTemplate(trimmed);
  } catch (cause) {
    currentView.value = null;
    currentError.value = rejectText(cause);
  } finally {
    currentLoading.value = false;
  }
}

function openEdit(record: IpdSopTemplateItem) {
  editId.value = record.id;
  editForm.title = record.title;
  editForm.content = '';
  editOpen.value = true;
  // 打开编辑前先取全文快照；后端 update 为整段覆盖，必须基于真实内容修改。
  getSopTemplate(record.id)
    .then((detail) => {
      if (editId.value === record.id) {
        editForm.content = detail.content;
        editForm.title = detail.title;
      }
    })
    .catch((cause) => {
      editOpen.value = false;
      antMessage.error(rejectText(cause));
    });
}

async function saveEdit() {
  if (editSaving.value || !editId.value) return;
  const title = editForm.title.trim();
  if (title.length < 2 || title.length > 128 || editForm.content.trim().length < 2) return;
  editSaving.value = true;
  try {
    await updateSopTemplate(editId.value, { content: editForm.content, title });
    antMessage.success('草稿已保存');
    editOpen.value = false;
    await load(queriedCode.value);
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    editSaving.value = false;
  }
}

function lock(action: string, id: string): boolean {
  if (rowBusy.value) return true;
  rowBusy.value = `${action}:${id}`;
  return false;
}
function unlock() {
  rowBusy.value = '';
}

async function runRowAction(action: 'copy' | 'publish' | 'revert', record: IpdSopTemplateItem) {
  if (lock(action, record.id)) return;
  try {
    const call = action === 'copy' ? copySopTemplate : action === 'publish' ? publishSopTemplate : revertSopTemplate;
    const next = await call(record.id);
    antMessage.success(
      action === 'publish'
        ? `已发布 v${next.version}，仅影响此后实例化的项目`
        : `已创建草稿 v${next.version}，可在草稿上编辑后发布`,
    );
    await load(queriedCode.value);
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    unlock();
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="SOP 模板按动作维护版本：草稿可编辑，发布后成为当前生效版本，旧版本自动归档。发布只影响此后实例化的项目，在研项目保持原有版本。"
      show-icon
      type="info"
    />

    <Card>
      <Space.Compact class="w-full max-w-[520px]">
        <Input
          v-model:value="actionCodeInput"
          :maxlength="32"
          allow-clear
          placeholder="输入动作编码，如 P03"
          @press-enter="load(actionCodeInput)"
        />
        <Button type="primary" @click="load(actionCodeInput)">查询版本</Button>
        <Button @click="loadCurrent(actionCodeInput)">查看当前生效 SOP</Button>
      </Space.Compact>
    </Card>

    <Card v-if="currentLoading" class="text-center">
      <Spin tip="正在拉取当前生效 SOP" />
    </Card>
    <Alert
      v-else-if="currentError"
      :message="currentError"
      show-icon
      type="error"
      role="alert"
    />
    <Card v-else-if="currentView">
      <template #title>
        <Space>
          当前生效 SOP：{{ currentView.actionCode || '待补充' }}
          <Tag :color="statusMeta[currentView.status]?.color ?? 'default'">{{ statusText(currentView.status) }}</Tag>
          <span class="text-muted-foreground text-sm">v{{ currentView.version }}</span>
        </Space>
      </template>
      <div class="mb-3 text-muted-foreground text-sm">{{ currentView.title || '待补充' }}</div>
      <pre class="max-h-[480px] overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-sm">{{ currentView.content || '待补充' }}</pre>
    </Card>

    <Card v-if="phase === 'idle'" class="text-center">
      <Empty description="输入动作编码后查询该动作的 SOP 版本列表。动作编码可在项目流程的动作详情页查看。" />
    </Card>

    <Card v-else-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载版本列表" />
    </Card>

    <template v-else>
      <Alert
        v-if="phase === 'error'"
        :message="errorMsg"
        show-icon
        type="error"
        role="alert"
      >
        <template v-if="offline" #action>
          <Button danger size="small" @click="load(queriedCode || actionCodeInput)">重新加载</Button>
        </template>
      </Alert>

      <Card v-else-if="rows.length === 0" class="text-center">
        <Empty :description="`动作 ${queriedCode} 暂无 SOP 版本记录。可从同动作的已归档版本发起历史恢复。`" />
      </Card>

      <Card v-else>
        <template #title>
          动作 {{ queriedCode }} 的版本列表
          <span class="text-muted-foreground ml-2 text-sm">共 {{ rows.length }} 个版本</span>
        </template>
        <Table
          :columns="columns"
          :data-source="rows"
          :loading="isLoading(phase)"
          :pagination="false"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'version'">
              <span class="tabular-nums">v{{ record.version }}</span>
            </template>
            <template v-else-if="column.key === 'title'">
              {{ record.title || '待补充' }}
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="statusMeta[record.status]?.color ?? 'default'">{{ statusText(record.status) }}</Tag>
            </template>
            <template v-else-if="column.key === 'contentLen'">
              <span class="tabular-nums">{{ record.contentLen }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <Space :size="4" wrap>
                <Button size="small" v-access:code="IPD_PERMISSION_CODES.SOP_TEMPLATE_LIST" @click="openDetail(asSop(record))">查看</Button>
                <template v-if="record.status === 'DRAFT'">
                  <Button size="small" type="primary" @click="openEdit(asSop(record))">编辑</Button>
                  <Popconfirm
                    title="发布后该草稿成为当前生效版本，旧版本自动归档；仅影响此后实例化的项目，在研项目保持原版本。确认发布？"
                    @confirm="runRowAction('publish', asSop(record))"
                  >
                    <Button :loading="rowBusy === `publish:${record.id}`" danger size="small">发布</Button>
                  </Popconfirm>
                </template>
                <Popconfirm
                  v-else-if="record.status === 'PUBLISHED'"
                  title="复制当前生效版本为草稿进行修改？同一动作同时只能有一个草稿。"
                  @confirm="runRowAction('copy', asSop(record))"
                >
                  <Button :loading="rowBusy === `copy:${record.id}`" size="small">复制为草稿</Button>
                </Popconfirm>
                <Popconfirm
                  v-else
                  title="将该归档版本复制为草稿（恢复历史），编辑发布后才重新生效。确认？"
                  @confirm="runRowAction('revert', asSop(record))"
                >
                  <Button :loading="rowBusy === `revert:${record.id}`" size="small">历史恢复</Button>
                </Popconfirm>
              </Space>
            </template>
          </template>
        </Table>
      </Card>
    </template>

    <Modal
      v-model:open="detailOpen"
      :footer="null"
      :title="detail ? `v${detail.version} ${detail.title || '待补充'}` : 'SOP 详情'"
      width="720px"
    >
      <Spin v-if="detailLoading" class="my-8" />
      <Alert v-else-if="detailError" :message="detailError" show-icon type="error" role="alert" />
      <template v-else-if="detail">
        <Space class="mb-3">
          <Tag :color="statusMeta[detail.status]?.color ?? 'default'">{{ statusText(detail.status) }}</Tag>
          <span class="text-muted-foreground text-sm">动作编码：{{ detail.actionCode || '待补充' }}</span>
        </Space>
        <pre class="max-h-[480px] overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-sm">{{ detail.content || '待补充' }}</pre>
      </template>
    </Modal>

    <Modal
      v-model:open="editOpen"
      :confirm-loading="editSaving"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="保存草稿"
      title="编辑 SOP 草稿"
      width="720px"
      @ok="saveEdit"
    >
      <Alert
        class="mb-3"
        message="仅草稿可编辑；保存后需发布才对新项目生效。生物特征类动作（如 V10/C12/D11）发布时正文必须包含「算法公平性」与「偏见测试」要求。"
        show-icon
        type="warning"
      />
      <Form :model="editForm" :rules="editRules" layout="vertical">
        <FormItem label="SOP 标题" name="title">
          <Input v-model:value="editForm.title" :maxlength="128" show-count placeholder="请输入 SOP 标题" />
        </FormItem>
        <FormItem label="SOP 正文" name="content">
          <Input.TextArea
            v-model:value="editForm.content"
            :auto-size="{ minRows: 12, maxRows: 24 }"
            placeholder="请输入 SOP 正文"
          />
        </FormItem>
      </Form>
    </Modal>
  </div>
</template>
