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
 * - 产品线从独立的产品线空间接口回读；不以组织产品组代替。
 *   接口不可用时显示未知，不把未核实归属写成待分配。
 *   （版本「—」、市场PM「待匹配」、更新「—」）；生命周期按产品状态映射。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CloudDownloadOutlined, LockOutlined } from '@ant-design/icons-vue';
import { Button, Input, Modal, message as antMessage } from 'ant-design-vue';

import { changeProductStatus, listProducts } from '../../../../api/ipd/product';
import { fetchProductRetirement, submitProductRetirement } from '../../../../api/ipd/product-retirement';
import { listProductLineProducts, listProductLines } from '../../../../api/ipd/product-line';
import type { Product, ProductStatus } from '../../../../api/ipd/product';
import { IpdRequestError } from '../../../../api/ipd/auth';
import AiSuggest from '../../_shared/ai-suggest.vue';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import '../../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const router = useRouter();
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');

const products = ref<Product[]>([]);
const productLineNames = ref(new Map<string, string>());
const productLineAvailable = ref(false);
const productLineError = ref('');
const loadError = ref('');
const fileChosen = ref('');

/** 行级操作进行中标记：`status:<id>` / `retire:<id>`，避免同一行并发写。 */
const rowBusy = ref('');
/** 申请下架弹窗的目标产品；null = 未打开。 */
const retireTarget = ref<Product | null>(null);
const retireReason = ref('');
const retireSubmitting = ref(false);

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

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

function productLineNameOf(productId: string): string {
  if (!productLineAvailable.value) return '归属暂不可核实';
  return productLineNames.value.get(productId) ?? '待分配';
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

/** L2 AI 入口 adopt 回传（C08 零直写）：建议仅落本地暂存提示，由真人复核后走既有端点手动操作。 */
const adoptedAi = ref<{ markdown: string; scene: string } | null>(null);
function onAiAdopt(payload: { markdown: string; scene: string }): void {
  adoptedAi.value = payload;
}

onMounted(load);

/** 重新拉取产品主数据；写操作成功后调用以刷新列表与生命周期。 */
async function load(): Promise<void> {
  if (!isSuperAdmin.value) return;
  try {
    products.value = await listProducts();
    loadError.value = '';
  } catch (error) {
    loadError.value = rejectText(error);
  }
  try {
    const lines = await listProductLines();
    const memberships = await Promise.all(lines.map(async (line) => ({
      line,
      products: await listProductLineProducts(line.id),
    })));
    productLineNames.value = new Map(memberships.flatMap(({ line, products }) =>
      products.map((product) => [product.id, line.name] as const)));
    productLineAvailable.value = true;
    productLineError.value = '';
  } catch (error) {
    productLineError.value = rejectText(error);
  }
}

async function goCreate(): Promise<void> {
  try {
    await router.push('/ipd/products/create');
  } catch (err: unknown) {
    antMessage.error(`导航失败: ${rejectText(err)}`);
  }
}

async function goEdit(record: Product): Promise<void> {
  try {
    await router.push(`/ipd/products/${encodeURIComponent(record.id)}/edit`);
  } catch (err: unknown) {
    antMessage.error(`导航失败: ${rejectText(err)}`);
  }
}

/** 启用 / 停用。与产品管理页同口径：INACTIVE ↔ IN_RD。 */
async function toggleStatus(record: Product): Promise<void> {
  if (rowBusy.value) return;
  const next: ProductStatus = record.status === 'INACTIVE' ? 'IN_RD' : 'INACTIVE';
  const action = next === 'INACTIVE' ? '停用' : '启用';
  rowBusy.value = `status:${record.id}`;
  try {
    await changeProductStatus(record.id, next);
    antMessage.success(`产品 ${record.productName} 已${action}`);
    await load();
  } catch (cause: unknown) {
    antMessage.error(rejectText(cause));
  } finally {
    rowBusy.value = '';
  }
}

/** 打开「申请下架」——G-02 要求删除必须走审核，故此处是申请而非直删。 */
async function openRetire(record: Product): Promise<void> {
  if (rowBusy.value) return;
  rowBusy.value = `retire:${record.id}`;
  try {
    // 先回读当前版本号，提交时作为乐观锁的 expectedVersion。
    const view = await fetchProductRetirement(record.id);
    if (!view.canSubmit) {
      antMessage.warning('该产品当前不可申请下架（可能已有在途申请或已下架）');
      return;
    }
    retireTarget.value = record;
    retireReason.value = '';
  } catch (cause: unknown) {
    antMessage.error(rejectText(cause));
  } finally {
    rowBusy.value = '';
  }
}

function closeRetire(): void {
  if (retireSubmitting.value) return;
  retireTarget.value = null;
  retireReason.value = '';
}

async function submitRetire(): Promise<void> {
  const target = retireTarget.value;
  const reason = retireReason.value.trim();
  if (!target) return;
  if (!reason) {
    antMessage.warning('请填写下架原因（审核与审计需要）');
    return;
  }
  retireSubmitting.value = true;
  try {
    const view = await fetchProductRetirement(target.id);
    const version = view.retirement?.version ?? 0;
    await submitProductRetirement(target.id, version, reason);
    antMessage.success(`已提交「${target.productName}」的下架申请，等待审核`);
    retireTarget.value = null;
    retireReason.value = '';
    await load();
  } catch (cause: unknown) {
    antMessage.error(rejectText(cause));
  } finally {
    retireSubmitting.value = false;
  }
}
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
        <Button type="primary" data-testid="catalog-create" @click="goCreate">新增产品</Button>
      </header>

      <!-- L2 每页 AI 入口（2026-09-28）：产品名称分类（userPrompt 素材必填；采纳仅回传宿主，C08 零直写） -->
      <div style="margin-bottom: 16px">
        <AiSuggest
          scene="product.name-classify"
          needs-prompt
          adoptable
          label="AI 产品名称分类"
          data-testid="catalog-ai-classify"
          @adopt="onAiAdopt"
        />
        <p v-if="adoptedAi" class="text-muted-foreground mt-2 text-xs" data-testid="catalog-ai-adopted">
          AI 建议已回传宿主（{{ adoptedAi.scene }}）：仅草稿不写库，请人工复核后手动操作。
        </p>
      </div>

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
              <input id="catalog-import-file" name="catalog_import_file" accept=".xlsx" disabled type="file" @change="onFileChange" />
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
        <p v-if="productLineError" role="status" class="ipd-cat-error">产品线归属暂不可核实：{{ productLineError }}</p>
        <div v-if="!loadError" class="ipd-cat-table" data-testid="catalog-table">
          <div class="ipd-cat-row head">
            <span>型号 / 产品</span>
            <span>产品线</span>
            <span>版本</span>
            <span>市场PM</span>
            <span>生命周期</span>
            <span>最近更新</span>
            <span>操作</span>
          </div>
          <div v-for="p in products" :key="p.id" class="ipd-cat-row">
            <span>
              <strong>{{ p.modelCode ?? p.productCode }}</strong>
              <small>{{ p.productName }}</small>
            </span>
            <span>{{ productLineNameOf(p.id) }}</span>
            <span>—</span>
            <span>待匹配</span>
            <span>
              <i :class="lifecycleTone(p.status)" class="ipd-cat-pill">{{ lifecycleText(p.status) }}</i>
            </span>
            <span>—</span>
            <span class="ipd-cat-actions">
              <Button size="small" data-testid="catalog-edit" :loading="rowBusy === `status:${p.id}`" @click="goEdit(p)">编辑</Button>
              <Button
                size="small"
                data-testid="catalog-toggle-status"
                :loading="rowBusy === `status:${p.id}`"
                @click="toggleStatus(p)"
              >
                {{ p.status === 'INACTIVE' ? '启用' : '停用' }}
              </Button>
              <Button
                size="small"
                danger
                data-testid="catalog-retire"
                :loading="rowBusy === `retire:${p.id}`"
                @click="openRetire(p)"
              >
                申请下架
              </Button>
            </span>
          </div>
          <div v-if="products.length === 0" class="ipd-cat-table-empty">
            暂无产品档案；可点右上角「新增产品」逐条录入，或等待 Excel 导入接口交付。
          </div>
        </div>
      </section>

      <!-- 申请下架（G-02：删除必须走审核，故此处是申请而非直删） -->
      <Modal
        :open="retireTarget !== null"
        title="申请下架产品"
        @cancel="closeRetire"
      >
        <!--
          footer 用显式插槽渲染：ant-design-vue 4.2.6 的 Modal 插槽名是 #footer /
          #okText / #cancelText（读包内实现确认，见 es/modal/Modal.js 只取这三个），
          不存在 #ok / #cancel。显式渲染另有一个好处：能挂稳定的 data-testid。
        -->
        <template #footer>
          <Button data-testid="catalog-retire-cancel" @click="closeRetire">取消</Button>
          <Button
            type="primary"
            :loading="retireSubmitting"
            data-testid="catalog-retire-submit"
            @click="submitRetire"
          >
            提交申请
          </Button>
        </template>
        <p v-if="retireTarget" data-testid="catalog-retire-modal">
          产品：<strong>{{ retireTarget.productName }}</strong>（{{ retireTarget.productCode }}）
        </p>
        <p class="text-muted-foreground text-xs">
          下架需经审核通过后才会真正软删（G-02：任何人无直接删除权限）。请填写原因，审核与审计都需要。
        </p>
        <Input.TextArea
          v-model:value="retireReason"
          :rows="3"
          placeholder="请填写下架原因"
          data-testid="catalog-retire-reason"
        />
      </Modal>
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


/* V12-F3: 原 1050px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .ipd-cat-grid {
    grid-template-columns: 1fr;
  }
}

.ipd-cat {
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
}

.ipd-cat-heading {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}

.ipd-cat-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  letter-spacing: -0.02em;
}

.ipd-cat-heading p {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
}

/* .catalog-grid：1.25fr .75fr */
.ipd-cat-grid {
  display: grid;
  grid-template-columns: 1.25fr 0.75fr;
  gap: 16px;
  margin-bottom: 16px;
}

.ipd-cat-surface {
  overflow: hidden;
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
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
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

/* .drop-upload */
.ipd-cat-drop {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 24px;
  margin: 18px;
  text-align: center;
  background: #f8faff;
  border: 1px dashed #b9c7da;
  border-radius: 8px;
}

.ipd-cat-drop > svg {
  font-size: 42px;
  color: var(--ipd-blue, #245bf4);
}

.ipd-cat-drop strong {
  font-size: 14px;
  color: var(--ipd-text, #172033);
}

.ipd-cat-drop small {
  color: var(--ipd-muted, #697388);
}

.ipd-cat-file {
  padding: 5px 10px;
  font-size: 12px;
  color: var(--ipd-text, #172033);
  cursor: pointer;
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 4px;
}

.ipd-cat-file input {
  display: none;
}

.ipd-cat-file-name {
  font-size: 12px;
  color: var(--ipd-blue, #245bf4);
}

.ipd-cat-primary {
  height: 38px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  color: white;
  cursor: pointer;
  background: var(--ipd-blue, #245bf4);
  border: 0;
  border-radius: 6px;
}

.ipd-cat-primary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ipd-cat-note {
  font-size: 11px;
  color: #a13f3f;
}

/* .import-history 空态 */
.ipd-cat-history-empty {
  padding: 26px 20px;
  margin: 0;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  text-align: center;
}

/* .business-table .product-table：1.3fr 1fr .6fr .8fr .6fr .8fr */
.ipd-cat-table {
  overflow-x: auto;
}

.ipd-cat-row {
  display: grid;
  /* 末列为操作列（2026-10-08 新增：增删改入口下沉到本页） */
  grid-template-columns: 1.3fr 1fr 0.6fr 0.8fr 0.6fr 0.8fr 1.5fr;
  gap: 14px;
  align-items: center;
  min-width: 1080px;
  min-height: 64px;
  padding: 10px 20px;
  font-size: 12px;
  color: var(--ipd-text, #172033);
  border-bottom: 1px solid #edf0f3;
}

.ipd-cat-row.head {
  min-height: 40px;
  font-weight: 700;
  color: var(--ipd-muted, #697388);
  background: #f7f8fa;
}

/* 操作列（2026-10-08 新增） */
.ipd-cat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  text-align: center;
}

.ipd-cat-error {
  padding: 16px 20px;
  margin: 0;
  font-size: 12px;
  color: var(--ipd-red, #e45757);
}

/* .status-pill */
.ipd-cat-pill {
  display: inline-flex;
  width: fit-content;
  padding: 4px 7px;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  white-space: nowrap;
  border-radius: 4px;
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
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 260px;
  color: var(--ipd-muted, #697388);
  text-align: center;
}

.ipd-cat-blank > div {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  font-size: 26px;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 50%;
}

.ipd-cat-blank strong {
  margin: 12px 0 4px;
  font-size: 14px;
  color: var(--ipd-text, #172033);
}

.ipd-cat-blank p {
  max-width: 380px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

/* ============================================================================
 * 产品目录视觉对齐 —— 真值源：ZK-IPD 原型 styles.css 245 行（catalog/drop-upload）
 *                                                                        + 189-191（表格/pill）
 * ============================================================================ */
</style>
