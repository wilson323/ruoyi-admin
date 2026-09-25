<script setup lang="ts">
/**
 * 角色权限配置页（R215 权限可配置化，owner 指令 2026-09-24「确保权限可配置化」）。
 *
 * 语义（后端 IpdRolePermissionCatalog DB 覆盖层契约）：
 * - 有效权限 = Java 默认 ∪ GRANT − REVOKE；覆盖行清空 ⇒ 回纯 Java 默认（fail-closed）；
 * - 仅 SUPER_ADMIN 可见（路由 meta.authority + 页面角色闸双闸；后端注解 + requireAdmin 三保险）；
 * - 元权限码 ipd:role-permission:* 固定于超管目录，后端双端拒绝入库（自举保护），本页不展示；
 * - create/delete 即时生效（无需重启，仅影响之后建立的新会话的注解层判定）；
 * - 边界披露：方法内 require* 兜底是独立第二层角色闸，DB 配置只放开注解层。
 *
 * 端点：GET/POST/DELETE /api/v1/role-permissions（+ /effective、/reload）。
 * 五态：拒绝（角色）/ 加载 / 就绪 / 覆盖行空态 / 断网；不展示任何模拟数据（G-06）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  Popconfirm,
  Radio,
  RadioGroup,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  message as antMessage,
} from 'ant-design-vue';

import type {
  EffectiveSnapshot,
  RolePermissionEffect,
  RolePermissionRow,
} from '../../../api/ipd/role-permission';
import {
  createRolePermission,
  deleteRolePermission,
  getEffectivePermissions,
  listRolePermissions,
  reloadRolePermissions,
} from '../../../api/ipd/role-permission';
import { IpdRequestError } from '../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { permissionText, roleText } from '../_shared/ipd-enums';
import { PENDING_TEXT } from '../_shared/format';

type Phase = 'forbidden' | 'loading' | 'ready';

const ROLES = ['SUPER_ADMIN', 'GROUP_LEADER', 'MARKET_PM', 'RD_PM'] as const;

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

const phase = ref<Phase>('loading');
const offline = ref(false);
const rows = ref<RolePermissionRow[]>([]);
const snapshot = ref<EffectiveSnapshot>({});

async function loadAll(): Promise<void> {
  phase.value = 'loading';
  offline.value = false;
  try {
    if (personType.value !== 'SUPER_ADMIN') {
      phase.value = 'forbidden';
      return;
    }
    const [list, snap] = await Promise.all([listRolePermissions(), getEffectivePermissions()]);
    rows.value = list;
    snapshot.value = snap;
    phase.value = 'ready';
  } catch (cause) {
    if (cause instanceof IpdRequestError && cause.kind === 'transport') {
      offline.value = true;
      phase.value = 'ready';
      antMessage.error(rejectText(cause));
      return;
    }
    if (cause instanceof IpdRequestError && cause.status === 403) {
      phase.value = 'forbidden';
      return;
    }
    phase.value = 'ready';
    antMessage.error(rejectText(cause));
  }
}
onMounted(loadAll);

/** 新增表单。 */
const form = reactive({
  effect: 'GRANT' as RolePermissionEffect,
  permissionCode: '',
  personType: '' as string,
  remark: '',
});
const submitting = ref(false);

const roleOptions = ROLES.map((r) => ({ label: `${roleText(r)}（${r}）`, value: r }));

/** 权限码下拉：全部角色快照中出现过的 ipd: 码并集（排除元权限码，后端本就不允许）。 */
const codeOptions = computed(() => {
  const set = new Set<string>();
  for (const layers of Object.values(snapshot.value)) {
    for (const code of [...layers.javaDefault, ...layers.dbGrant, ...layers.dbRevoke]) {
      if (!code.startsWith('ipd:role-permission:')) set.add(code);
    }
  }
  return [...set].sort().map((c) => ({ label: `${permissionText(c)}（${c}）`, value: c }));
});

async function submit(): Promise<void> {
  if (!form.personType || !form.permissionCode || !form.remark.trim()) {
    antMessage.warning('请选择角色和权限，并填写调整原因');
    return;
  }
  submitting.value = true;
  try {
    await createRolePermission({
      effect: form.effect,
      permissionCode: form.permissionCode,
      personType: form.personType,
      remark: form.remark.trim(),
    });
    antMessage.success('已保存，立即生效');
    form.permissionCode = '';
    form.remark = '';
    await loadAll();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    submitting.value = false;
  }
}

async function removeRow(row: RolePermissionRow): Promise<void> {
  try {
    await deleteRolePermission(row.id);
    antMessage.success('已删除，该角色恢复系统默认权限');
    await loadAll();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  }
}

const reloading = ref(false);
async function reloadLayer(): Promise<void> {
  reloading.value = true;
  try {
    const r = await reloadRolePermissions();
    antMessage.success(`重新加载完成：${r.grantRoles} 个角色有额外开通，${r.revokeRoles} 个角色有额外禁止`);
    await loadAll();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    reloading.value = false;
  }
}

const columns = [
  { dataIndex: 'personType', key: 'personType', title: '角色', width: 200 },
  { dataIndex: 'permissionCode', key: 'permissionCode', title: '权限' },
  { key: 'effect', title: '调整方式', width: 110 },
  { dataIndex: 'remark', key: 'remark', title: '调整原因', width: 200 },
  { dataIndex: 'createTime', key: 'createTime', title: '创建时间', width: 170 },
  { key: 'action', title: '操作', width: 80 },
];

/** 角色快照卡片摘要。 */
function layers(role: string) {
  return snapshot.value[role];
}
const expanded = ref<Record<string, boolean>>({});
function toggle(role: string): void {
  expanded.value[role] = !expanded.value[role];
}
</script>

<template>
  <div class="p-4">
    <Spin :spinning="phase === 'loading'">
      <template v-if="phase === 'forbidden'">
        <Alert message="本页仅系统超级管理员可访问" show-icon type="warning" />
      </template>
      <template v-else>
        <Alert
          message="这里为各角色单独调整权限：实际可用权限 = 系统默认 + 额外开通 − 额外禁止；没有调整记录时按系统默认执行。保存后立即生效，对新登录的会话起作用。本页面自身的访问权限固定归超级管理员，不在这里调整；部分关键操作另有独立安全校验，也不受本页影响。"
          show-icon
          type="info"
        />

        <Card class="mt-3" title="权限调整记录">
          <template #extra>
            <Space>
              <Button :loading="reloading" @click="reloadLayer">重新加载权限</Button>
              <Button type="primary" @click="loadAll">刷新</Button>
            </Space>
          </template>
          <Alert
            v-if="offline"
            class="mb-3"
            message="服务连接失败，以下为缓存视图；请检查网络后点刷新"
            show-icon
            type="error"
          />
          <Table
            v-if="rows.length"
            :columns="columns"
            :data-source="rows"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'personType'">
                {{ roleText(record.personType) }}
                <span class="ml-1 text-xs text-gray-400">{{ record.personType }}</span>
              </template>
              <template v-else-if="column.key === 'permissionCode'">
                {{ permissionText(record.permissionCode) }}
                <span class="ml-1 text-xs text-gray-400">{{ record.permissionCode }}</span>
              </template>
              <template v-else-if="column.key === 'effect'">
                <Tag :color="record.effect === 'GRANT' ? 'green' : 'red'">
                  {{ record.effect === 'GRANT' ? '额外开通' : '额外禁止' }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'remark'">
                {{ record.remark || PENDING_TEXT }}
              </template>
              <template v-else-if="column.key === 'createTime'">
                {{ record.createTime || PENDING_TEXT }}
              </template>
              <template v-else-if="column.key === 'action'">
                <Popconfirm
                  placement="left"
                  title="删除后该角色恢复系统默认权限，确认？"
                  @confirm="removeRow(record as RolePermissionRow)"
                >
                  <Button danger size="small">删除</Button>
                </Popconfirm>
              </template>
            </template>
          </Table>
          <Empty v-else-if="!offline" description="暂无调整记录 —— 所有角色都按系统默认权限执行" />

          <Form class="mt-4" layout="inline">
            <FormItem label="角色">
              <Select v-model:value="form.personType" :options="roleOptions" placeholder="选择角色" style="width: 200px" />
            </FormItem>
            <FormItem label="权限">
              <Select
                v-model:value="form.permissionCode"
                :options="codeOptions"
                option-filter-prop="label"
                placeholder="输入中文或编码搜索"
                show-search
                style="width: 360px"
              />
            </FormItem>
            <FormItem label="调整方式">
              <RadioGroup v-model:value="form.effect">
                <Radio value="GRANT">额外开通</Radio>
                <Radio value="REVOKE">额外禁止</Radio>
              </RadioGroup>
            </FormItem>
            <FormItem label="调整原因">
              <Input v-model:value="form.remark" placeholder="必填，写清为什么调整" style="width: 220px" />
            </FormItem>
            <FormItem>
              <Button :loading="submitting" type="primary" @click="submit">保存调整</Button>
            </FormItem>
          </Form>
        </Card>

        <Card class="mt-3" title="各角色权限总览（系统默认 / 额外开通 / 额外禁止 / 实际可用）">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card v-for="role in ROLES" :key="role" size="small" :title="`${roleText(role)}（${role}）`">
              <template v-if="layers(role)">
                <Space>
                  <Tag>系统默认 {{ layers(role)!.javaDefault.length }}</Tag>
                  <Tag color="green">额外开通 {{ layers(role)!.dbGrant.length }}</Tag>
                  <Tag color="red">额外禁止 {{ layers(role)!.dbRevoke.length }}</Tag>
                  <Tag color="blue">实际可用 {{ layers(role)!.effective.length }}</Tag>
                  <Button size="small" @click="toggle(role)">
                    {{ expanded[role] ? '收起明细' : '查看权限明细' }}
                  </Button>
                </Space>
                <div v-if="expanded[role]" class="mt-2" style="max-height: 260px; overflow-y: auto">
                  <Tooltip v-for="code in [...layers(role)!.dbGrant].sort()" :key="`g-${code}`" :title="code">
                    <Tag class="mb-1 cursor-help" color="green">+ {{ permissionText(code) }}</Tag>
                  </Tooltip>
                  <Tooltip v-for="code in [...layers(role)!.dbRevoke].sort()" :key="`r-${code}`" :title="code">
                    <Tag class="mb-1 cursor-help" color="red">− {{ permissionText(code) }}</Tag>
                  </Tooltip>
                  <Tooltip v-for="code in layers(role)!.effective" :key="`e-${code}`" :title="code">
                    <Tag class="mb-1 cursor-help">{{ permissionText(code) }}</Tag>
                  </Tooltip>
                </div>
              </template>
              <Empty v-else :image="Empty.PRESENTED_IMAGE_SIMPLE" description="快照未加载" />
            </Card>
          </div>
        </Card>
      </template>
    </Spin>
  </div>
</template>
