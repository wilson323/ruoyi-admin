<!--
 * 页41 产品目录〔超管〕（后端 ProductController GET /api/v1/products，2026-09-06 接入真实数据）。
 *
 * 真值源：ZK-IPD 原型 App.jsx ProductCatalogPage（G1 门禁对照 2026-09-06）。
 * 形态：catalog-grid（Excel导入 + 最近批次）+ 产品主数据表（型号/产品、产品线、版本、
 * 市场PM、生命周期、最近更新）。
 * 数据层适配（后端差距，不假绿）：
 * - Excel 导入三步流（/api/admin/products/import-preview|import-confirm）后端未交付：
 *   导入区 UI 一比一复刻，文件可选中，「预校验差异」按钮禁用并提示；
 * - 最近批次（导入批次列表）后端无载荷：展示 0 个空态；
 * - 产品线=产品组名（groupId 映射）；版本/市场PM/最近更新后端无载荷，按原型空值词展示
 *   （版本「—」、市场PM「待匹配」、更新「—」）；生命周期按产品状态映射。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CloudDownloadOutlined, LockOutlined } from '@ant-design/icons-vue';

import { listProductGroups, listProducts } from '../../../../api/ipd/product';
import type { Product } from '../../../../api/ipd/product';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import '../../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');

const products = ref<Product[]>([]);
const groups = ref(new Map<string, string>());
const loadError = ref('');
const fileChosen = ref('');

/** 产品状态 → 原型 lifecycle 展示词。 */
const LIFECYCLE_TEXT: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  IN_RD: '研发中',
  ON_SALE: '在售',
};
/** pill 色调沿用原型 lifecycle 色系（在售绿/研发蓝/停用红/启用绿）。 */
const LIFECYCLE_TONE: Record<string, string> = {
  ACTIVE: 'green',
  INACTIVE: 'red',
  IN_RD: 'blue',
  ON_SALE: 'green',
};

function groupNameOf(id: null | string): string {
  return id ? (groups.value.get(id) ?? '') : '—';
}
function lifecycleText(status: string): string {
  return LIFECYCLE_TEXT[status] ?? status;
}
function lifecycleTone(status: string): string {
  return LIFECYCLE_TONE[status] ?? 'gray';
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  fileChosen.value = input.files?.[0]?.name ?? '';
}

onMounted(async () => {
  if (!isSuperAdmin.value) return;
  try {
    products.value = await listProducts();
    groups.value = new Map((await listProductGroups()).map((g) => [g.id, g.groupName]));
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '产品主数据加载失败';
  }
});
</script>

<template>
  <div class="ipd-cat">
    <template v-if="isSuperAdmin">
      <!-- 页头（原型 PageFrame：产品目录） -->
      <header class="ipd-cat-heading">
        <div>
          <h1>产品目录</h1>
          <p>产品档案独立于项目长期存在，按产品型号幂等更新；缺失行不会自动删除。</p>
        </div>
      </header>

      <div class="ipd-cat-grid">
        <!-- Excel导入（三步流后端未交付：按钮禁用并如实提示） -->
        <section class="ipd-cat-surface ipd-cat-import">
          <div class="ipd-cat-section-title">
            <h2>Excel导入</h2>
            <span>上传 → 预校验 → 确认</span>
          </div>
          <div class="ipd-cat-drop">
            <CloudDownloadOutlined />
            <strong>选择产品目录.xlsx</strong>
            <small>固定字段：产品型号、产品名称、产品线、当前版本、市场PM工号、状态</small>
            <label class="ipd-cat-file">
              选择文件
              <input accept=".xlsx" disabled type="file" @change="onFileChange" />
            </label>
            <span v-if="fileChosen" class="ipd-cat-file-name">{{ fileChosen }}</span>
            <button
              class="ipd-cat-primary"
              disabled
              title="Excel 导入预校验/确认接口（/api/admin/products/import-*）后端未交付，暂不可用"
              type="button"
            >
              预校验差异
            </button>
            <small class="ipd-cat-note">导入接口未交付：当前产品档案可在「产品管理」中维护。</small>
          </div>
        </section>

        <!-- 最近批次（后端无批次载荷：空态） -->
        <section class="ipd-cat-surface ipd-cat-history">
          <div class="ipd-cat-section-title">
            <h2>最近批次</h2>
            <span>0 个</span>
          </div>
          <p class="ipd-cat-history-empty">导入批次记录待后端交付后展示。</p>
        </section>
      </div>

      <!-- 产品主数据（真实 GET /products） -->
      <section class="ipd-cat-surface ipd-cat-tablewrap">
        <div class="ipd-cat-section-title">
          <h2>产品主数据</h2>
          <span>{{ products.length }} 个产品</span>
        </div>
        <p v-if="loadError" class="ipd-cat-error">{{ loadError }}</p>
        <div v-else class="ipd-cat-table" data-testid="catalog-table">
          <div class="ipd-cat-row head">
            <span>型号 / 产品</span>
            <span>产品线</span>
            <span>版本</span>
            <span>市场PM</span>
            <span>生命周期</span>
            <span>最近更新</span>
          </div>
          <div v-for="p in products" :key="p.id" class="ipd-cat-row">
            <span>
              <strong>{{ p.modelCode ?? p.productCode }}</strong>
              <small>{{ p.productName }}</small>
            </span>
            <span>{{ groupNameOf(p.groupId) }}</span>
            <span>—</span>
            <span>待匹配</span>
            <span>
              <i :class="lifecycleTone(p.status)" class="ipd-cat-pill">{{ lifecycleText(p.status) }}</i>
            </span>
            <span>—</span>
          </div>
          <div v-if="products.length === 0" class="ipd-cat-table-empty">
            暂无产品档案；可在「产品管理」中新增，或等待 Excel 导入接口交付。
          </div>
        </div>
      </section>
    </template>

    <!-- 非超管（原型 LockKey Empty） -->
    <template v-else>
      <header class="ipd-cat-heading">
        <div>
          <h1>产品目录</h1>
        </div>
      </header>
      <div class="ipd-cat-blank">
        <div><LockOutlined /></div>
        <strong>没有产品目录权限</strong>
        <p>产品档案由超级管理员通过Excel统一导入。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ============================================================================
 * 产品目录视觉对齐 —— 真值源：ZK-IPD 原型 styles.css 245 行（catalog/drop-upload）
 *                                                                        + 189-191（表格/pill）
 * ============================================================================ */

.ipd-cat {
  padding: 28px 32px 60px;
  max-width: 1600px;
  margin: auto;
}
.ipd-cat-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}
.ipd-cat-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  letter-spacing: -0.02em;
  color: var(--ipd-text, #172033);
  font-weight: 700;
}
.ipd-cat-heading p {
  margin: 0;
  color: var(--ipd-muted, #697388);
  font-size: 13px;
}

/* .catalog-grid：1.25fr .75fr */
.ipd-cat-grid {
  display: grid;
  grid-template-columns: 1.25fr 0.75fr;
  gap: 16px;
  margin-bottom: 16px;
}
.ipd-cat-surface {
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  overflow: hidden;
}
.ipd-cat-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ipd-line, #dfe4ed);
}
.ipd-cat-section-title h2 {
  margin: 0;
  font-size: 15px;
  color: var(--ipd-text, #172033);
}
.ipd-cat-section-title > span {
  color: var(--ipd-muted, #697388);
  font-size: 12px;
}

/* .drop-upload */
.ipd-cat-drop {
  margin: 18px;
  padding: 24px;
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
  border: 1px dashed #b9c7da;
  border-radius: 8px;
  background: #f8faff;
}
.ipd-cat-drop > svg {
  font-size: 42px;
  color: var(--ipd-blue, #245bf4);
}
.ipd-cat-drop strong {
  color: var(--ipd-text, #172033);
  font-size: 14px;
}
.ipd-cat-drop small {
  color: var(--ipd-muted, #697388);
}
.ipd-cat-file {
  cursor: pointer;
  border: 1px solid var(--ipd-line, #dfe4ed);
  background: white;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--ipd-text, #172033);
}
.ipd-cat-file input {
  display: none;
}
.ipd-cat-file-name {
  font-size: 12px;
  color: var(--ipd-blue, #245bf4);
}
.ipd-cat-primary {
  border: 0;
  background: var(--ipd-blue, #245bf4);
  color: white;
  border-radius: 6px;
  height: 38px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.ipd-cat-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ipd-cat-note {
  font-size: 11px;
  color: #a13f3f;
}

/* .import-history 空态 */
.ipd-cat-history-empty {
  margin: 0;
  padding: 26px 20px;
  color: var(--ipd-muted, #697388);
  font-size: 12px;
  text-align: center;
}

/* .business-table .product-table：1.3fr 1fr .6fr .8fr .6fr .8fr */
.ipd-cat-table {
  overflow-x: auto;
}
.ipd-cat-row {
  min-width: 860px;
  min-height: 64px;
  display: grid;
  grid-template-columns: 1.3fr 1fr 0.6fr 0.8fr 0.6fr 0.8fr;
  gap: 14px;
  align-items: center;
  padding: 10px 20px;
  border-bottom: 1px solid #edf0f3;
  font-size: 12px;
  color: var(--ipd-text, #172033);
}
.ipd-cat-row.head {
  min-height: 40px;
  color: var(--ipd-muted, #697388);
  background: #f7f8fa;
  font-weight: 700;
}
.ipd-cat-row > span:first-child {
  display: grid;
  gap: 4px;
}
.ipd-cat-row strong {
  font-size: 13px;
}
.ipd-cat-row small {
  color: var(--ipd-muted, #697388);
}
.ipd-cat-table-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--ipd-muted, #697388);
  font-size: 12px;
}
.ipd-cat-error {
  margin: 0;
  padding: 16px 20px;
  color: var(--ipd-red, #e45757);
  font-size: 12px;
}

/* .status-pill */
.ipd-cat-pill {
  display: inline-flex;
  width: fit-content;
  padding: 4px 7px;
  border-radius: 4px;
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.ipd-cat-pill.green {
  color: var(--ipd-green, #2f9e52);
  background: #eaf7ed;
}
.ipd-cat-pill.blue {
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
}
.ipd-cat-pill.red {
  color: #a33c3c;
  background: #ffeded;
}
.ipd-cat-pill.gray {
  color: #58657b;
  background: #eef1f5;
}

/* 权限空态 */
.ipd-cat-blank {
  min-height: 260px;
  display: grid;
  place-content: center;
  justify-items: center;
  text-align: center;
  color: var(--ipd-muted, #697388);
}
.ipd-cat-blank > div {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 50%;
  font-size: 26px;
}
.ipd-cat-blank strong {
  color: var(--ipd-text, #172033);
  margin: 12px 0 4px;
  font-size: 14px;
}
.ipd-cat-blank p {
  margin: 0;
  max-width: 380px;
  font-size: 12px;
  line-height: 1.6;
}

/* V12-F3: 原 1050px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .ipd-cat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
