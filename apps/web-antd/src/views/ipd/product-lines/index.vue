<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Input, Popconfirm, Select, Space, message } from 'ant-design-vue';

import type { ProductLine, ProductLineDemand, ProductLineMember, ProductLineProduct, ProductLineProject } from '../../../api/ipd/product-line';
import {
  applyToProductLine,
  appointProductLineLeader,
  assignProductToLine,
  createProductLine,
  deactivateProductLine,
  leaveProductLine,
  listDiscoverableProductLines,
  listPendingProductLineApplications,
  listProductLineDemands,
  listProductLineProducts,
  listProductLineProjects,
  listProductLines,
  renameProductLine,
  reviewProductLineApplication,
  retryProductLineDemandTriage,
  unassignProductFromLine,
} from '../../../api/ipd/product-line';
import type { Product } from '../../../api/ipd/product';
import { listProducts } from '../../../api/ipd/product';
import type { PmDirectoryEntry } from '../../../api/ipd/handover';
import { getPmDirectory } from '../../../api/ipd/handover';
import { approveProjectStart, rejectProjectStart, resubmitProjectStart } from '../../../api/ipd/project';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import '../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const lines = ref<ProductLine[]>([]);
const discoverableLines = ref<ProductLine[]>([]);
const selectedId = ref('');
const products = ref<ProductLineProduct[]>([]);
const projects = ref<ProductLineProject[]>([]);
const demands = ref<ProductLineDemand[]>([]);
const applications = ref<ProductLineMember[]>([]);
const loading = ref(false);
const detailLoading = ref(false);
const applicationsLoading = ref(false);
const error = ref('');
const detailError = ref('');
const applicationsError = ref('');
const createCode = ref('');
const createName = ref('');
const creating = ref(false);
const reviewingId = ref('');
const acting = ref(false);
const candidateProducts = ref<Product[]>([]);
const directory = ref<PmDirectoryEntry[]>([]);
const assignProductId = ref('');
const leaderPersonId = ref('');
const renameName = ref('');
const adminDataError = ref('');
const pendingApplyIds = ref(new Set<string>());
let detailVersion = 0;
let lineLoadVersion = 0;

const isAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');
const personId = computed(() => auth.identity?.person.id ?? '');
const selected = computed(() => lines.value.find((line) => line.id === selectedId.value));
const canReview = computed(() => isAdmin.value || selected.value?.leaderPersonId === personId.value);
const productCounts = computed(() => ({
  onSale: products.value.filter((product) => product.status === 'ON_SALE').length,
  inResearch: products.value.filter((product) => product.status === 'IN_RD').length,
  other: products.value.filter((product) => !['ON_SALE', 'IN_RD'].includes(product.status ?? '')).length,
}));
const productStatusLabels: Record<string, string> = { ON_SALE: '在售', IN_RD: '在研', INACTIVE: '已停用', ACTIVE: '状态待核实' };
const productStatusText = (status?: string) => productStatusLabels[status ?? ''] ?? '状态待核实';
const triageProject = computed(() => projects.value.find((project) => project.code === 'PRJ-2026-900') ?? null);
const canDecideStart = computed(() => {
  const leader = selected.value?.leaderPersonId;
  if (!leader) return isAdmin.value;
  return leader === personId.value;
});
const joinableLines = computed(() => discoverableLines.value.filter((line) =>
  !lines.value.some((visible) => visible.id === line.id)));

async function loadAdminCandidates(version: number) {
  if (!isAdmin.value) return;
  adminDataError.value = '';
  try {
    const [allProducts, directoryResult, lineProducts] = await Promise.all([
      listProducts(),
      getPmDirectory(),
      Promise.all(lines.value.map((line) => listProductLineProducts(line.id))),
    ]);
    if (version !== lineLoadVersion) return;
    const assigned = new Set(lineProducts.flat().map((product) => product.id));
    candidateProducts.value = allProducts.filter((product) => !assigned.has(product.id));
    directory.value = directoryResult.directory ?? [];
  } catch (cause) {
    if (version !== lineLoadVersion) return;
    candidateProducts.value = [];
    directory.value = [];
    adminDataError.value = cause instanceof Error ? cause.message : '管理候选数据加载失败';
  }
}

async function loadLines(preferredId?: string) {
  const version = ++lineLoadVersion;
  ++detailVersion;
  loading.value = true;
  error.value = '';
  try {
    const [visible, discoverable] = await Promise.all([listProductLines(), listDiscoverableProductLines()]);
    if (version !== lineLoadVersion) return;
    lines.value = visible;
    discoverableLines.value = discoverable;
    selectedId.value = lines.value.some((line) => line.id === preferredId)
      ? (preferredId ?? '')
      : (lines.value[0]?.id ?? '');
    await loadAdminCandidates(version);
    if (version !== lineLoadVersion) return;
    await loadDetail();
  } catch (cause) {
    if (version !== lineLoadVersion) return;
    lines.value = [];
    discoverableLines.value = [];
    selectedId.value = '';
    error.value = cause instanceof Error ? cause.message : '产品线空间接口暂不可用';
  } finally {
    if (version === lineLoadVersion) loading.value = false;
  }
}

async function loadApplications(lineId = selectedId.value, version = detailVersion) {
  applications.value = [];
  applicationsError.value = '';
  applicationsLoading.value = false;
  if (!lineId || !canReview.value) return;
  applicationsLoading.value = true;
  try {
    const nextApplications = await listPendingProductLineApplications(lineId);
    if (version === detailVersion) applications.value = nextApplications;
  } catch (cause) {
    if (version === detailVersion) {
      applicationsError.value = cause instanceof Error ? cause.message : '待审批申请加载失败';
    }
  } finally {
    if (version === detailVersion) applicationsLoading.value = false;
  }
}

async function loadDetail() {
  const version = ++detailVersion;
  const lineId = selectedId.value;
  products.value = [];
  projects.value = [];
  demands.value = [];
  detailError.value = '';
  detailLoading.value = false;
  void loadApplications(lineId, version);
  if (!lineId) return;
  renameName.value = selected.value?.name ?? '';
  leaderPersonId.value = selected.value?.leaderPersonId ?? '';
  detailLoading.value = true;
  try {
    const [nextProducts, nextProjects, nextDemands] = await Promise.all([
      listProductLineProducts(lineId),
      listProductLineProjects(lineId),
      listProductLineDemands(lineId),
    ]);
    if (version !== detailVersion) return;
    products.value = nextProducts;
    projects.value = nextProjects;
    demands.value = nextDemands;
  } catch (cause) {
    if (version === detailVersion) detailError.value = cause instanceof Error ? cause.message : '空间目录加载失败';
  } finally {
    if (version === detailVersion) detailLoading.value = false;
  }
}

async function perform(action: () => Promise<unknown>, success: string, preferredId = selectedId.value) {
  acting.value = true;
  try {
    await action();
    message.success(success);
    await loadLines(preferredId);
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

async function apply(lineId: string) {
  acting.value = true;
  try {
    const result = await applyToProductLine(lineId);
    if (result.status === 'PENDING') pendingApplyIds.value = new Set([...pendingApplyIds.value, lineId]);
    message.success(result.status === 'ACTIVE' ? '已是空间成员' : '加入申请已提交');
    await loadLines(selectedId.value);
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '申请失败');
  } finally {
    acting.value = false;
  }
}

async function create() {
  if (!isAdmin.value || !createCode.value.trim() || !createName.value.trim()) return;
  creating.value = true;
  try {
    const created = await createProductLine(createCode.value.trim(), createName.value.trim());
    createCode.value = '';
    createName.value = '';
    message.success('产品线已创建');
    await loadLines(created.id);
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '创建失败');
  } finally {
    creating.value = false;
  }
}

async function review(application: ProductLineMember, approve: boolean) {
  if (!canReview.value || !selectedId.value) return;
  reviewingId.value = application.personId;
  try {
    await reviewProductLineApplication(selectedId.value, application.personId, approve);
    message.success(approve ? '已批准申请' : '已拒绝申请');
    await loadDetail();
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '审批失败');
  } finally {
    reviewingId.value = '';
  }
}

onMounted(() => { void loadLines(); });
</script>

<template>
  <main class="ipd-line-page">
    <header>
      <h1>产品线</h1>
      <p>这里汇总该产品线下的产品和项目。负责人能看本线全部项目；要改阶段、改产物或发起项目智能体，仍须先成为该项目成员。</p>
    </header>
    <div v-if="error">
      <Alert type="error" show-icon :message="`空间接口暂不可用：${error}`" />
      <Button :loading="loading" @click="loadLines()">重试加载空间</Button>
    </div>
    <Alert v-else-if="!loading && lines.length === 0 && !joinableLines.length" type="info" show-icon message="暂无可见或可申请的产品线空间。" />
    <Card v-if="joinableLines.length" title="申请加入团队空间" size="small">
      <div v-for="line in joinableLines" :key="line.id" class="ipd-line-application">
        <span>{{ line.name }}（{{ line.code }}）</span>
        <Button :disabled="acting || pendingApplyIds.has(line.id)" @click="apply(line.id)">
          {{ pendingApplyIds.has(line.id) ? '本次申请待审批' : '申请加入' }}
        </Button>
      </div>
      <p>申请状态以服务端审批为准；当前列表接口只返回已加入空间。</p>
    </Card>
    <div v-if="isAdmin" class="ipd-line-create">
      <h2>创建产品线</h2>
      <Space wrap>
        <Input v-model:value="createCode" aria-label="产品线编码" placeholder="编码（字母、数字、短横线）" :maxlength="64" />
        <Input v-model:value="createName" aria-label="产品线名称" placeholder="名称" :maxlength="128" />
        <Button type="primary" :loading="creating" :disabled="!createCode.trim() || !createName.trim()" @click="create">创建</Button>
      </Space>
      <p>管理员可维护当前空间；组长候选从在职人员目录选择，服务端仍校验其空间成员资格。</p>
    </div>
    <div v-if="lines.length" class="ipd-line-layout">
      <nav aria-label="产品线列表" class="ipd-line-list">
        <button v-for="line in lines" :key="line.id" type="button" :aria-current="selectedId === line.id ? 'page' : undefined" @click="selectedId = line.id; loadDetail()">
          <strong>{{ line.name }}</strong><small>{{ line.code }}</small>
        </button>
      </nav>
      <section v-if="selected" aria-label="产品线详情" class="ipd-line-detail">
        <h2>{{ selected.name }}</h2>
        <p>组长 Person ID：{{ selected.leaderPersonId ?? '未任命' }}</p>
        <Button v-if="!isAdmin" :disabled="acting" @click="perform(() => leaveProductLine(selectedId), '已退出产品线空间')">退出空间</Button>
        <Card v-if="isAdmin" title="空间管理" size="small">
          <div class="ipd-line-controls">
            <Space wrap>
              <Input v-model:value="renameName" aria-label="新产品线名称" :maxlength="128" placeholder="产品线名称" />
              <Button :disabled="acting || !renameName.trim() || renameName.trim() === selected.name" @click="perform(() => renameProductLine(selectedId, renameName.trim()), '名称已更新')">保存名称</Button>
              <Popconfirm title="确认停用此产品线？停用前需清空关联产品和待审批申请。" @confirm="perform(() => deactivateProductLine(selectedId), '产品线已停用')">
                <Button danger :disabled="acting || products.length > 0 || applications.length > 0">停用空间</Button>
              </Popconfirm>
            </Space>
            <Space wrap>
              <Select v-model:value="leaderPersonId" aria-label="选择产品线组长" class="ipd-line-select" :options="directory.map((person) => ({ value: person.id, label: `${person.name}（${person.employeeNo ?? person.id}）` }))" placeholder="选择在职人员" />
              <Button :disabled="acting || !leaderPersonId || leaderPersonId === selected.leaderPersonId" @click="perform(() => appointProductLineLeader(selectedId, leaderPersonId), '组长已更新')">任命组长</Button>
            </Space>
            <Space wrap>
              <Select v-model:value="assignProductId" aria-label="选择待分配产品" class="ipd-line-select" :options="candidateProducts.map((product) => ({ value: product.id, label: `${product.productName}（${product.productCode}）` }))" placeholder="待分配产品" />
              <Button :disabled="acting || !assignProductId || !!adminDataError" @click="perform(() => assignProductToLine(selectedId, assignProductId), '产品归属已更新')">分配到此空间</Button>
            </Space>
            <div v-if="adminDataError">
              <Alert type="warning" show-icon :message="`管理候选暂不可用：${adminDataError}`" />
              <Button @click="loadAdminCandidates(lineLoadVersion)">重试加载候选</Button>
            </div>
          </div>
        </Card>
        <div v-if="detailError">
          <Alert type="error" show-icon :message="detailError" />
          <Button :loading="detailLoading" @click="loadDetail">重试加载目录</Button>
        </div>
        <p v-if="detailLoading" role="status">空间目录加载中…</p>
        <template v-else-if="!detailError">
          <Card title="产品目录" size="small">
            <p aria-label="产品线经营汇总">在售 {{ productCounts.onSale }} 个，在研 {{ productCounts.inResearch }} 个，其他状态 {{ productCounts.other }} 个；需求反馈 {{ demands.length }} 条，可见项目 {{ projects.length }} 个。</p>
            <p v-if="!products.length">暂无归属该产品线的产品。</p>
            <ul v-else><li v-for="product in products" :key="product.id">
              {{ product.name }}（{{ product.code }}）— {{ productStatusText(product.status) }}
              <Popconfirm v-if="isAdmin" title="确认解除产品线归属？仅停用且无活动项目的产品可解除。" @confirm="perform(() => unassignProductFromLine(selectedId, product.id), '已解除产品线归属')">
                <Button size="small" danger :disabled="acting">解除归属</Button>
              </Popconfirm>
            </li></ul>
          </Card>
          <Card title="需求反馈" size="small">
            <p v-if="!demands.length">还没有写到本产品线的需求。未指定产品线会同时列出尚未绑定产品线的需求。</p>
            <ul v-else>
              <li v-for="demand in demands" :key="demand.id">
                {{ demand.title || '未命名需求' }}（{{ demand.status }}）
                <span v-if="demand.triage">{{ demand.triage.message }}</span>
                <Button v-if="canReview && demand.triage?.retryable" size="small" :disabled="acting" @click="perform(() => retryProductLineDemandTriage(selectedId, demand.id), '已重试分拣')">重试分拣</Button>
                <RouterLink v-if="triageProject && demand.triage?.runId" :to="`/ipd/ai-assistant?projectId=${triageProject.id}`">查看分拣历史</RouterLink>
                <RouterLink v-if="triageProject" :to="`/ipd/projects/${triageProject.id}/flow?requirementId=${demand.id}`">用项目智能体理解</RouterLink>
              </li>
            </ul>
          </Card>
          <Card title="本产品线项目" size="small">
            <p v-if="!projects.length">暂无可见项目。未开工的项目只有创建人、产品线负责人和系统管理员能看见。</p>
            <ul v-else><li v-for="project in projects" :key="project.id">
              <RouterLink :to="`/ipd/projects/${project.id}/overview`">{{ project.name }}</RouterLink>
              （{{ project.status === 'PENDING_START' ? '待开工' : project.status === 'START_REJECTED' ? '开工已拒绝' : (project.currentStage ?? '阶段待定') }}）
              <Space v-if="project.status === 'PENDING_START' && canDecideStart">
                <Button size="small" :disabled="acting" @click="perform(() => approveProjectStart(project.id), '已批准开工')">批准开工</Button>
                <Button size="small" danger :disabled="acting" @click="perform(() => rejectProjectStart(project.id), '已拒绝开工')">拒绝开工</Button>
              </Space>
              <Button v-if="project.status === 'START_REJECTED'" size="small" :disabled="acting" @click="perform(() => resubmitProjectStart(project.id), '已再次提交')">再次提交</Button>
            </li></ul>
          </Card>
          <Card v-if="canReview" title="待审批加入申请" size="small">
            <div v-if="applicationsError">
              <Alert type="error" show-icon :message="`待审批申请暂不可用：${applicationsError}`" />
              <Button :loading="applicationsLoading" @click="loadApplications()">重试加载申请</Button>
            </div>
            <p v-else-if="applicationsLoading" role="status">待审批申请加载中…</p>
            <p v-else-if="!applications.length">暂无待审批申请。</p>
            <div v-for="application in applications" :key="application.personId" class="ipd-line-application">
              <span>申请人 Person ID：{{ application.personId }}</span>
              <Space>
                <Button size="small" :loading="reviewingId === application.personId" @click="review(application, true)">批准</Button>
                <Button size="small" danger :disabled="!!reviewingId" @click="review(application, false)">拒绝</Button>
              </Space>
            </div>
          </Card>
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped>
.ipd-line-page { max-width: 1280px; margin: auto; padding: 28px 32px 60px; display: grid; gap: 18px; }
.ipd-line-page h1 { font-size: 24px; font-weight: 600; }
.ipd-line-page h2 { font-size: 18px; font-weight: 600; }
.ipd-line-create, .ipd-line-detail { display: grid; gap: 12px; }
.ipd-line-controls { display: grid; gap: 12px; }
.ipd-line-select { min-width: 220px; }
.ipd-line-create p, .ipd-line-page header p { color: var(--ipd-muted); }
.ipd-line-layout { display: grid; grid-template-columns: minmax(180px, 250px) minmax(0, 1fr); gap: 20px; }
.ipd-line-list { display: grid; align-content: start; gap: 8px; }
.ipd-line-list button { text-align: left; border: 1px solid var(--ipd-line); border-radius: 8px; background: var(--ipd-bg); padding: 12px; cursor: pointer; }
.ipd-line-list button[aria-current='page'] { outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color); }
.ipd-line-list small { display: block; color: var(--ipd-muted); }
.ipd-line-application { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; }
@media (max-width: 768px) { .ipd-line-layout { grid-template-columns: 1fr; } .ipd-line-page { padding: 20px 16px; } .ipd-line-select { min-width: 180px; } }
</style>
