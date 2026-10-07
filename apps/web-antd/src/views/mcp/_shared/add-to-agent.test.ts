/**
 * Track E 补口：「把 MCP 工具加入自己的智能体」契约测试。
 *
 * <p>锁定语义（断言锁契约而非现状）：
 * - 合并去重且保留既有顺序、不修改入参；
 * - 更新载荷只追加 mcpToolIds，其余字段（modelId/skillNames/knowledgeIds）原样保留；
 * - 已绑定不重复写入（幂等）；单项失败返回 failed 不抛出；
 * - 绑定值即传入的本地工具 id（调用方传 localToolId），不在此层偷换成其它 id。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentInfo, agentUpdate } from '#/api/agent/agent';

import {
  addToolToAgent,
  addToolToAgents,
  buildAgentUpdatePayload,
  mergeMcpToolIds,
} from './add-to-agent';

vi.mock('#/api/agent/agent', () => ({
  agentInfo: vi.fn(),
  agentUpdate: vi.fn(),
}));

const mockedAgentInfo = vi.mocked(agentInfo);
const mockedAgentUpdate = vi.mocked(agentUpdate);

describe('mergeMcpToolIds', () => {
  it('追加去重且保留既有顺序、不修改入参', () => {
    const existing = [9, 7];
    const result = mergeMcpToolIds(existing, 5);
    expect(result.ids).toEqual([9, 7, 5]);
    expect(result.changed).toBe(true);
    expect(existing).toEqual([9, 7]);
  });

  it('已绑定返回 changed=false（幂等）', () => {
    const result = mergeMcpToolIds([9, 7], 7);
    expect(result.ids).toEqual([9, 7]);
    expect(result.changed).toBe(false);
  });

  it('null/undefined/脏值过滤后追加', () => {
    expect(mergeMcpToolIds(null, 5).ids).toEqual([5]);
    expect(mergeMcpToolIds(undefined, 5).ids).toEqual([5]);
    expect(
      mergeMcpToolIds([Number.NaN, 9] as number[], 5).ids,
    ).toEqual([9, 5]);
  });

  it('既有字符串编号参与合并（后端 Long→String 序列化，实测形态）', () => {
    const result = mergeMcpToolIds(['9', '10'], 8);
    expect(result.changed).toBe(true);
    expect(result.ids).toEqual([9, 10, 8]);
  });

  it('既有字符串编号已包含目标 → changed=false（幂等修复）', () => {
    const result = mergeMcpToolIds(['8'], 8);
    expect(result.changed).toBe(false);
    expect(result.ids).toEqual([8]);
  });
});

describe('buildAgentUpdatePayload', () => {
  it('只追加 mcpToolIds，其余字段原样保留', () => {
    const vo = {
      agentName: '演示智能体',
      id: 1,
      knowledgeIds: [3],
      mcpToolIds: [9],
      modelId: 5,
      skillNames: ['pdf'],
    };
    const { changed, payload } = buildAgentUpdatePayload(vo, 7);
    expect(changed).toBe(true);
    expect(payload.mcpToolIds).toEqual([9, 7]);
    expect(payload.modelId).toBe(5);
    expect(payload.skillNames).toEqual(['pdf']);
    expect(payload.knowledgeIds).toEqual([3]);
    expect(payload.id).toBe(1);
    expect(payload.agentName).toBe('演示智能体');
  });

  it('已绑定时 changed=false 且载荷与既有值一致', () => {
    const vo = { id: 1, mcpToolIds: [7] };
    const { changed, payload } = buildAgentUpdatePayload(vo, 7);
    expect(changed).toBe(false);
    expect(payload.mcpToolIds).toEqual([7]);
  });

  it('剔除 createTime/updateTime（空格格式日期会致后端 400，回写必须不带）', () => {
    const { payload } = buildAgentUpdatePayload(
      {
        createTime: '2026-10-07 14:44:34',
        id: 1,
        mcpToolIds: [9],
        updateTime: '2026-10-07 14:44:34',
      },
      7,
    );
    expect(payload).not.toHaveProperty('createTime');
    expect(payload).not.toHaveProperty('updateTime');
    expect(payload.mcpToolIds).toEqual([9, 7]);
  });
});

describe('addToolToAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未绑定 → 读全量后写回合并载荷（其余字段不丢）', async () => {
    mockedAgentInfo.mockResolvedValue({
      agentName: 'Alpha',
      id: 1,
      mcpToolIds: [9],
      modelId: 5,
      skillNames: ['pdf'],
    } as unknown as Awaited<ReturnType<typeof agentInfo>>);
    mockedAgentUpdate.mockResolvedValue(undefined);

    await expect(addToolToAgent(1, 7)).resolves.toBe('added');
    expect(mockedAgentInfo).toHaveBeenCalledWith(1);
    expect(mockedAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'Alpha',
        id: 1,
        mcpToolIds: [9, 7],
        modelId: 5,
        skillNames: ['pdf'],
      }),
    );
  });

  it('已绑定 → 不重复写入', async () => {
    mockedAgentInfo.mockResolvedValue({
      id: 1,
      mcpToolIds: [7],
    } as unknown as Awaited<ReturnType<typeof agentInfo>>);

    await expect(addToolToAgent(1, 7)).resolves.toBe('already');
    expect(mockedAgentUpdate).not.toHaveBeenCalled();
  });

  it('字符串工具编号归一为数值写入（行 id 字符串化场景）', async () => {
    mockedAgentInfo.mockResolvedValue({
      id: 1,
      mcpToolIds: [],
    } as unknown as Awaited<ReturnType<typeof agentInfo>>);
    mockedAgentUpdate.mockResolvedValue(undefined);

    await expect(addToolToAgent(1, '7')).resolves.toBe('added');
    expect(mockedAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, mcpToolIds: [7] }),
    );
  });

  it('后端字符串工具数组：合并保留既有且追加新工具（防覆盖回归）', async () => {
    mockedAgentInfo.mockResolvedValue({
      id: 44,
      mcpToolIds: ['9', '10'],
    } as unknown as Awaited<ReturnType<typeof agentInfo>>);
    mockedAgentUpdate.mockResolvedValue(undefined);

    await expect(addToolToAgent(44, 8)).resolves.toBe('added');
    expect(mockedAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 44, mcpToolIds: [9, 10, 8] }),
    );
  });

  it('查询或写入失败 → failed，不抛出', async () => {
    mockedAgentInfo.mockRejectedValue(new Error('boom'));
    await expect(addToolToAgent(1, 7)).resolves.toBe('failed');

    mockedAgentInfo.mockResolvedValue({
      id: 1,
      mcpToolIds: [],
    } as unknown as Awaited<ReturnType<typeof agentInfo>>);
    mockedAgentUpdate.mockRejectedValue(new Error('write-fail'));
    await expect(addToolToAgent(1, 7)).resolves.toBe('failed');
  });
});

describe('addToolToAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('逐项独立成败汇总，不把个别失败吞成整体成功', async () => {
    mockedAgentInfo.mockImplementation(async (id) => {
      if (id === 2) throw new Error('boom');
      return { id, mcpToolIds: id === 1 ? [7] : [] } as unknown as Awaited<ReturnType<typeof agentInfo>>;
    });
    mockedAgentUpdate.mockResolvedValue(undefined);

    const outcomes = await addToolToAgents(7, [
      { agentName: 'Alpha', id: 1 },
      { agentName: 'Beta', id: 2 },
      { agentName: 'Gamma', id: 3 },
    ]);
    expect(outcomes).toEqual([
      { agentId: 1, agentName: 'Alpha', result: 'already' },
      { agentId: 2, agentName: 'Beta', result: 'failed' },
      { agentId: 3, agentName: 'Gamma', result: 'added' },
    ]);
    expect(mockedAgentUpdate).toHaveBeenCalledTimes(1);
    expect(mockedAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, mcpToolIds: [7] }),
    );
  });
});
