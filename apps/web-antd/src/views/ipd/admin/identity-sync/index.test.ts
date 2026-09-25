// 页44 人员同步（卡 P0-10.44；超管专区）：mock 真实 /api/v1 契约（GET /pm-directory），
// 断言身份 / 同步源类型 / 来源实例 / 最近同步时间三维度「真缺口」登记文案与渲染，
// 目录真数据列表加载、空态、加载态、错误态、刷新重试、按钮禁用登记与同步按钮的「本地时间戳」门控。
//
// 不测试的边界：
// - 权限码（IPD_PERMISSION_CODES.IDENTITY_SYNC_*）由 _shared/ipd-permission-codes.test.ts 兜底；
// - 超管路由门禁由 ipd 路由表 + layouts/ipd.vue 入口限制覆盖，本页身份真值（isSuperAdmin）是关键。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../../../store/ipd-auth';
import type { IpdIdentity } from '../../../../api/ipd/auth';
import IdentitySyncPage from './index.vue';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-07T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const directory = [
  { employeeNo: 'A001', groupId: 'G1', groupName: '智能终端组', id: '100', level: 'P5', name: '张三', personType: 'MARKET_PM' },
  { employeeNo: 'A002', groupId: 'G1', groupName: '智能终端组', id: '101', level: 'P6', name: '李四', personType: 'RD_PM' },
  { employeeNo: 'A003', groupId: 'G2', groupName: '工业视觉组', id: '102', level: 'P7', name: '王五', personType: 'GROUP_LEADER' },
];

function setupIdentity(role: IpdIdentity['person']['personType']) {
  sessionStorage.setItem('ruoyi-ipd.session', JSON.stringify({
    accessToken: 'token-fake', refreshToken: 'r-fake',
    accessExpiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 7_200_000,
    refreshState: 'ready',
  }));
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: { accountStatus: 'ACTIVE', groupId: 'G0', id: '999', name: '超管', personType: role, username: 'admin' },
    scope: 'FULL',
  };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('页44 人员同步（P0-10.44；超管专区）', () => {
  it('真实现：超管 mount → GET /pm-directory 派发，列表渲染 3 条人员', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      return envelope(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('张三'));
    expect(fetcher).toHaveBeenCalled();
    const calledUrl = fetcher.mock.calls.map(([target]) => String(target)).find((url) => url.includes('/pm-directory'));
    expect(calledUrl).toBe('/api/v1/pm-directory');
    expect(wrapper.text()).toContain('李四');
    expect(wrapper.text()).toContain('王五');
    expect(wrapper.text()).toContain('姓名');
    expect(wrapper.text()).toContain('工号');
    expect(wrapper.text()).toContain('角色');
    expect(wrapper.text()).toContain('所属产品组');
    wrapper.unmount();
  });

  it('真缺口登记：3 个维度均渲染「后端未交付」指示文案，不造数据', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      return envelope(null, 404, 40400);
    }));
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('张三'));

    const text = wrapper.text();

    expect(text).toContain('真缺口');
    expect(text).toContain('原型 LDAP/SSO/SCIM/手动四类型后端未交付');
    expect(text).toContain('来源实例');
    expect(text).toContain('待补充');
    expect(text).toContain('本地时间戳；后端同步时间端点未交付');
    expect(/\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(text)).toBe(true);
    expect(text).toContain('同步源设置');
    expect(text).toContain('人员同步（超管专区）');

    wrapper.unmount();
  });

  it('身份防御：非超管身份 tag 为「只读」（身份真值由 isSuperAdmin 计算）', async () => {
    setupIdentity('MARKET_PM');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      return envelope(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('张三'));
    expect(wrapper.text()).toContain('只读');
    expect(wrapper.text()).not.toContain('超级管理员');
    expect(fetcher).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('空目录：返回 [] → 不报错，渲染 Empty 空态文案', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/pm-directory') return envelope({ directory: [], total: 0 });
      return envelope(null, 404, 40400);
    }));
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无符合条件的人员目录'));
    expect(wrapper.text()).not.toContain('加载失败');
    expect(wrapper.text()).not.toContain('网络异常');
    wrapper.unmount();
  });

  it('断网/拒绝：fetch 抛错 → 渲染网络/加载失败 Alert，无未捕获 rejection', async () => {
    setupIdentity('SUPER_ADMIN');
    const unhandled = vi.fn();
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
      const wrapper = mount(IdentitySyncPage);
      await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
      expect(wrapper.text()).toContain('网络异常');
      expect(wrapper.text()).not.toContain('加载失败');
      expect(unhandled).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });

  it('业务拒绝：后端 envelope 异常 → 渲染加载失败 Alert，可点「刷新人员目录」恢复', async () => {
    setupIdentity('SUPER_ADMIN');
    let dirCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/pm-directory') {
        dirCalls += 1;
        return dirCalls === 1
          // R217-E2E-B2：403+30001 后端原文「无权访问该项目」直显（rejectText 读 err.message），
          // 旧断言的查表文案「输入信息不符合要求」系盲区遮蔽形态，本卡裁决覆盖。
          ? new Response(JSON.stringify({ code: 30001, message: '无权访问该项目', data: null, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
          : envelope({ directory, total: directory.length });
      }
      if (url === '/api/v1/hr-sync/pending-handovers') return envelope([]);
      return envelope(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无权访问该项目'));
    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).not.toContain('网络异常');
    // 真实 UI：Alert 同时传了 :description prop 与 #description 插槽（index.vue 现状），
    // ant-design-vue 优先 prop，因此 #description 中的「重新加载」按钮不渲染。
    // 重试语义靠「刷新人员目录」按钮（@click="load"）实现 —— 这是当前真实现，测试断言于此对齐。
    expect(wrapper.html()).not.toContain('重新加载');
    const retry = wrapper.findAll('button').find((b) => b.text().includes('刷新人员目录'));
    expect(retry, '「刷新人员目录」按钮应存在').toBeDefined();
    await retry!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('张三'));
    expect(dirCalls).toBe(2); // 首载 + 手动刷新各一次目录请求
    wrapper.unmount();
  });

  it('按钮登记：三同步按钮 disabled；刷新人员目录可用；下方登记文案存在', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      return envelope(null, 404, 40400);
    }));
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('张三'));

    for (const label of ['触发同步', '同步历史', '映射配置']) {
      const btn = wrapper.findAll('button').find((b) => b.text().includes(label));
      expect(btn, `button "${label}" should exist`).toBeDefined();
      expect(btn!.attributes('disabled'), `button "${label}" should be disabled`).toBeDefined();
    }

    const refresh = wrapper.findAll('button').find((b) => b.text().includes('刷新人员目录'));
    expect(refresh).toBeDefined();
    expect(refresh!.attributes('disabled')).toBeUndefined();

    expect(wrapper.text()).toContain('三个同步按钮在 identity-source Controller 交付前禁用');

    wrapper.unmount();
  });
});

// ---------- R215 GAP-F3：复职入口（PersonController#rehire AC-USER-09） ----------
const frozenPending = [
  { personId: '2096266884247736321', name: '赵六', employeeNo: 'A009', groupId: 'G1', frozenSince: '2026-09-10T08:00:00Z', activeProjects: 1, ageDays: 5, escalate: false },
];

describe('页44 人员同步 - R215 GAP-F3 复职入口', () => {
  it('超管 + 冻结清单非空：渲染「离职冻结人员」Card 与「复职」按钮，personId 19 位逐字符无损进 URL', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      if (url === '/api/v1/hr-sync/pending-handovers') return envelope(frozenPending);
      if (url === '/api/v1/persons/2096266884247736321/rehire' && init?.method === 'POST') {
        return envelope({ id: '2096266884247736321', name: '赵六', employmentStatus: 'ACTIVE', accountStatus: 'ACTIVE', wecomUserId: '***' });
      }
      return envelope(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('离职冻结人员'));
    expect(wrapper.text()).toContain('赵六');
    const rehireBtn = wrapper.findAll('button').find((b) => /复\s*职/.test(b.text()));
    expect(rehireBtn, '「复职」按钮应存在').toBeDefined();
    await rehireBtn!.trigger('click');
    // note 留空 → 仍允许提交（optional 分支），body 归一为 {}（禁空串入库）
    const vm = wrapper.vm as unknown as { actionKind: string; actionReason: string; confirmPersonAction: () => Promise<void> };
    expect(vm.actionKind).toBe('rehire');
    vm.actionReason = '';
    await vm.confirmPersonAction();
    const rehireCall = fetcher.mock.calls.find(([t, i]) => String(t).endsWith('/rehire') && (i as RequestInit)?.method === 'POST');
    expect(rehireCall, 'POST /persons/{id}/rehire 应被派发').toBeDefined();
    // 19 位雪花逐字符无损（禁 Number 塌缩）
    expect(String(rehireCall![0])).toBe('/api/v1/persons/2096266884247736321/rehire');
    expect(JSON.parse(String((rehireCall![1] as RequestInit).body))).toEqual({});
    wrapper.unmount();
  });

  it('复职填备注 → body 仅含 note 单键；非超管不渲染冻结清单', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      if (url === '/api/v1/hr-sync/pending-handovers') return envelope(frozenPending);
      if (url.endsWith('/rehire')) {
        return envelope({ id: '2096266884247736321', name: '赵六', employmentStatus: 'ACTIVE', accountStatus: 'ACTIVE', wecomUserId: '***' });
      }
      return envelope(null, 404, 40400);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('离职冻结人员'));
    const vm = wrapper.vm as unknown as {
      openPersonAction: (kind: string, entry: { id: string; name: string }) => void;
      actionReason: string;
      confirmPersonAction: () => Promise<void>;
    };
    vm.openPersonAction('rehire', { id: '2096266884247736321', name: '赵六' });
    vm.actionReason = '返岗说明';
    await vm.confirmPersonAction();
    const rehireCall = fetcher.mock.calls.find(([t, i]) => String(t).endsWith('/rehire') && (i as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((rehireCall![1] as RequestInit).body))).toEqual({ note: '返岗说明' });
    wrapper.unmount();

    // 非超管：冻结清单区块不渲染（loadFrozen 直接短路）
    sessionStorage.clear();
    setActivePinia(createPinia());
    setupIdentity('MARKET_PM');
    const pmFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      return envelope(null, 404, 40400);
    });
    vi.stubGlobal('fetch', pmFetch);
    const pmWrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(pmWrapper.text()).toContain('张三'));
    expect(pmWrapper.text()).not.toContain('离职冻结人员');
    expect(pmWrapper.text()).not.toMatch(/复\s*职/);
    pmWrapper.unmount();
  });

  it('hr-sync 端点被拒（403）：静默降级，不阻塞人员目录、不出错误 Alert', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/pm-directory') return envelope({ directory, total: directory.length });
      return envelope(null, 403, 30001);
    }));
    const wrapper = mount(IdentitySyncPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('张三'));
    expect(wrapper.text()).not.toContain('离职冻结人员');
    // 目录主体正常（既有 load 的 200 分支）
    expect(wrapper.text()).not.toContain('加载失败');
    wrapper.unmount();
  });
});
