import { describe, expect, it } from 'vitest';

import {
  buildSkillReverseDeps,
  buildToolReverseDeps,
  reverseDepsOf,
} from './tool-reverse-deps';

const agents = [
  {
    agentName: 'Beta',
    id: 2,
    mcpToolIds: [7, 9],
    skillNames: ['pdf:extract'],
  },
  {
    agentName: 'Alpha',
    id: 1,
    mcpToolIds: [7],
    skillNames: ['pdf:extract', 'docx:write'],
  },
  { agentName: 'Gamma', id: 3, mcpToolIds: null, skillNames: null },
];

describe('buildToolReverseDeps', () => {
  it('按工具 id 建索引并按 agentName 排序', () => {
    const map = buildToolReverseDeps(agents);
    expect(reverseDepsOf(map, 7)).toEqual([
      { agentId: 1, agentName: 'Alpha' },
      { agentId: 2, agentName: 'Beta' },
    ]);
    expect(reverseDepsOf(map, 9)).toEqual([{ agentId: 2, agentName: 'Beta' }]);
  });

  it('未知工具返回空数组；null 字段 Agent 不入索引', () => {
    const map = buildToolReverseDeps(agents);
    expect(reverseDepsOf(map, 404)).toEqual([]);
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([7, 9]);
  });
});

describe('buildSkillReverseDeps', () => {
  it('按技能名建索引并排序', () => {
    const map = buildSkillReverseDeps(agents);
    expect(reverseDepsOf(map, 'pdf:extract')).toEqual([
      { agentId: 1, agentName: 'Alpha' },
      { agentId: 2, agentName: 'Beta' },
    ]);
    expect(reverseDepsOf(map, 'docx:write')).toEqual([
      { agentId: 1, agentName: 'Alpha' },
    ]);
    expect(reverseDepsOf(map, 'ghost:skill')).toEqual([]);
  });
});
