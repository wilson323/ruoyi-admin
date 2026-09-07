<script setup lang="ts">
/**
 * 页47 Gate 评审要素（卡 P0-10.47；后端 P1-6 /api/v1/gate-elements）。
 *
 * 后端真值：列表仅返回启用要素（sortOrder 升序）；编码即身份不可改；
 * 无删除接口——仅停用（G-02 证据链禁删）；写操作仅超级管理员。
 * 33 项要素 / 14 否决位为种子目标值，页面按真实接口数据统计展示（G-06 不造数）。
 * 五态：加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据。
 */
import type { IpdGateElement } from '../../../../api/ipd/gate-element';

import { computed, onMounted, reactive, ref } from 'vue';
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
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  IPD_GATE_CODES,
  createGateElement,
  disableGateElement,
  listGateElements,
  updateGateElement,
} from '../../../../api/ipd/gate-element';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

type Phase = 'error' | 'loading' | 'ready';

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
const gateFilter = ref<string>('');
const rows = ref<IpdGateElement[]>([]);

const vetoCount = computed(() => rows.value.filter((row) => row.isVeto === '1').length);

/** 新建/编辑弹窗共用状态；editingId 为空表示新建。 */
const modalOpen = ref(false);
const modalSaving = ref(false);
const editingId = ref('');
const modalForm = reactive({
  elementCode: '',
  elementName: '',
  enabled: true,
  gateCode: 'G1' as string,
  isVeto: false,
  passStandard: '',
  sortOrder: 0,
});
const modalRules = {
  elementCode: [{ required: true, whitespace: true, message: '请输入要素编码' }],
  elementName: [{ required: true, whitespace: true, message: '请输入要素名称' }],
  gateCode: [{ required: true, message: '请选择适用 Gate' }],
};
const modalFormRef = ref();

const columns = [
  { dataIndex: 'sortOrder', key: 'sortOrder', title: '排序', width: 80 },
  { dataIndex: 'gateCode', key: 'gateCode', title: 'Gate', width: 80 },
  { dataIndex: 'elementCode', key: 'elementCode', title: '要素编码', width: 140 },
  { dataIndex: 'elementName', key: 'elementName', title: '要素名称' },
  { dataIndex: 'passStandard', key: 'passStandard', title: '通过标准' },
  { dataIndex: 'isVeto', key: 'isVeto', title: '否决项', width: 90 },
  { key: 'actions', title: '操作', width: 140 },
];

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listGateElements(gateFilter.value || undefined);
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

function openCreate() {
  editingId.value = '';
  modalForm.gateCode = gateFilter.value || 'G1';
  modalForm.elementCode = '';
  modalForm.elementName = '';
  modalForm.passStandard = '';
  modalForm.isVeto = false;
  modalForm.sortOrder = 0;
  modalForm.enabled = true;
  modalOpen.value = true;
}

function asGateElement(record: Record<string, any>): IpdGateElement {
  return record as IpdGateElement;
}

function openEdit(record: IpdGateElement) {
  editingId.value = record.id;
  modalForm.gateCode = record.gateCode;
  modalForm.elementCode = record.elementCode;
  modalForm.elementName = record.elementName;
  modalForm.passStandard = record.passStandard ?? '';
  modalForm.isVeto = record.isVeto === '1';
  modalForm.sortOrder = record.sortOrder ?? 0;
  modalForm.enabled = record.enabled === '1';
  modalOpen.value = true;
}

async function saveModal() {
  if (modalSaving.value) return;
  try {
    await modalFormRef.value?.validate();
  } catch {
    return;
  }
  modalSaving.value = true;
  const payload = {
    elementName: modalForm.elementName.trim(),
    enabled: modalForm.enabled ? '1' : '0',
    isVeto: modalForm.isVeto ? '1' : '0',
    passStandard: modalForm.passStandard.trim() ? modalForm.passStandard.trim() : null,
    sortOrder: modalForm.sortOrder ?? 0,
  };
  try {
    if (editingId.value) {
      await updateGateElement(editingId.value, payload);
      antMessage.success('评审要素已更新');
    } else {
      await createGateElement({
        ...payload,
        elementCode: modalForm.elementCode.trim(),
        gateCode: modalForm.gateCode,
      });
      antMessage.success('评审要素已创建');
    }
    modalOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    modalSaving.value = false;
  }
}

async function disable(record: IpdGateElement) {
  try {
    await disableGateElement(record.id);
    antMessage.success(`要素 ${record.elementCode} 已停用`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="Gate 评审要素定义五大 Gate 的判定标准；否决项判定不通过时无法提交通过（硬阻断）。要素只可停用不可删除，历史判定记录不受停用影响。"
      show-icon
      type="info"
    />

    <Card>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Space>
          <span class="text-muted-foreground text-sm">按 Gate 筛选</span>
          <Select
            v-model:value="gateFilter"
            :options="[{ label: '全部 Gate', value: '' }, ...IPD_GATE_CODES.map((code) => ({ label: code, value: code }))]"
            class="min-w-[140px]"
            @change="load"
          />
        </Space>
        <Button type="primary" v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_CREATE" @click="openCreate">新增要素</Button>
      </div>
    </Card>

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载评审要素" />
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
          <Button danger size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <Card v-else>
        <template #title>
          评审要素清单
          <span class="text-muted-foreground ml-2 text-sm">
            当前筛选下共 {{ rows.length }} 项，其中否决项 {{ vetoCount }} 项（仅显示启用要素，数据来自系统配置）
          </span>
        </template>
        <Empty
          v-if="rows.length === 0"
          :description="gateFilter ? `${gateFilter} 暂无启用的评审要素。可切换到全部 Gate 或新增要素。` : '暂无启用的评审要素。点击「新增要素」创建第一条判定标准。'"
        />
        <Table
          v-else
          :columns="columns"
          :data-source="rows"
          :pagination="false"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'sortOrder'">
              <span class="tabular-nums">{{ record.sortOrder ?? 0 }}</span>
            </template>
            <template v-else-if="column.key === 'passStandard'">
              {{ record.passStandard || '待补充' }}
            </template>
            <template v-else-if="column.key === 'isVeto'">
              <Tag v-if="record.isVeto === '1'" color="error">否决项</Tag>
              <span v-else class="text-muted-foreground">普通项</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <Space :size="4">
                <Button size="small" v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_UPDATE" @click="openEdit(asGateElement(record))">编辑</Button>
                <Popconfirm
                  title="停用后该要素不再出现在评审要素列表，历史判定记录不受影响。确认停用？"
                  @confirm="disable(asGateElement(record))"
                >
                  <Button danger size="small" v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_DISABLE">停用</Button>
                </Popconfirm>
              </Space>
            </template>
          </template>
        </Table>
      </Card>
    </template>

    <Modal
      v-model:open="modalOpen"
      :confirm-loading="modalSaving"
      :mask-closable="false"
      :title="editingId ? '编辑评审要素' : '新增评审要素'"
      cancel-text="取消"
      ok-text="保存"
      @ok="saveModal"
    >
      <Alert
        v-if="editingId"
        class="mb-3"
        message="要素编码与适用 Gate 是要素身份，创建后不可修改。"
        show-icon
        type="warning"
      />
      <Form ref="modalFormRef" :label-col="{ span: 6 }" :model="modalForm" :rules="modalRules" :wrapper-col="{ span: 16 }">
        <FormItem label="适用 Gate" name="gateCode">
          <Select
            v-model:value="modalForm.gateCode"
            :disabled="!!editingId"
            :options="IPD_GATE_CODES.map((code) => ({ label: code, value: code }))"
          />
        </FormItem>
        <FormItem label="要素编码" name="elementCode">
          <Input v-model:value="modalForm.elementCode" :disabled="!!editingId" :maxlength="64" placeholder="如 G1-E01" />
        </FormItem>
        <FormItem label="要素名称" name="elementName">
          <Input v-model:value="modalForm.elementName" :maxlength="128" placeholder="如 客户验证完成" />
        </FormItem>
        <FormItem label="通过标准" name="passStandard">
          <Input.TextArea
            v-model:value="modalForm.passStandard"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            placeholder="判定通过的客观标准（选填）"
          />
        </FormItem>
        <FormItem :value-prop-name="'checked'" label="否决项" name="isVeto">
          <Space>
            <Switch v-model:checked="modalForm.isVeto" />
            <span class="text-muted-foreground text-xs">开启后判定不通过将阻断 Gate 提交通过</span>
          </Space>
        </FormItem>
        <FormItem label="排序号" name="sortOrder">
          <InputNumber v-model:value="modalForm.sortOrder" :precision="0" class="w-full" />
        </FormItem>
        <FormItem v-if="!editingId" :value-prop-name="'checked'" label="启用" name="enabled">
          <Switch v-model:checked="modalForm.enabled" />
        </FormItem>
      </Form>
    </Modal>
  </div>
</template>
