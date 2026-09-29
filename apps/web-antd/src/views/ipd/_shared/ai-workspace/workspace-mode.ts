/**
 * AI 双业务模式：classic=传统页面的 AI 副驾，ai=项目智能体工作方式。
 * 窗口尺寸由组件独立控制。只持久化模式偏好，不持久化对话内容
 * （对话归档属 B5，互不耦合）。
 */
export type WorkspaceMode = 'ai' | 'classic';
export type WorkspacePane = 'cards' | 'doc' | 'canvas' | 'steps';

export const WORKSPACE_MODE_KEY = 'ipd:ai-workspace-mode';
export const WORKSPACE_PANE_KEY = 'ipd:ai-workspace-pane';
export const WORKSPACE_PANES: readonly WorkspacePane[] = [
  'cards',
  'steps',
  'canvas',
  'doc',
] as const;

export function normalizeMode(raw: null | string): WorkspaceMode {
  return raw === 'ai' ? 'ai' : 'classic';
}

export function normalizePane(raw: null | string): WorkspacePane {
  return (WORKSPACE_PANES as readonly string[]).includes(raw ?? '')
    ? (raw as WorkspacePane)
    : 'cards';
}

export function loadWorkspaceMode(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): WorkspaceMode {
  return normalizeMode(storage.getItem(WORKSPACE_MODE_KEY));
}

export function saveWorkspaceMode(
  storage: Pick<Storage, 'setItem'> = window.localStorage,
  mode: WorkspaceMode = 'classic',
): void {
  storage.setItem(WORKSPACE_MODE_KEY, normalizeMode(mode));
}

export function loadWorkspacePane(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): WorkspacePane {
  return normalizePane(storage.getItem(WORKSPACE_PANE_KEY));
}

export function saveWorkspacePane(
  storage: Pick<Storage, 'setItem'> = window.localStorage,
  pane: WorkspacePane = 'cards',
): void {
  storage.setItem(WORKSPACE_PANE_KEY, normalizePane(pane));
}
