import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ipdGet, ipdPost } from './http';
import { listProductLineProducts, listProductLines, reviewProductLineApplication } from './product-line';

vi.mock('./http', () => ({ ipdGet: vi.fn(), ipdPost: vi.fn(), ipdPut: vi.fn() }));

beforeEach(() => {
  vi.mocked(ipdGet).mockReset();
  vi.mocked(ipdPost).mockReset();
});

describe('产品线合同', () => {
  it('空间产品保留真实在售和在研状态', async () => {
    vi.mocked(ipdGet).mockResolvedValue([{ id: '201', code: 'P201', name: '产品', status: 'IN_RD' }]);
    expect(await listProductLineProducts('101')).toEqual([{ id: '201', code: 'P201', name: '产品', status: 'IN_RD' }]);
  });
  it('大整数 ID 以服务端字符串原样传递，不映射产品组', async () => {
    const id = '9007199254740993123';
    vi.mocked(ipdGet).mockResolvedValue([{ id, code: 'ACCESS', name: '门禁', leaderPersonId: null, status: 'ACTIVE' }]);
    expect(await listProductLines()).toEqual([{ id, code: 'ACCESS', name: '门禁', leaderPersonId: null, status: 'ACTIVE' }]);
    expect(ipdGet).toHaveBeenCalledWith('/ipd/product-lines');
  });

  it('审批只提交明确布尔决定，Person ID 保持字符串', async () => {
    const personId = '9007199254740993123';
    vi.mocked(ipdPost).mockResolvedValue({ personId, status: 'ACTIVE', reviewedBy: '7' });
    expect(await reviewProductLineApplication('line-1', personId, true)).toEqual({
      personId, status: 'ACTIVE', reviewedBy: '7',
    });
    expect(ipdPost).toHaveBeenCalledWith(
      `/ipd/product-lines/line-1/join-applications/${personId}/review`,
      { approve: true },
    );
  });
});
