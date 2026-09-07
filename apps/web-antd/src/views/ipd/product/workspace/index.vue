<!--
 * 页16-17 产品空间（后端 ProductWorkspaceController GET /api/v1/products/{id}/workspace，
 * 2026-09-06 接入真实数据）。
 *
 * 真值源：ZK-IPD 原型 ClosurePages.jsx ProductWorkspacePage（G1 门禁对照 2026-09-06）。
 * 形态：产品下拉 + 深蓝渐变 hero（4 指标）+ 双列卡（需求主题 / IPD项目·迭代）+ 原始客户反馈。
 * 数据层适配（详见 api/ipd/product-workspace.ts 头注）：
 * - 需求主题与反馈归并（demand-themes）后端未落地：主题区恒空态、反馈行不渲染归并 checkbox、
 *   不渲染「确认归并」按钮；
 * - 产品退市面板（/retirement/readiness）后端未交付：整块不渲染；
 * - hero 的版本/负责人字段后端无载荷：以产品组名 + 产品状态映射呈现；
 * - 「切换并查看」适配：原型切全局当前项目，本项目跳该项目详情页。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';

import { listProductGroups, listProducts } from '../../../../api/ipd/product';
import type { Product } from '../../../../api/ipd/product';
import { fetchProductWorkspace } from '../../../../api/ipd/product-workspace';
import type { ProductWorkspace } from '../../../../api/ipd/product-workspace';
import '../../_shared/ipd-theme.css';

const router = useRouter();

const products = ref<Product[]>([]);
const groups = ref(new Map<string, string>());
const productId = ref('');
const data = ref<null | ProductWorkspace>(null);
const loadError = ref('');
const loading = ref(false);

/** 产品状态 → 原型 lifecycle 展示词（后端无 lifecycle_status，按 listing status 映射）。 */
const PRODUCT_STATUS_TEXT: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  IN_RD: '研发中',
  ON_SALE: '在售',
};

function groupNameOf(id: null | string): string {
  return id ? (groups.value.get(id) ?? '') : '';
}

function statusText(status: string): string {
  return PRODUCT_STATUS_TEXT[status] ?? status;
}

/** 原型 fmt：MM/DD HH:mm。 */
function formatTime(value: null | number | string | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadProducts() {
  try {
    products.value = await listProducts();
    try {
      groups.value = new Map((await listProductGroups()).map((g) => [g.id, g.groupName]));
    } catch {
      groups.value = new Map();
    }
    if (!products.value.some((p) => p.id === productId.value)) {
      productId.value = products.value[0]?.id ?? '';
    }
    if (productId.value) await loadWorkspace();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '产品列表加载失败';
  }
}

async function loadWorkspace() {
  if (!productId.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    data.value = await fetchProductWorkspace(productId.value);
  } catch (error) {
    data.value = null;
    loadError.value = error instanceof Error ? error.message : '产品空间聚合接口加载失败';
    message.error(loadError.value);
  } finally {
    loading.value = false;
  }
}

function onProductChange() {
  loadWorkspace();
}

/** 原型 openProject 适配：进入该项目详情。 */
function openProject(projectId: string) {
  router.push(`/ipd/projects/${projectId}/overview`).catch(() => {});
}

const heroMetrics = computed(() => [
  { label: '原始反馈', value: data.value?.metrics.feedback ?? 0 },
  { label: '需求主题', value: data.value?.metrics.themes ?? 0 },
  { label: '当前迭代', value: data.value?.metrics.activeProjects ?? 0 },
  { label: '历史项目', value: data.value?.metrics.closedProjects ?? 0 },
]);

onMounted(() => {
  loadProducts();
});
</script>

<template>
  <div class="ipd-pw">
    <!-- 页头（原型 Frame：产品空间 + 产品下拉） -->
    <header class="ipd-pw-heading">
      <div>
        <h1>产品空间</h1>
        <p>产品是长期经营对象，可包含多个在研或已结项的IPD项目；项目空间则是其中一次具体立项/迭代。</p>
      </div>
      <div class="ipd-pw-actions">
        <select v-model="productId" data-testid="pw-product-select" @change="onProductChange">
          <option v-for="p in products" :key="p.id" :value="p.id">
            {{ p.modelCode ?? p.productCode }} · {{ p.productName }}
          </option>
        </select>
        <button class="ipd-pw-manage-link" type="button" @click="router.push('/ipd/products/manage')">
          产品管理
        </button>
      </div>
    </header>

    <p v-if="loadError" class="ipd-pw-error">{{ loadError }}</p>

    <!-- 未选中产品（原型 Blank） -->
    <div v-if="!data && !loading" class="ipd-pw-blank">
      <div>▣</div>
      <strong>选择一个产品</strong>
      <p>从产品目录进入长期产品空间。</p>
    </div>

    <template v-else-if="data">
      <!-- 深蓝渐变 hero：产品标识 + 4 指标 -->
      <section class="ipd-pw-hero" data-testid="pw-hero">
        <div>
          <span>{{ data.product.modelCode ?? data.product.productCode }}</span>
          <h2>{{ data.product.productName }}</h2>
          <p>
            {{ groupNameOf(data.product.groupId) || '未分组' }} ·
            {{ statusText(data.product.status) }}
          </p>
        </div>
        <div>
          <span v-for="m in heroMetrics" :key="m.label">
            <strong>{{ m.value }}</strong>
            <small>{{ m.label }}</small>
          </span>
        </div>
      </section>

      <div class="ipd-pw-grid">
        <!-- 需求主题（demand-themes 后端未落地：恒空态） -->
        <section class="ipd-pw-surface">
          <div class="ipd-pw-section-title">
            <h2>需求主题</h2>
            <span>归并能力待后端 demand-themes 交付</span>
          </div>
          <div class="ipd-pw-blank ipd-pw-blank-tight">
            <strong>尚未形成产品需求主题</strong>
            <p>市场PM可将多条相似原始反馈确认归并，避免重复计算。</p>
          </div>
        </section>

        <!-- IPD项目 / 迭代 -->
        <section class="ipd-pw-surface">
          <div class="ipd-pw-section-title">
            <h2>IPD项目 / 迭代</h2>
            <span>{{ data.projects.length }}项 · 点击进入项目详情</span>
          </div>
          <div class="ipd-pw-iterations">
            <article v-for="p in data.projects" :key="p.id" class="ipd-pw-iteration-card">
              <i :class="{ completed: p.status === 'ARCHIVED' }" />
              <div>
                <strong>{{ p.name }}</strong>
                <small>
                  {{ p.code ?? p.id }} ·
                  {{ p.status === 'ARCHIVED' ? '已结项 / 只读' : `${p.currentStage ?? '推进中'} / 可执行` }}
                </small>
              </div>
              <button type="button" @click="openProject(p.id)">切换并查看</button>
            </article>
            <div v-if="data.projects.length === 0" class="ipd-pw-blank ipd-pw-blank-tight">
              <strong>该产品尚无 IPD 项目</strong>
              <p>从项目空间新建项目并绑定该产品后，会显示在这里。</p>
            </div>
          </div>
        </section>
      </div>

      <!-- 原始客户反馈（无归并 checkbox：后端无 theme 归并接口） -->
      <section class="ipd-pw-surface ipd-pw-feedback" data-testid="pw-feedback">
        <div class="ipd-pw-section-title">
          <h2>原始客户反馈</h2>
          <span>每条反馈只归入一个主题</span>
        </div>
        <div v-for="d in data.demands" :key="d.id" class="ipd-pw-feedback-row">
          <span>
            <strong>#{{ d.id }} · {{ d.customerName ?? '未指定客户' }}</strong>
            <p>{{ d.title ?? '—' }}</p>
            <small>{{ formatTime(d.createdAt) }}</small>
          </span>
        </div>
        <div v-if="data.demands.length === 0" class="ipd-pw-blank ipd-pw-blank-tight">
          <strong>暂无原始客户反馈</strong>
          <p>需求管理页中归属该产品的需求会同步显示在这里。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>


/* V12-F3: 原 1000px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .ipd-pw-grid {
    grid-template-columns: 1fr;
  }

  .ipd-pw-hero {
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
  }

  .ipd-pw-hero > div:last-child {
    flex-wrap: wrap;
  }
}

.ipd-pw {
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
}

/* .page-heading */
.ipd-pw-heading {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}

.ipd-pw-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  letter-spacing: -0.02em;
}

.ipd-pw-heading p {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
}

.ipd-pw-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ipd-pw-actions select {
  min-width: 240px;
  height: 36px;
  padding: 0 9px;
  font-size: 13px;
  color: var(--ipd-text, #172033);
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
}

.ipd-pw-manage-link {
  height: 36px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ipd-blue, #245bf4);
  cursor: pointer;
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
}

.ipd-pw-error {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--ipd-red, #e45757);
}

/* .product-space-hero：深蓝渐变 */
.ipd-pw-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px;
  color: #fff;
  background: linear-gradient(130deg, #112f54, #1f5486);
  border-radius: 8px;
}

.ipd-pw-hero h2 {
  margin: 5px 0;
  font-size: 24px;
  font-weight: 700;
}

.ipd-pw-hero p,
.ipd-pw-hero span {
  color: #bfd0e4;
}

.ipd-pw-hero p {
  margin: 0;
  font-size: 13px;
}

.ipd-pw-hero > div:last-child {
  display: flex;
  gap: 26px;
}

.ipd-pw-hero > div:last-child span {
  text-align: center;
}

.ipd-pw-hero > div:last-child strong,
.ipd-pw-hero > div:last-child small {
  display: block;
}

.ipd-pw-hero > div:last-child strong {
  font-size: 22px;
  color: #fff;
}

.ipd-pw-hero > div:last-child small {
  font-size: 12px;
}

/* .product-space-grid：1.15fr .85fr */
.ipd-pw-grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 18px;
  margin-top: 18px;
}

.ipd-pw-surface {
  padding: 20px;
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

/* .section-title（卡内标题） */
.ipd-pw-section-title {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 14px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--ipd-line, #dfe4ed);
}

.ipd-pw-section-title h2 {
  margin: 0;
  font-size: 15px;
  color: var(--ipd-text, #172033);
}

.ipd-pw-section-title > span {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

/* .theme-card / .iteration-card */
.ipd-pw-iteration-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 13px 0;
  border-bottom: 1px solid #edf0f4;
}

.ipd-pw-iteration-card > div {
  flex: 1;
  min-width: 0;
}

.ipd-pw-iteration-card strong,
.ipd-pw-iteration-card small {
  display: block;
}

.ipd-pw-iteration-card strong {
  font-size: 13px;
  color: var(--ipd-text, #172033);
}

.ipd-pw-iteration-card small {
  margin-top: 3px;
  font-size: 12px;
  color: #8a96a5;
}

.ipd-pw-iteration-card > i {
  flex: none;
  width: 10px;
  height: 10px;
  background: #efa63b;
  border-radius: 50%;
}

.ipd-pw-iteration-card > i.completed {
  background: #2d9b70;
}

.ipd-pw-iteration-card > button {
  padding: 7px 10px;
  font-size: 12px;
  color: #285f92;
  white-space: nowrap;
  cursor: pointer;
  background: #f8fbff;
  border: 1px solid #cdd9e6;
  border-radius: 7px;
}

/* .raw-feedback */
.ipd-pw-feedback {
  margin-top: 18px;
}

.ipd-pw-feedback-row {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #edf0f4;
}

.ipd-pw-feedback-row:last-of-type {
  border-bottom: 0;
}

.ipd-pw-feedback-row span {
  flex: 1;
  min-width: 0;
}

.ipd-pw-feedback-row strong {
  font-size: 13px;
  color: var(--ipd-text, #172033);
}

.ipd-pw-feedback-row p {
  margin: 4px 0;
  font-size: 12px;
  line-height: 1.55;
  color: #5f6e80;
}

.ipd-pw-feedback-row small {
  font-size: 11px;
  color: #8693a4;
}

/* Blank 空态 */
.ipd-pw-blank {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 220px;
  padding: 20px;
  color: var(--ipd-muted, #697388);
  text-align: center;
}

.ipd-pw-blank-tight {
  min-height: 120px;
}

.ipd-pw-blank > div {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
  font-size: 26px;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 50%;
}

.ipd-pw-blank strong {
  margin: 8px 0 4px;
  font-size: 14px;
  color: var(--ipd-text, #172033);
}

.ipd-pw-blank p {
  max-width: 380px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

/* ============================================================================
 * 产品空间视觉对齐 —— 真值源：ZK-IPD 原型 styles.css 262 行（hero 渐变/双列/卡片）
 * ============================================================================ */
</style>
