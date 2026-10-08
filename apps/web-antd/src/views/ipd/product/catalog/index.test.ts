/**
 * 页41 产品目录 · L2 每页 AI 入口（2026-09-28）：product.name-classify。
 *
 * - 三件套：按钮存在 → 素材触发 scene=product.name-classify → adopt 回传宿主；
 * - C08 零直写：AI 链路 fetch 零调用（产品档案读端点走模块 mock，无写端点触达）；
 * - AI 入口挂在 isSuperAdmin 分区内：以超管身份挂载。
 */
import { mount } from '@vue/test-utils';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiSuggest } from '../../../../api/ipd/ai-suggest';
import { changeProductStatus, listProducts } from '../../../../api/ipd/product';
import {
  fetchProductRetirement,
  submitProductRetirement,
} from '../../../../api/ipd/product-retirement';
import { listProductLineProducts, listProductLines } from '../../../../api/ipd/product-line';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import CatalogPage from './index.vue';

vi.mock('../../../../api/ipd/ai-suggest', () => ({ aiSuggest: vi.fn() }));

// 注意：vi.mock 的工厂是**整模块替换**，只列 listProducts 会让 changeProductStatus
// 变成 undefined（导入期不报错、一调用才炸）。增删改入口引入后必须补全。
vi.mock('../../../../api/ipd/product', () => ({
  changeProductStatus: vi.fn(),
  listProducts: vi.fn(),
}));
vi.mock('../../../../api/ipd/product-line', () => ({
  listProductLineProducts: vi.fn(),
  listProductLines: vi.fn(),
}));
vi.mock('../../../../api/ipd/product-retirement', () => ({
  fetchProductRetirement: vi.fn(),
  submitProductRetirement: vi.fn(),
}));

/** L2 AI 测试视图：非结构化场景（无卡）+ 非降级 → 纯文本 + 「采纳到表单」按钮。 */
const suggestView = (scene: string, markdown: string) => ({
  aiModel: 'mock-mini', card: null, completionTokens: 1, degraded: false,
  latencyMs: 5, markdown, promptTokens: 1, scene,
});

/** 超管身份注入（与挂载同一 pinia 实例，避免 store 分叉）。 */
function loginAsSuperAdmin(pinia: Pinia): void {
  setActivePinia(pinia);
  useIpdAuthStore().identity = {
    mustChangePwd: false,
    scope: 'FULL',
    person: {
      accountStatus: 'ACTIVE',
      groupId: null,
      id: '1',
      name: '超级管理员',
      personType: 'SUPER_ADMIN',
      username: 'fixture-super',
    },
  };
}

/** router stub：页面的新增/编辑入口靠 useRouter() 跳转，需 mock 模块而非 $router。 */
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

beforeEach(() => {
  vi.mocked(aiSuggest).mockReset();
  vi.mocked(listProducts).mockReset();
  vi.mocked(listProductLines).mockReset();
  vi.mocked(listProductLineProducts).mockReset();
  vi.mocked(changeProductStatus).mockReset();
  vi.mocked(fetchProductRetirement).mockReset();
  vi.mocked(submitProductRetirement).mockReset();
  vi.mocked(listProducts).mockResolvedValue([]);
  vi.mocked(listProductLines).mockResolvedValue([]);
  vi.mocked(changeProductStatus).mockResolvedValue(undefined);
  vi.mocked(submitProductRetirement).mockResolvedValue({} as never);
  push.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // antd Modal 经 Teleport 渲染到 body，wrapper.unmount() 清不掉它，会污染下一个用例
  // （实测表现为「上一轮明明断言过弹窗不出现，这一轮却查到了残留的 <p>」）。
  document.querySelectorAll('.ant-modal-root, .ant-modal-wrap').forEach((el) => el.remove());
  document.body.querySelectorAll('[data-testid="catalog-retire-modal"]').forEach((el) => el.remove());
});

describe('L2 AI 入口（product.name-classify）', () => {
  it('product.name-classify：按钮存在、素材触发 scene、adopt 回传宿主（C08 零直写）', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(suggestView('product.name-classify', '## 名称分类\n- 平板产品线'));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const pinia = createPinia();
    loginAsSuperAdmin(pinia);
    const wrapper = mount(CatalogPage, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(vi.mocked(listProducts)).toHaveBeenCalled());

    // ① 按钮存在
    const runBtn = wrapper.find('[data-testid="catalog-ai-classify"] [data-testid="ai-suggest-run"]');
    expect(runBtn.exists()).toBe(true);
    expect(runBtn.text()).toContain('AI 产品名称分类');

    // ② 触发 scene 正确（needsPrompt：先填素材再发起）
    await wrapper.get('[data-testid="catalog-ai-classify"] [data-testid="ai-suggest-prompt"]')
      .setValue('ZK 平板 X100 教育版');
    await runBtn.trigger('click');
    await vi.waitFor(() => expect(vi.mocked(aiSuggest)).toHaveBeenCalledWith(
      'product.name-classify',
      expect.objectContaining({ userPrompt: 'ZK 平板 X100 教育版' }),
    ));

    // ③ adopt 回传宿主（仅本地提示，不写库）
    await wrapper.get('[data-testid="catalog-ai-classify"] [data-testid="ai-suggest-adopt"]').trigger('click');
    const ack = wrapper.find('[data-testid="catalog-ai-adopted"]');
    expect(ack.exists()).toBe(true);
    expect(ack.text()).toContain('已回传宿主');
    expect(ack.text()).toContain('product.name-classify');
    expect(ack.text()).toContain('不写库');
    // C08 零直写：产品读端点走模块 mock，AI 链路 fetch 零调用（无写端点触达）
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('产品线归属', () => {
  const product = {
    id: '90071992547409931', productCode: 'P1', productName: '门禁设备',
    modelCode: null, groupId: 'org-group-1', projectId: null, source: null, status: 'ACTIVE',
  };

  it('仅按独立产品线接口显示归属，不把组织产品组当产品线', async () => {
    vi.mocked(listProducts).mockResolvedValue([product]);
    vi.mocked(listProductLines).mockResolvedValue([{ id: 'line-1', code: 'ACCESS', name: '门禁', leaderPersonId: null, status: 'ACTIVE' }]);
    vi.mocked(listProductLineProducts).mockResolvedValue([{ id: product.id, code: 'P1', name: '门禁设备' }]);
    const pinia = createPinia();
    loginAsSuperAdmin(pinia);
    const wrapper = mount(CatalogPage, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(wrapper.get('[data-testid="catalog-table"]').text()).toContain('门禁'));
    expect(wrapper.get('[data-testid="catalog-table"]').text()).not.toContain('org-group-1');
    wrapper.unmount();
  });

  it('接口失败时保留产品目录并显示归属未知', async () => {
    vi.mocked(listProducts).mockResolvedValue([product]);
    vi.mocked(listProductLines).mockRejectedValue(new Error('404'));
    const pinia = createPinia();
    loginAsSuperAdmin(pinia);
    const wrapper = mount(CatalogPage, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(wrapper.get('[data-testid="catalog-table"]').text()).toContain('归属暂不可核实'));
    expect(wrapper.get('[role="status"]').text()).toContain('404');
    wrapper.unmount();
  });
});

/**
 * 增删改入口（2026-10-08 下沉到本页）。
 * 删除按 G-02 必须走审核：按钮名「删除」，点击发起删除申请，断言里锁定「无直删端点」。
 */
describe('增删改入口', () => {
  const product = {
    id: '90071992547409931', productCode: 'P1', productName: '门禁设备',
    modelCode: null, groupId: null, projectId: null, source: null, status: 'ACTIVE',
  };

  async function mountAsAdmin() {
    const pinia = createPinia();
    loginAsSuperAdmin(pinia);
    vi.mocked(listProducts).mockResolvedValue([product]);
    const wrapper = mount(CatalogPage, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(wrapper.get('[data-testid="catalog-table"]').text()).toContain('门禁设备'));
    return wrapper;
  }

  it('页头有「新增产品」入口，跳转到既有新增页', async () => {
    const wrapper = await mountAsAdmin();
    await wrapper.get('[data-testid="catalog-create"]').trigger('click');
    expect(push).toHaveBeenCalledWith('/ipd/products/create');
    wrapper.unmount();
  });

  it('每行「编辑」跳转到既有编辑页', async () => {
    const wrapper = await mountAsAdmin();
    await wrapper.get('[data-testid="catalog-edit"]').trigger('click');
    expect(push).toHaveBeenCalledWith(`/ipd/products/${product.id}/edit`);
    wrapper.unmount();
  });

  it('「停用」调用状态端点并刷新列表', async () => {
    const wrapper = await mountAsAdmin();
    await wrapper.get('[data-testid="catalog-toggle-status"]').trigger('click');
    await vi.waitFor(() => expect(changeProductStatus).toHaveBeenCalledWith(product.id, 'INACTIVE'));
    wrapper.unmount();
  });

  it('「删除」按钮先回读版本再提交删除申请，且原因必填（G-02 走审核非直删）', async () => {
    vi.mocked(fetchProductRetirement).mockResolvedValue({
      retirement: { version: 7 } as never, canSubmit: true, canEditPolicy: false,
      canDecide: false, history: [],
    });
    const wrapper = await mountAsAdmin();

    await wrapper.get('[data-testid="catalog-retire"]').trigger('click');
    // 弹窗内容经 Teleport 渲染到 document.body，wrapper.find() 永远看不到——实测三种
    // mount 配置（无 stub / stubs.teleport / attachTo）结果一致，故统一走 document 查询。
    const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
    await vi.waitFor(() => expect(q('[data-testid="catalog-retire-modal"]')).not.toBeNull());

    // 底部按钮受 CSSMotion 动画影响，比正文晚一步出现，须等它渲染出来再点
    await vi.waitFor(() => expect(q('[data-testid="catalog-retire-submit"]')).not.toBeNull());

    // 原因为空：拒绝提交，不打后端
    q<HTMLButtonElement>('[data-testid="catalog-retire-submit"]')!.click();
    await vi.waitFor(() => expect(submitProductRetirement).not.toHaveBeenCalled());

    const reason = q<HTMLTextAreaElement>('[data-testid="catalog-retire-reason"]')!;
    reason.value = '产品线调整';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(q<HTMLTextAreaElement>('[data-testid="catalog-retire-reason"]')!.value).toBe('产品线调整'));
    q<HTMLButtonElement>('[data-testid="catalog-retire-submit"]')!.click();
    await vi.waitFor(() => expect(submitProductRetirement).toHaveBeenCalledWith(
      product.id, 7, '产品线调整',
    ));
    wrapper.unmount();
  });

  it('不可发起删除申请时给出提示且不打开弹窗', async () => {
    vi.mocked(fetchProductRetirement).mockResolvedValue({
      retirement: null, canSubmit: false, canEditPolicy: false, canDecide: false, history: [],
    });
    const wrapper = await mountAsAdmin();
    await wrapper.get('[data-testid="catalog-retire"]').trigger('click');
    await vi.waitFor(() => expect(fetchProductRetirement).toHaveBeenCalled());
    expect(document.querySelector('[data-testid="catalog-retire-modal"]')).toBeNull();
    expect(submitProductRetirement).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('页面不提供任何直删入口（G-02）', async () => {
    const wrapper = await mountAsAdmin();
    expect(wrapper.find('[data-testid="catalog-retire"]').exists()).toBe(true);
    // 页面加载与渲染全程不得触达任何删除写端点
    expect(changeProductStatus).not.toHaveBeenCalled();
    expect(submitProductRetirement).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
