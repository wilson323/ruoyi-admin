import { describe, expect, it } from 'vitest';

import {
  SKILL_FALLBACK_GROUP,
  groupSkills,
  searchSkills,
  skillGroupKey,
} from './skill-group';

const skills = [
  { description: '读 PDF', name: 'pdf:extract' },
  { description: '写 Word', name: 'docx:write' },
  { description: '读 PDF 页', name: 'pdf:pages' },
  { description: '通用助手', name: 'helper' },
  { description: '斜杠命名', name: 'fs/read' },
];

describe('skillGroupKey', () => {
  it('冒号前缀 > 斜杠前缀 > 通用', () => {
    expect(skillGroupKey('pdf:extract')).toBe('pdf');
    expect(skillGroupKey('fs/read')).toBe('fs');
    expect(skillGroupKey('helper')).toBe(SKILL_FALLBACK_GROUP);
    expect(skillGroupKey('')).toBe(SKILL_FALLBACK_GROUP);
    expect(skillGroupKey(':weird')).toBe(SKILL_FALLBACK_GROUP);
  });
});

describe('groupSkills', () => {
  it('按派生键分组、组内字典序、通用组固定最后', () => {
    const groups = groupSkills(skills);
    expect(groups.map((g) => g.label)).toEqual(['docx', 'fs', 'pdf', SKILL_FALLBACK_GROUP]);
    expect(groups[2]?.skills.map((s) => s.name)).toEqual(['pdf:extract', 'pdf:pages']);
  });

  it('同名去重（后到覆盖）、脏数据跳过', () => {
    const groups = groupSkills([
      { description: 'v1', name: 'pdf:extract' },
      { description: 'v2', name: 'pdf:extract' },
      { description: 'x', name: '' },
      { description: 'y', name: undefined as unknown as string },
    ]);
    const pdf = groups.find((g) => g.label === 'pdf');
    expect(pdf?.skills).toEqual([{ description: 'v2', name: 'pdf:extract' }]);
    expect(groups).toHaveLength(1);
  });
});

describe('searchSkills', () => {
  it('name/description 大小写不敏感包含匹配', () => {
    expect(searchSkills(skills, 'PDF').map((s) => s.name)).toEqual([
      'pdf:extract',
      'pdf:pages',
    ]);
    expect(searchSkills(skills, 'word').map((s) => s.name)).toEqual(['docx:write']);
  });

  it('空白关键字返回全量；无命中返回空数组', () => {
    expect(searchSkills(skills, '   ')).toHaveLength(5);
    expect(searchSkills(skills, 'ghost')).toEqual([]);
  });
});
