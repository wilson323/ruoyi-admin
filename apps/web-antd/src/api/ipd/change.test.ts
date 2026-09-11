import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  decideCoefficientChange,
  decideLaunchDateChange,
  parseCoefficientChangeRequest,
  parseLaunchDateChangeRequest,
  proposeCoefficientChange,
  proposeLaunchDateChange,
} from './change';
import { IpdRequestError } from './auth';

const response = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    {
      headers: { 'Content-Type': 'application/json' },
      status,
    },
  );

const coefficientFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  createTime: '2026-09-05 10:00:00',
  id: '8001',
  leaderDecision: null,
  leaderDecidedAt: null,
  leaderId: null,
  leaderOpinion: null,
  projectId: '100',
  proposedCoefficient: 1.2,
  reason: 'S 级上调',
  status: 'PENDING_LEADER',
  ...overrides,
});

const launchFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  confirmerId: null,
  confirmerRole: null,
  confirmedAt: null,
  createTime: '2026-09-05 10:00:00',
  id: '8002',
  projectId: '100',
  proposedLaunchDate: '2026-12-01 00:00:00',
  previousLaunchDate: '2026-10-01 00:00:00',
  proposerId: '9007199254740993',
  proposerRole: 'MARKET_PM',
  reason: '渠道节奏调整',
  status: 'PENDING_SECOND',
  version: 0,
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('变更单接口', () => {
  it('系数变更联合提议走 POST /coefficient-change-requests，系数以字符串提交', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(coefficientFixture()));
    vi.stubGlobal('fetch', fetcher);
    const result = await proposeCoefficientChange({
      marketPmId: '11',
      proposedCoefficient: '1.20',
      rdPmId: '22',
      projectId: '100',
      reason: 'S 级上调',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/coefficient-change-requests');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      marketPmId: '11',
      proposedCoefficient: '1.20',
      rdPmId: '22',
      projectId: '100',
      reason: 'S 级上调',
    });
    expect(result.status).toBe('PENDING_LEADER');
  });

  it('决策动作 approve/opinion 走查询串且 opinion 做编码', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response(coefficientFixture({ status: 'CONFIRMED' }))),
      );
    vi.stubGlobal('fetch', fetcher);
    await decideCoefficientChange('8001', true, '意见&备注');
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/v1/coefficient-change-requests/8001/leader-decision?approve=true&opinion=%E6%84%8F%E8%A7%81%26%E5%A4%87%E6%B3%A8',
    );
    fetcher.mockImplementation(() => Promise.resolve(response(launchFixture({ status: 'REJECTED' }))));
    await decideLaunchDateChange('8002', false);
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/v1/launch-date-change-requests/8002/second-decision?approve=false');
  });

  it('上市日期提议 body 为 yyyy-MM-dd 字符串 + 第二签确认人三字段', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(launchFixture()));
    vi.stubGlobal('fetch', fetcher);
    await proposeLaunchDateChange({
      confirmerGroupId: '900001',
      confirmerId: '900201',
      confirmerRole: 'RD_PM',
      proposedLaunchDate: '2026-12-01',
      projectId: '100',
      reason: '节奏调整',
    });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      confirmerGroupId: '900001',
      confirmerId: '900201',
      confirmerRole: 'RD_PM',
      proposedLaunchDate: '2026-12-01',
      projectId: '100',
      reason: '节奏调整',
    });
  });

  it('parse 拒绝非对象与缺失 ID/status 的数据', () => {
    expect(() => parseCoefficientChangeRequest(null)).toThrow(IpdRequestError);
    expect(() => parseCoefficientChangeRequest({ id: '1' })).toThrow(IpdRequestError);
    expect(() => parseLaunchDateChangeRequest({ id: '1', projectId: '100' })).toThrow(IpdRequestError);
  });
});
