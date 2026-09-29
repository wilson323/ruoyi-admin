/**
 * AI 工作界面共享状态中枢（单例 refs）。
 * 单轨红线 #1 落点：messages/cardView 等对话状态仍**只**存在于 ai-assistant.vue，
 * 本中枢只承载「布局与展示 pane」状态（mode/pane/步骤选中/文档草稿），绝不同步第二份对话。
 */
import { ref, type Ref } from 'vue';

import {
  loadWorkspaceMode,
  loadWorkspacePane,
  saveWorkspaceMode,
  saveWorkspacePane,
  type WorkspaceMode,
  type WorkspacePane,
} from './workspace-mode';

export interface IpdAiWorkspace {
  activeSubStageCode: Ref<null | string>;
  docHtml: Ref<string>;
  docTitle: Ref<string>;
  mode: Ref<WorkspaceMode>;
  pane: Ref<WorkspacePane>;
  setMode: (mode: WorkspaceMode) => void;
  setPane: (pane: WorkspacePane) => void;
}

const mode = ref<WorkspaceMode>(loadWorkspaceMode());
const pane = ref<WorkspacePane>(loadWorkspacePane());
const activeSubStageCode = ref<null | string>(null);
const docTitle = ref('未命名文档');
const docHtml = ref('');

export function useIpdAiWorkspace(): IpdAiWorkspace {
  return {
    activeSubStageCode,
    docHtml,
    docTitle,
    mode,
    pane,
    setMode: (next: WorkspaceMode) => {
      mode.value = next;
      saveWorkspaceMode(window.localStorage, next);
    },
    setPane: (next: WorkspacePane) => {
      pane.value = next;
      saveWorkspacePane(window.localStorage, next);
    },
  };
}
