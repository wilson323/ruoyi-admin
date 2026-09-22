/**
 * Gate 评审要素按钮决策（前端单一权威源；R175-A）。
 *
 * 状态机（与后端 `GateElementService.STATUS_*` 对齐）：
 * - lifecycle: draft | published | archived
 * - enabled:   '0' | '1'
 *
 * 行内 9 个按钮决策矩阵（4 状态 × 9 按钮 = 36 决策点）：
 *
 * | 状态 \\ 按钮     | edit | disable | enable | publish | archive | copy | duplicate | revert | restore |
 * | DRAFT(enabled=0) |  ✓  |   ✗    |   ✗   |   ✓   |   ✓    |  ✓  |    ✓    |   ✓  |    ✗   |
 * | PUBLISHED(on)    |  ✓  |   ✓    |   ✗   |   ✗   |   ✓    |  ✓  |    ✓    |   ✓  |    ✗   |
 * | PUBLISHED(off)   |  ✗  |   ✗    |   ✓   |   ✗   |   ✓    |  ✓  |    ✓    |   ✓  |    ✗   |
 * | ARCHIVED         |  ✗  |   ✗    |   ✗   |   ✗   |   ✗    |  ✓  |    ✓    |   ✗  |    ✓   |
 *
 * 「新建」按钮位于页面顶部，与具体行无关，因此行决策只看 9 个按钮。
 * 决策函数纯函数无副作用，便于 vitest 覆盖。
 */

/** 生命周期状态。 */
export type GateElementLifecycle = 'archived' | 'draft' | 'published';
/** 启停位。 */
export type GateElementEnabled = '0' | '1';

export interface GateElementButtonState {
  enabled: GateElementEnabled;
  lifecycle: GateElementLifecycle;
}

/** 行内 9 个按钮。 */
export type GateElementRowButton =
  | 'archive'
  | 'copy'
  | 'disable'
  | 'duplicate'
  | 'edit'
  | 'enable'
  | 'publish'
  | 'restore'
  | 'revert';

export interface ButtonPolicyDecision {
  /** 后端契约已禁止；前置隐藏避免无效请求。 */
  hidden: boolean;
  /** 隐藏原因（中文；前端 hover tooltip 用）。 */
  reason?: string;
  /** 显示。 */
  visible: boolean;
}

const VISIBLE: ButtonPolicyDecision = Object.freeze({ hidden: false, visible: true });
const HIDDEN = (reason: string): ButtonPolicyDecision => Object.freeze({ hidden: true, visible: false, reason });

/**
 * 单一决策函数。state 必须同时提供 lifecycle 与 enabled；缺一即按最严约束视为 ARCHIVED。
 */
export function decideRowButton(
  button: GateElementRowButton,
  state: GateElementButtonState,
): ButtonPolicyDecision {
  const { enabled, lifecycle } = state;
  switch (button) {
    case 'edit':
      // 仅 DRAFT 或 PUBLISHED(enabled='1') 可编辑定义
      // ARCHIVED 不可编辑（终态）；PUBLISHED 已被 disable 后不可编辑（须先恢复启用或重新 publish）
      if (lifecycle === 'draft') return VISIBLE;
      if (lifecycle === 'published') {
        return enabled === '1'
          ? VISIBLE
          : HIDDEN('停用状态下不可编辑，需先启用');
      }
      return HIDDEN('已归档不可编辑，请先恢复为草稿');

    case 'disable':
      // 仅 PUBLISHED(enabled='1') 可停用
      if (lifecycle === 'published') {
        return enabled === '1' ? VISIBLE : HIDDEN('当前已停用');
      }
      if (lifecycle === 'draft') return HIDDEN('草稿尚未发布，无须停用');
      return HIDDEN('已归档不可停用');

    case 'enable':
      // PUBLISHED(enabled='0') 可启用；DRAFT 不可（须先 publish）
      if (lifecycle === 'published') {
        return enabled === '0' ? VISIBLE : HIDDEN('当前已启用');
      }
      if (lifecycle === 'draft') return HIDDEN('草稿未发布，请使用「发布」按钮');
      return HIDDEN('已归档不可启用，请先恢复');

    case 'publish':
      // 仅 DRAFT 可发布
      if (lifecycle === 'draft') return VISIBLE;
      if (lifecycle === 'published') return HIDDEN('已发布');
      return HIDDEN('已归档不可发布，请先恢复');

    case 'archive':
      // DRAFT 或 PUBLISHED 可归档；ARCHIVED 不可
      if (lifecycle === 'archived') return HIDDEN('已归档');
      return VISIBLE;

    case 'copy':
      // 任何状态都可复制（生成新编码的草稿副本）
      return VISIBLE;

    case 'duplicate':
      // 任何状态都可复制为副本（编码自动生成）
      return VISIBLE;

    case 'restore':
      // 仅 ARCHIVED 可恢复
      if (lifecycle === 'archived') return VISIBLE;
      if (lifecycle === 'draft') return HIDDEN('当前为草稿，无须恢复');
      return HIDDEN('当前已发布，请使用「归档」');

    case 'revert':
      // DRAFT 或 PUBLISHED 可回滚到历史快照；ARCHIVED 不可
      if (lifecycle === 'archived') return HIDDEN('已归档不可回滚');
      return VISIBLE;
  }
}

/** 行按钮顺序（操作列从左到右）。 */
export const ROW_BUTTON_ORDER: readonly GateElementRowButton[] = Object.freeze([
  'edit',
  'enable',
  'disable',
  'publish',
  'archive',
  'copy',
  'duplicate',
  'revert',
  'restore',
]);

/** 行按钮显示名。 */
export const ROW_BUTTON_LABEL: Readonly<Record<GateElementRowButton, string>> = Object.freeze({
  archive: '归档',
  copy: '复制',
  disable: '停用',
  duplicate: '副本',
  edit: '编辑',
  enable: '启用',
  publish: '发布',
  restore: '恢复',
  revert: '回滚',
});