import { describe, expect, it } from 'vitest';

import {
  METADATA_MAX_DEPTH,
  METADATA_MAX_NODES,
  parseMetadataView,
} from './market-metadata';

describe('parseMetadataView', () => {
  it('E2-BE-1 未透出（undefined/null/非对象）→ available=false', () => {
    for (const raw of [undefined, null, 'str', 42, ['a']]) {
      expect(parseMetadataView(raw)).toEqual({ available: false, nodes: [] });
    }
  });

  it('标量叶子 + 对象/数组容器结构', () => {
    const view = parseMetadataView({
      description: '文件工具',
      tags: ['fs', 'doc'],
      extra: { a: 1 },
    });
    expect(view.available).toBe(true);
    const byKey = new Map(view.nodes.map((n) => [n.key, n]));
    expect(byKey.get('description')).toMatchObject({
      kind: 'scalar',
      value: '文件工具',
    });
    expect(byKey.get('tags')).toMatchObject({ kind: 'array', value: 'Array(2)' });
    expect(byKey.get('tags')?.children).toHaveLength(2);
    expect(byKey.get('extra')).toMatchObject({ kind: 'object', value: 'Object(1)' });
    expect(byKey.get('extra')?.children[0]).toMatchObject({
      key: 'a',
      value: '1',
    });
  });

  it('深度超限截断为诚实截断节点', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < METADATA_MAX_DEPTH + 2; i += 1) deep = { nested: deep };
    const view = parseMetadataView({ root: deep });
    const text = JSON.stringify(view.nodes);
    expect(text).toContain('深层截断');
  });

  it('节点数超限截断', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < METADATA_MAX_NODES + 20; i += 1) wide[`k${i}`] = 'v';
    const view = parseMetadataView(wide);
    expect(view.nodes.length).toBeLessThanOrEqual(METADATA_MAX_NODES + 1);
    expect(JSON.stringify(view.nodes)).toContain('节点上限');
  });
});
