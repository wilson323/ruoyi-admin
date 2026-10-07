import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessStoreMock,
  fetchPlatformAccessCodesMock,
  fetchPlatformTokenMock,
  getUserInfoApiMock,
  loginIpdMock,
  requestIpdMock,
  userStoreMock,
} = vi.hoisted(() => ({
  accessStoreMock: {
    accessCodes: [] as string[],
    accessToken: '' as null | string,
    setAccessCodes: vi.fn(),
    setAccessMenus: vi.fn(),
    setAccessToken: vi.fn(),
    setIsAccessChecked: vi.fn(),
  },
  fetchPlatformAccessCodesMock: vi.fn(),
  fetchPlatformTokenMock: vi.fn(),
  getUserInfoApiMock: vi.fn(),
  loginIpdMock: vi.fn(),
  requestIpdMock: vi.fn(),
  userStoreMock: {
    setUserInfo: vi.fn(),
    userInfo: null as null | { permissions: string[] },
  },
}));

vi.mock('../api/ipd/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/ipd/auth')>();
  return {
    ...actual,
    fetchPlatformAccessCodes: fetchPlatformAccessCodesMock,
    fetchPlatformToken: fetchPlatformTokenMock,
    loginIpd: loginIpdMock,
    requestIpd: requestIpdMock,
  };
});
vi.mock('../api/core/user', () => ({ getUserInfoApi: getUserInfoApiMock }));
vi.mock('@vben/stores', () => ({
  useAccessStore: () => accessStoreMock,
  useUserStore: () => userStoreMock,
}));

import { useIpdAuthStore } from './ipd-auth';

const PERSON = {
  accountStatus: 'ACTIVE',
  groupId: null,
  id: '900102',
  name: '组长',
  permissionCodes: ['ipd:project:list', 'ipd:project:query'],
  personType: 'GROUP_LEADER',
  username: 'ipd-leader',
};
const LOGIN_RESULT = {
  expiresIn: 3600,
  mustChangePwd: false,
  person: PERSON,
  scope: 'FULL',
  token: 'ipd-t1',
  tokenType: 'Bearer' as const,
};
const PLATFORM_CODES = ['system:info:add', 'system:info:list', 'system:attach:add'];

/**
 * 2026-10-07 非超管平台按钮断链修复（store 侧不变量）：
 * 换票成功的同一流程里必须把「映射平台账号的 RBAC 码」与 IPD 码并集装进 accessStore，
 * 且 refreshIdentity 复调（导航守卫每 60s）不得洗掉平台码——否则知识库等按钮
 * （v-access:code 判 system:info:*）对非超管角色再次消失。
 */
describe('ipd-auth store 平台码补装（2026-10-07）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
    vi.clearAllMocks();
    loginIpdMock.mockResolvedValue(LOGIN_RESULT);
    requestIpdMock.mockResolvedValue({ mustChangePwd: false, person: PERSON, scope: 'FULL' });
    fetchPlatformTokenMock.mockResolvedValue({
      clientId: 'cid-1',
      expiresIn: 604_800,
      platformUser: 'ipd-leader',
      token: 'plat-t1',
      tokenType: 'Bearer',
    });
    fetchPlatformAccessCodesMock.mockResolvedValue(PLATFORM_CODES);
    getUserInfoApiMock.mockResolvedValue({ mustChangePwd: false, person: PERSON, scope: 'FULL' });
  });

  it('登录→换票：accessCodes = IPD 码 ∪ 平台码，且平台码随票入 sessionStorage 缓存', async () => {
    const store = useIpdAuthStore();
    await store.login('ipd-leader', 'x');

    expect(fetchPlatformAccessCodesMock).toHaveBeenCalledWith('plat-t1', 'cid-1');
    const lastCodes = accessStoreMock.setAccessCodes.mock.calls.at(-1)?.[0];
    expect(lastCodes).toEqual([
      'ipd:project:list',
      'ipd:project:query',
      'system:info:add',
      'system:info:list',
      'system:attach:add',
    ]);

    const cached = JSON.parse(sessionStorage.getItem('ruoyi-ipd.platform') ?? 'null');
    expect(cached?.accessCodes).toEqual(PLATFORM_CODES);
    expect(cached?.token).toBe('plat-t1');
  });

  it('refreshIdentity 复调（60s 导航守卫）：平台码从缓存并入，不被洗掉', async () => {
    const store = useIpdAuthStore();
    await store.login('ipd-leader', 'x');
    accessStoreMock.setAccessCodes.mockClear();

    await store.refreshIdentity();

    const lastCodes = accessStoreMock.setAccessCodes.mock.calls.at(-1)?.[0] as string[];
    expect(lastCodes).toContain('system:info:add');
    expect(lastCodes).toContain('ipd:project:list');
  });

  it('平台码补装失败（返回空数组）：accessCodes 退回纯 IPD 码，登录不阻断', async () => {
    fetchPlatformAccessCodesMock.mockResolvedValue([]);
    const store = useIpdAuthStore();
    await store.login('ipd-leader', 'x');

    const lastCodes = accessStoreMock.setAccessCodes.mock.calls.at(-1)?.[0];
    expect(lastCodes).toEqual(['ipd:project:list', 'ipd:project:query']);
    expect(store.token).toBe('ipd-t1');
  });
});
