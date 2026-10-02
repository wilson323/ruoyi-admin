import { describe, expect, it } from 'vitest';

import type { ProjectAgentCapabilities } from '../../../../api/ipd/project-agent';
import { applyEntryDefaults, describeActionEntryBlock, emptySelection } from './capability-selection';

const caps: ProjectAgentCapabilities = {
  packs: [
    {
      code: 'market-research',
      version: 'v1',
      name: '市场',
      description: '',
      stages: [],
      actionCodes: ['C02'],
      available: true,
      unavailableReason: null,
      skills: [{ name: 'competitor-analysis-ipd', version: '1', sha256: 'a', available: true, reason: null }],
      tools: [{ id: 'project_knowledge_search', name: '检索', readOnly: true, available: true, reason: null }],
    },
    {
      code: 'other',
      version: 'v1',
      name: '其他',
      description: '',
      stages: [],
      actionCodes: ['C03'],
      available: true,
      unavailableReason: null,
      skills: [],
      tools: [],
    },
  ],
  models: [{ id: '2104885081318375426', name: 'MiniMax-M3', available: true, reason: null }],
};

describe('applyEntryDefaults', () => {
  it('动作只命中一个可用包且目录技能可用时，写入技能、包内可用工具和唯一可用模型', () => {
    const next = applyEntryDefaults(caps, emptySelection(), 'C02', ['competitor-analysis-ipd']);
    expect(next.packCode).toBe('market-research');
    expect(next.packVersion).toBe('v1');
    expect(next.modelConfigId).toBe('2104885081318375426');
    expect(next.skillNames).toEqual(['competitor-analysis-ipd']);
    expect(next.toolIds).toEqual(['project_knowledge_search']);
    expect(describeActionEntryBlock(caps, next, 'C02', ['competitor-analysis-ipd'])).toBe('');
  });

  it('目录没有已批准技能时不选包，避免用空技能伪装已绑定', () => {
    const next = applyEntryDefaults(caps, emptySelection(), 'C02');
    expect(next.packCode).toBeNull();
    expect(next.skillNames).toEqual([]);
    expect(next.modelConfigId).toBe('2104885081318375426');
    expect(describeActionEntryBlock(caps, next, 'C02')).toContain('没有已批准技能');
  });

  it('动作不在唯一能力包内时不改用该包', () => {
    const next = applyEntryDefaults(caps, emptySelection(), 'Z99', ['competitor-analysis-ipd']);
    expect(next.packCode).toBeNull();
    expect(describeActionEntryBlock(caps, next, 'Z99', ['competitor-analysis-ipd'])).toContain('不在任何可用能力包内');
  });

  it('动作命中多个包时不替用户选包', () => {
    const both = {
      ...caps,
      packs: caps.packs.map((pack) => ({ ...pack, actionCodes: ['C02'] })),
    };
    const next = applyEntryDefaults(both, emptySelection(), 'C02', ['competitor-analysis-ipd']);
    expect(next.packCode).toBeNull();
    expect(next.modelConfigId).toBe('2104885081318375426');
    expect(describeActionEntryBlock(both, next, 'C02', ['competitor-analysis-ipd'])).toContain('多个可用能力包');
  });

  it('多个已启用模型时不猜默认', () => {
    const many = {
      ...caps,
      models: [
        { id: '1', name: 'A', available: true, reason: null },
        { id: '2', name: 'B', available: true, reason: null },
      ],
    };
    const next = applyEntryDefaults(many, emptySelection(), 'C02', ['competitor-analysis-ipd']);
    expect(next.packCode).toBe('market-research');
    expect(next.modelConfigId).toBeNull();
    expect(describeActionEntryBlock(many, next, 'C02', ['competitor-analysis-ipd'])).toContain('没有唯一默认配置');
  });

  it('未启用模型不能当默认，并写明原因', () => {
    const inactive = {
      ...caps,
      models: [{ id: '9', name: '停用', available: false, reason: '模型配置未启用' }],
    };
    const next = applyEntryDefaults(inactive, emptySelection(), 'C02', ['competitor-analysis-ipd']);
    expect(next.modelConfigId).toBeNull();
    expect(describeActionEntryBlock(inactive, next, 'C02', ['competitor-analysis-ipd'])).toContain('模型配置未启用');
  });

  it('清单先勾上整包工具时，动作到达后保留包内可用工具', () => {
    const filled = {
      ...emptySelection(),
      packCode: 'market-research',
      packVersion: 'v1',
      skillNames: ['competitor-analysis-ipd'],
      toolIds: ['project_knowledge_search'],
    };
    const next = applyEntryDefaults(caps, filled, 'C02', ['competitor-analysis-ipd']);
    expect(next.skillNames).toEqual(['competitor-analysis-ipd']);
    expect(next.toolIds).toEqual(['project_knowledge_search']);
    expect(describeActionEntryBlock(caps, next, 'C02', ['competitor-analysis-ipd'])).toBe('');
  });

  it('动作默认只选本包可用候选，排除不可用MCP及其他包工具', () => {
    const catalog = {
      ...caps,
      packs: caps.packs.map((pack) => ({
        ...pack,
        tools: pack.code === 'market-research' ? [
          ...pack.tools,
          { id: 'mcp-ready', name: '产线库', readOnly: true, available: true, reason: null },
          { id: 'mcp-disabled', name: '停用库', readOnly: true, available: false, reason: '停用' },
        ] : [{ id: 'other-tool', name: '其他', readOnly: true, available: true, reason: null }],
      })),
    };
    const next = applyEntryDefaults(catalog, emptySelection(), 'C02', ['competitor-analysis-ipd']);
    expect(next.toolIds).toEqual(['project_knowledge_search', 'mcp-ready']);
  });

  it('用户主动取消默认工具后，重复入口初始化和清单刷新不重新勾选', () => {
    const selected = applyEntryDefaults(caps, emptySelection(), 'C02', ['competitor-analysis-ipd']);
    const adjusted = { ...selected, toolIds: [] };
    expect(applyEntryDefaults(caps, adjusted, 'C02', ['competitor-analysis-ipd']).toolIds).toEqual([]);
    const refreshed = { ...caps, packs: caps.packs.map((pack) => ({ ...pack })) };
    expect(applyEntryDefaults(refreshed, adjusted, 'C02', ['competitor-analysis-ipd']).toolIds).toEqual([]);
  });

  it('已选能力包不被入口默认盖掉', () => {
    const chosen = {
      ...emptySelection(),
      packCode: 'other',
      packVersion: 'v1',
      modelConfigId: '2104885081318375426',
    };
    const next = applyEntryDefaults(caps, chosen, 'C02', ['competitor-analysis-ipd']);
    expect(next.packCode).toBe('other');
    expect(describeActionEntryBlock(caps, next, 'C02', ['competitor-analysis-ipd'])).toContain('不包含动作 C02');
  });
});
