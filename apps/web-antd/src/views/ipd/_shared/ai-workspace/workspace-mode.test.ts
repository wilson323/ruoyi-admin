import { describe, expect, it } from 'vitest';

import {
  loadWorkspaceMode,
  loadWorkspacePane,
  normalizeMode,
  normalizePane,
  saveWorkspaceMode,
  saveWorkspacePane,
  WORKSPACE_MODE_KEY,
  WORKSPACE_PANE_KEY,
} from './workspace-mode';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('workspace-mode', () => {
  it('normalizeMode 只认 ai，其余一律 classic（防御脏值）', () => {
    expect(normalizeMode('ai')).toBe('ai');
    expect(normalizeMode('classic')).toBe('classic');
    expect(normalizeMode('AI')).toBe('classic');
    expect(normalizeMode(null)).toBe('classic');
    expect(normalizeMode('rm -rf')).toBe('classic');
  });

  it('normalizePane 白名单外回落 cards', () => {
    expect(normalizePane('steps')).toBe('steps');
    expect(normalizePane('canvas')).toBe('canvas');
    expect(normalizePane('doc')).toBe('doc');
    expect(normalizePane('evil')).toBe('cards');
    expect(normalizePane(null)).toBe('cards');
  });

  it('mode/pane 读写闭环且 key 锁定', () => {
    const storage = fakeStorage();
    saveWorkspaceMode(storage, 'ai');
    saveWorkspacePane(storage, 'doc');
    expect(loadWorkspaceMode(storage)).toBe('ai');
    expect(loadWorkspacePane(storage)).toBe('doc');
    expect(storage.getItem(WORKSPACE_MODE_KEY)).toBe('ai');
    expect(storage.getItem(WORKSPACE_PANE_KEY)).toBe('doc');
    // 坏值容错
    const dirty = fakeStorage({ [WORKSPACE_MODE_KEY]: 'x', [WORKSPACE_PANE_KEY]: 'y' });
    expect(loadWorkspaceMode(dirty)).toBe('classic');
    expect(loadWorkspacePane(dirty)).toBe('cards');
  });
});
