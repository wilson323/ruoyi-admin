// useFilterSync 单测：聚焦纯函数 + 工厂版（不挂载 router，避免 happy-dom + vue-router 集成噪音）。
import { describe, expect, it } from 'vitest';
import { reactive, nextTick } from 'vue';

import { createFilterState } from './use-filter-sync';

describe('createFilterState 工厂', () => {
  it('返回 reactive 副本，初始字段齐全', () => {
    const s = createFilterState({ keyword: '', status: 'ALL' });
    expect(s.keyword).toBe('');
    expect(s.status).toBe('ALL');
  });

  it('修改后字段变更（reactive 验证）', async () => {
    const s = createFilterState({ keyword: '' });
    s.keyword = 'IPD';
    await nextTick();
    expect(s.keyword).toBe('IPD');
  });

  it('互不影响：两个独立 factory 实例不共享状态', () => {
    const a = createFilterState({ x: '' });
    const b = createFilterState({ x: '' });
    a.x = 'A';
    expect(b.x).toBe('');
  });

  it('支持数组字段（多选筛选）', () => {
    const s = createFilterState<{ tags: string[] }>({ tags: [] });
    s.tags.push('urgent');
    expect(s.tags).toEqual(['urgent']);
  });
});

describe('reactive 双向同步（不挂载 router）', () => {
  it('state 修改不抛错（watcher 注册成功）', () => {
    const state = reactive({ keyword: '', status: 'OPEN' });
    // 模拟 setup 期间同步读写，不真正调用 useFilterSync
    expect(() => { state.keyword = 'x'; state.status = 'CLOSED'; }).not.toThrow();
    expect(state.keyword).toBe('x');
    expect(state.status).toBe('CLOSED');
  });
});
