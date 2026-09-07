<script setup lang="ts">
/**
 * 页18 国别认证清单模板库（卡 P0-10.18；后端 P1-7.1 /api/v1/cert-templates）。
 *
 * 后端真值：
 * - 一行 = 一条具体认证项（如 SABER-SASO），countryCode + certName 复合识别；
 * - GET /cert-templates 返回全量裸 List；前端按 countryCode 分组；
 * - GET /cert-templates/country-counts 返回各国当前项数 map；
 * - 新建/删除仅超管；删除走 POST /cert-templates/:id/remove（软删除）。
 *
 * 五态：加载/列表/空态/拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { CertTemplate } from '../../../../api/ipd/cert-template';

import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  FormItem,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  createCertTemplate,
  listCertCountryCounts,
  listCertTemplates,
  removeCertTemplate,
} from '../../../../api/ipd/cert-template';
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

const allRows = ref<CertTemplate[]>([]);
const counts = ref<Record<string, number>>({});
const selectedCountry = ref<string>('');

/** 国别侧栏：按 countryCode 聚合；按项数倒序。 */
const countries = computed(() => {
  const map = new Map<string, { code: string; name: string; count: number }>();
  for (const row of allRows.value) {
    const key = row.countryCode || 'OTHER';
    const entry = map.get(key) ?? { code: key, name: row.countryName || key, count: 0 };
    entry.count += 1;
    if (!entry.name && row.countryName) entry.name = row.countryName;
    map.set(key, entry);
  }
  // 合并 country-counts（兜底未在当前 rows 中出现的国别）
  for (const [code, count] of Object.entries(counts.value)) {
    if (!map.has(code)) map.set(code, { code, name: code, count });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
});

const selectedName = computed(() => {
  if (!selectedCountry.value) return '';
  return countries.value.find((c) => c.code === selectedCountry.value)?.name ?? '';
});

const rowsInCountry = computed(() =>
  selectedCountry.value
    ? allRows.value.filter((row) => row.countryCode === selectedCountry.value)
    : [],
);

const columns = [
  { dataIndex: 'certName', key: 'certName', title: '认证名称', width: 200 },
  { dataIndex: 'certAuthority', key: 'certAuthority', title: '认证机构', width: 160 },
  { dataIndex: 'requirementDesc', key: 'requirementDesc', title: '要求说明' },
  { dataIndex: 'isMandatory', key: 'isMandatory', title: '强制', width: 90 },
  { key: 'actions', title: '操作', width: 110 },
];

const rowBusy = ref('');

/** 新建认证项弹窗。 */
const createOpen = ref(false);
const createSaving = ref(false);
const createForm = reactive({
  certAuthority: '',
  certName: '',
  countryCode: '',
  countryName: '',
  isMandatory: true,
  requirementDesc: '',
});
const createFormRef = ref();
const countryCodeOptions = computed(() =>
  countries.value.map((c) => ({ label: `${c.code}（${c.name}）`, value: c.code })),
);
const createRules = {
  certName: [
    { required: true, whitespace: true, message: '请输入认证名称' },
    { max: 128, message: '认证名称不能超过 128 个字符' },
  ],
  countryCode: [{ required: true, whitespace: true, message: '请填写国别代码（2 位 ISO）' }],
  countryName: [
    { required: true, whitespace: true, message: '请填写国家中文名' },
    { max: 64, message: '国家名不能超过 64 个字符' },
  ],
};

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    const [rows, countryCounts] = await Promise.all([
      listCertTemplates(),
      listCertCountryCounts(),
    ]);
    allRows.value = rows;
    counts.value = countryCounts;
    if (!selectedCountry.value && countries.value.length > 0) {
      selectedCountry.value = countries.value[0]!.code;
    }
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

function selectCountry(code: string) {
  selectedCountry.value = code;
}

function openCreate() {
  createForm.certAuthority = '';
  createForm.certName = '';
  createForm.countryCode = selectedCountry.value || '';
  createForm.countryName = selectedName.value || '';
  createForm.isMandatory = true;
  createForm.requirementDesc = '';
  createOpen.value = true;
}

async function saveCreate() {
  if (createSaving.value) return;
  try {
    await createFormRef.value?.validate();
  } catch {
    return;
  }
  createSaving.value = true;
  try {
    await createCertTemplate({
      certAuthority: createForm.certAuthority.trim() || null,
      certName: createForm.certName.trim(),
      countryCode: createForm.countryCode.trim().toUpperCase(),
      countryName: createForm.countryName.trim(),
      isMandatory: createForm.isMandatory ? '1' : '0',
      requirementDesc: createForm.requirementDesc.trim() || null,
    });
    antMessage.success('认证项已创建');
    createOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    createSaving.value = false;
  }
}

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言。 */
function asCertTemplate(record: Record<string, any>): CertTemplate {
  return record as CertTemplate;
}

async function removeItem(record: CertTemplate) {
  if (rowBusy.value) return;
  rowBusy.value = `remove:${record.id}`;
  try {
    await removeCertTemplate(record.id);
    antMessage.success(`已删除 ${record.countryCode} · ${record.certName}`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    rowBusy.value = '';
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="维护国别对应的强制认证项；项目选定目标市场后自动带出认证清单。删除走软删除（页面删除按钮仅超管可见），不存在的国别可在右上角「新增认证项」按需添加。"
      show-icon
      type="info"
    />

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载国别认证清单" />
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
          国别认证清单
          <span class="text-muted-foreground ml-2 text-sm">
            共 {{ countries.length }} 个国别、{{ allRows.length }} 项认证
          </span>
        </template>
        <template #extra>
          <Button type="primary" v-access:code="IPD_PERMISSION_CODES.CERT_TEMPLATE_CREATE" @click="openCreate">新增认证项</Button>
        </template>
        <Row :gutter="16">
          <Col :span="8">
            <Empty
              v-if="countries.length === 0"
              description="暂无国别认证模板。可点击右上角「新增认证项」开始维护。"
            />
            <ul v-else class="flex flex-col gap-2" role="list">
              <li v-for="country in countries" :key="country.code">
                <Button
                  :type="country.code === selectedCountry ? 'primary' : 'default'"
                  block
                  class="!flex !h-auto !justify-between !text-left"
                  @click="selectCountry(country.code)"
                >
                  <span class="flex flex-col items-start">
                    <span class="font-medium">{{ country.name || country.code }}</span>
                    <span class="text-muted-foreground text-xs">
                      {{ country.code }} · {{ country.count }} 项
                    </span>
                  </span>
                  <span class="tabular-nums text-xs">{{ country.count }}</span>
                </Button>
              </li>
            </ul>
          </Col>
          <Col :span="16">
            <Empty
              v-if="rowsInCountry.length === 0"
              :description="selectedCountry ? `${selectedCountry} 暂无认证项。点击右上角「新增认证项」补全。` : '请在左侧选择一个国别查看认证项。'"
            />
            <Table
              v-else
              :columns="columns"
              :data-source="rowsInCountry"
              :pagination="false"
              row-key="id"
              size="middle"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'certAuthority'">
                  {{ record.certAuthority ?? '待补充' }}
                </template>
                <template v-else-if="column.key === 'requirementDesc'">
                  <span class="whitespace-pre-wrap">{{ record.requirementDesc ?? '待补充' }}</span>
                </template>
                <template v-else-if="column.key === 'isMandatory'">
                  <Tag v-if="record.isMandatory === '1'" color="error">强制</Tag>
                  <Tag v-else color="default">推荐</Tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Button
                    :loading="rowBusy === `remove:${record.id}`"
                    danger
                    size="small"
                    v-access:code="IPD_PERMISSION_CODES.CERT_TEMPLATE_DELETE"
                    @click="removeItem(asCertTemplate(record))"
                  >
                    删除
                  </Button>
                </template>
              </template>
            </Table>
          </Col>
        </Row>
      </Card>
    </template>

    <Modal
      v-model:open="createOpen"
      :confirm-loading="createSaving"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="保存"
      title="新增国别认证项"
      width="640px"
      @ok="saveCreate"
    >
      <Alert
        class="mb-3"
        message="仅超级管理员可写入；同一国别下认证名称建议唯一，便于项目按 target_markets 自动带出。"
        show-icon
        type="warning"
      />
      <Form
        ref="createFormRef"
        :label-col="{ span: 5 }"
        :model="createForm"
        :rules="createRules"
        :wrapper-col="{ span: 18 }"
        layout="horizontal"
      >
        <FormItem label="国别代码" name="countryCode">
          <Select
            v-model:value="createForm.countryCode"
            :options="countryCodeOptions"
            allow-clear
            placeholder="如 SA"
            show-search
          />
        </FormItem>
        <FormItem label="国家中文名" name="countryName">
          <Input v-model:value="createForm.countryName" :maxlength="64" placeholder="如 沙特阿拉伯" />
        </FormItem>
        <FormItem label="认证名称" name="certName">
          <Input v-model:value="createForm.certName" :maxlength="128" placeholder="如 SABER" />
        </FormItem>
        <FormItem label="认证机构">
          <Input v-model:value="createForm.certAuthority" :maxlength="128" placeholder="如 SASO" />
        </FormItem>
        <FormItem label="要求说明">
          <Input.TextArea
            v-model:value="createForm.requirementDesc"
            :auto-size="{ minRows: 3, maxRows: 8 }"
            :maxlength="2000"
            placeholder="适用情形、必填证据、变更影响等"
          />
        </FormItem>
        <FormItem :value-prop-name="'checked'" label="是否强制">
          <Space>
            <Switch v-model:checked="createForm.isMandatory" />
            <span class="text-muted-foreground text-xs">开启后该项目目标市场含该国别时强制登记</span>
          </Space>
        </FormItem>
      </Form>
    </Modal>
  </div>
</template>