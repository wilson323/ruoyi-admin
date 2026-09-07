import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import PortalTrack from './status/index.vue';
import PortalSubmit from './submit/index.vue';

const jsonResponse = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({ code, message: 'ok', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const productsFixture = [
  { id: '101', productName: 'ZK-X100', modelCode: 'ZK-X100', status: 'ACTIVE', listingStatus: 'ON_SALE' },
  { id: '102', productName: '在研产品A', modelCode: 'X-DEV-1', status: 'ACTIVE', listingStatus: 'IN_DEV' },
];
const traceFixture = {
  code: 'AB12CD34',
  status: 'ACCEPTED',
  customerName: '某某**公司',
  timeline: [
    { stage: 'SUBMITTED', occurredAt: '2026-09-05T02:00:00Z' },
    { stage: 'ACCEPTED', occurredAt: '2026-09-05T03:00:00Z', memo: '已进入受理队列' },
  ],
  attachments: [{ fileName: 'specs.pdf', fileSize: '1.2MB' }],
  canSupplement: false,
  canWithdraw: false,
  withdrawDeadlineAt: null,
};

function makeFetchMock(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn().mockImplementation(() => {
    const next = queue.shift();
    if (!next) return Promise.reject(new TypeError('network unavailable'));
    return Promise.resolve(next);
  });
}

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/portal/submit', component: PortalSubmit, meta: { hideInMenu: true, title: '需求门户-提交需求' }, name: 'IpdPortalSubmit' },
      { path: '/portal/track', component: PortalTrack, meta: { hideInMenu: true, title: '需求门户-查询进度' }, name: 'IpdPortalTrack' },
    ],
  });
}

async function mountPage(component: typeof PortalSubmit | typeof PortalTrack, query = '') {
  const router = createTestRouter();
  await router.push(query);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(component, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  // antdv Select 关闭后下拉 teleport 节点会残留在 document.body；
  // 跨测试累积导致后续 mount 的 Select 找不到正确锚点（happy-dom 下 fragment 移除崩）。
  // 这里按视觉残留节点精确清理，避免误删真实 UI。
  document.body.querySelectorAll(
    '.ant-select-dropdown, .ant-message, [data-ant-select-dropdown], .ant-picker-dropdown, .ant-tooltip',
  ).forEach((node) => node.parentNode?.removeChild(node));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('游客门户-提交需求（页38）', () => {
  it('挂载即拉取产品列表（GET /api/v1/public/products，不携带 Authorization）', async () => {
    const fetcher = makeFetchMock(jsonResponse(productsFixture));
    vi.stubGlobal('fetch', fetcher);
    await mountPage(PortalSubmit);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/products');
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('产品列表加载失败时降级提示，不展示模拟数据', async () => {
    vi.stubGlobal('fetch', makeFetchMock()); // 队列为空 → TypeError 断网
    const wrapper = await mountPage(PortalSubmit);
    expect(wrapper.find('[data-testid="portal-products-degraded"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="portal-products-degraded"]').text()).toContain('其他/未找到');
  });

  it('空表单提交被校验拦截，不发起提交请求', async () => {
    vi.stubGlobal('fetch', makeFetchMock(jsonResponse(productsFixture)));
    const wrapper = await mountPage(PortalSubmit);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const postCalls = fetchCallLog().filter((url) => url.includes('/demands'));
    expect(postCalls).toHaveLength(0);
    expect(wrapper.find('[data-testid="portal-submit-success"]').exists()).toBe(false);
  });

  it('完整填写并选「其他/未找到」提交成功：大字查询码 + 保存提示 + 正确请求体', async () => {
    const fetcher = makeFetchMock(jsonResponse(productsFixture), jsonResponse({ code: 'AB12CD34', status: 'SUBMITTED' }));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountPage(PortalSubmit);
    await fillValidForm(wrapper);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-testid="portal-submit-success"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="portal-code"]').text()).toBe('AB12CD34');
    expect(wrapper.find('[data-testid="portal-code"]').classes().join(' ')).toMatch(/text-\[32px\]/);
    expect(wrapper.text()).toContain('请截图或抄写保存查询码');
    const post = fetcher.mock.calls.filter(([url]) => String(url).includes('/demands'))[0];
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toMatchObject({
      customerName: '某某公司',
      feedbackPerson: '张三',
      productId: null,
      website: '',
    });
  });

  it('提交被拒（40011 限流）→ 触发 UI 节流：按钮 disabled + 倒计时提示', async () => {
    vi.stubGlobal('fetch', makeFetchMock(jsonResponse(productsFixture), jsonResponse(null, 429, 40011)));
    const wrapper = await mountPage(PortalSubmit);
    await fillValidForm(wrapper);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-testid="portal-submit-success"]').exists()).toBe(false);
    // 节流期间：按钮 disabled + 顶部倒计时 Alert 渲染
    const button = wrapper.find('[data-testid="portal-submit-button"]');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
    const notice = wrapper.find('[data-testid="portal-submit-throttled"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toMatch(/请等待 \d+ 秒后重试/);
    // 限流原始文案不再出现于错误条——已被节流提示覆盖
    expect(wrapper.find('[data-testid="portal-submit-error"]').exists()).toBe(false);
  });

  it('节流倒计时归零后按钮恢复可点', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', makeFetchMock(jsonResponse(productsFixture), jsonResponse(null, 429, 40011)));
      const wrapper = await mountPage(PortalSubmit);
      await fillValidForm(wrapper);
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      const button = wrapper.find('[data-testid="portal-submit-button"]');
      expect((button.element as HTMLButtonElement).disabled).toBe(true);
      // 推进 5s：默认 DEFAULT_THROTTLE_SECONDS=5
      await vi.advanceTimersByTimeAsync(5_000);
      await flushPromises();
      expect((button.element as HTMLButtonElement).disabled).toBe(false);
      expect(wrapper.find('[data-testid="portal-submit-throttled"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('蜜罐字段非空：直接拒绝，不触发限流节流', async () => {
    vi.stubGlobal('fetch', makeFetchMock(jsonResponse(productsFixture)));
    const wrapper = await mountPage(PortalSubmit);
    await fillValidForm(wrapper);
    // 模拟机器人填了蜜罐字段
    const honeypotInput = wrapper.find('input[autocomplete="off"][tabindex="-1"]');
    expect(honeypotInput.exists()).toBe(true);
    await honeypotInput.setValue('http://spam.example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    // 应展示错误条且**未**发起 POST /demands
    expect(wrapper.find('[data-testid="portal-submit-error"]').text()).toContain('提交失败');
    const postCalls = fetchCallLog().filter((url) => url.includes('/demands'));
    expect(postCalls).toHaveLength(0);
    // 节流未触发
    expect(wrapper.find('[data-testid="portal-submit-throttled"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="portal-submit-button"]').attributes('disabled')).toBeUndefined();
  });

  it('断网时提交展示断网文案，可修正后重试', async () => {
    vi.stubGlobal('fetch', makeFetchMock(jsonResponse(productsFixture))); // 第二次调用（提交）断网
    const wrapper = await mountPage(PortalSubmit);
    await fillValidForm(wrapper);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-testid="portal-submit-error"]').text()).toContain('无法连接服务');
  });
});

describe('游客门户-查询进度（页39）', () => {
  it('初始空态：未查询时显示引导，不展示任何模拟数据', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const wrapper = await mountPage(PortalTrack);
    expect(wrapper.find('[data-testid="portal-track-empty"]').exists()).toBe(true);
  });

  it('?code= 预填自动查询：GET /demands/:code，无 Authorization，徽章+时间线', async () => {
    const fetcher = makeFetchMock(jsonResponse(traceFixture));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountPage(PortalTrack, '/portal/track?code=AB12CD34');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/demands/AB12CD34');
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(wrapper.find('[data-testid="portal-status-badge"]').text()).toContain('已受理');
    expect(wrapper.findAll('.ant-timeline-item')).toHaveLength(2);
  });

  it('码不存在（50001）→ 明确的码错误文案', async () => {
    vi.stubGlobal('fetch', makeFetchMock(jsonResponse(null, 404, 50001)));
    const wrapper = await mountPage(PortalTrack, '/portal/track?code=ZZZZZZZZ');
    expect(wrapper.find('[data-testid="portal-track-error"]').text()).toContain('未查询到对应的需求，请核对查询码');
  });

  it('断网 → 断网文案，进度面板不出现', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const wrapper = await mountPage(PortalTrack, '/portal/track?code=AB12CD34');
    expect(wrapper.find('[data-testid="portal-track-error"]').text()).toContain('无法连接服务，请检查网络后重试');
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(false);
  });

  it('输入自动转大写并过滤非法字符', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const wrapper = await mountPage(PortalTrack);
    const input = wrapper.find('input[placeholder="如 AB12CD34"]');
    await input.setValue('ab12 cd');
    expect((input.element as HTMLInputElement).value).toBe('AB12CD');
  });

  it('断网重试后成功', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse(traceFixture));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = await mountPage(PortalTrack, '/portal/track?code=AB12CD34');
    expect(wrapper.find('[data-testid="portal-track-error"]').text()).toContain('无法连接服务');
    // happy-dom 不实现按钮点击的隐式表单提交，直接触发 form submit（与真实校验路径一致）
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="portal-status-badge"]').text()).toContain('已受理');
  });
});

// ---------- 测试辅助 ----------

function fetchCallLog(): string[] {
  const fetcher = globalThis.fetch as unknown as { mock?: { calls: Array<[string, RequestInit]> } };
  return (fetcher.mock?.calls ?? []).map(([url]) => String(url));
}

// ---------- 测试辅助：antdv Select 交互与表单填写 ----------

async function openSelectAndPickOther(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.ant-select-selector').trigger('mousedown');
  await flushPromises();
  const option = [...document.body.querySelectorAll('.ant-select-item-option')]
    .find((el) => el.getAttribute('title') === '其他/未找到');
  expect(option, '产品下拉应渲染「其他/未找到」选项').toBeTruthy();
  (option as HTMLElement).click();
  await flushPromises();
}

async function fillValidForm(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('input[placeholder="请输入您的企业名称"]').setValue('某某公司');
  await wrapper.find('input[placeholder="请输入您的姓名"]').setValue('张三');
  await openSelectAndPickOther(wrapper);
  await wrapper.find('textarea').setValue('希望支持批量导出报表功能');
}
