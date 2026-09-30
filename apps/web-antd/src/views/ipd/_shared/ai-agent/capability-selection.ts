/**
 * 能力选择纯函数（W1）。
 *
 * 核心约束：提交给后端的能力包 code/version、modelConfigId、skillNames、toolIds 必须全部
 * 来自本次 agent-capabilities 响应且当前可用；清单刷新后已失效的选项会被剔除，不提交
 * 本地拼造或历史缓存的 ID。
 */
import type {
  AgentCapabilityPack,
  CreateAgentRunInput,
  ProjectAgentCapabilities,
} from '../../../../api/ipd/project-agent';

/** 用户当前的能力选择。 */
export interface AgentCapabilitySelection {
  packCode: null | string;
  packVersion: null | string;
  modelConfigId: null | string;
  skillNames: string[];
  toolIds: string[];
}

/** 空选择。 */
export function emptySelection(): AgentCapabilitySelection {
  return { packCode: null, packVersion: null, modelConfigId: null, skillNames: [], toolIds: [] };
}

/** 能力包在下拉框里的值（code + version 组合，JSON 编码避免分隔符冲突）。 */
export function packKey(pack: Pick<AgentCapabilityPack, 'code' | 'version'>): string {
  return JSON.stringify([pack.code, pack.version]);
}

/**
 * 按选择定位能力包（code 与 version 必须同时匹配）。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 */
export function findSelectedPack(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
): AgentCapabilityPack | null {
  if (!capabilities || selection.packCode === null) return null;
  return (
    capabilities.packs.find((p) => p.code === selection.packCode && p.version === selection.packVersion) ?? null
  );
}

/**
 * 选中能力包：默认勾选该包内全部可用 Skill 与工具，模型保持不变。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 * @param key 下拉框值（packKey 生成）
 */
export function selectPackByKey(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
  key: string,
): AgentCapabilitySelection {
  const pack = capabilities?.packs.find((p) => packKey(p) === key);
  if (!pack) return { ...selection, packCode: null, packVersion: null, skillNames: [], toolIds: [] };
  return {
    ...selection,
    packCode: pack.code,
    packVersion: pack.version,
    skillNames: pack.skills.filter((s) => s.available).map((s) => s.name),
    toolIds: pack.tools.filter((t) => t.available).map((t) => t.id),
  };
}

/**
 * 按最新能力清单剔除失效选项（包 / 模型不存在或不可用即清空，Skill/工具只保留仍可用者）。
 *
 * @param capabilities 最新能力清单
 * @param selection 当前选择
 */
export function sanitizeSelection(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
): AgentCapabilitySelection {
  if (!capabilities) return emptySelection();
  const pack = findSelectedPack(capabilities, selection);
  const model = capabilities.models.find((m) => m.id === selection.modelConfigId && m.available);
  const skills = new Set(pack?.skills.filter((s) => s.available).map((s) => s.name) ?? []);
  const tools = new Set(pack?.tools.filter((t) => t.available).map((t) => t.id) ?? []);
  return {
    packCode: pack ? pack.code : null,
    packVersion: pack ? pack.version : null,
    modelConfigId: model ? model.id : null,
    skillNames: selection.skillNames.filter((n) => skills.has(n)),
    toolIds: selection.toolIds.filter((id) => tools.has(id)),
  };
}

/**
 * 选择是否可提交：包与模型存在且可用，Skill/工具均为该包内可用项。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 */
export function isSelectionSubmittable(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
): boolean {
  const pack = findSelectedPack(capabilities, selection);
  if (!pack?.available) return false;
  const model = capabilities?.models.find((m) => m.id === selection.modelConfigId);
  if (!model?.available) return false;
  const skills = new Set(pack.skills.filter((s) => s.available).map((s) => s.name));
  const tools = new Set(pack.tools.filter((t) => t.available).map((t) => t.id));
  return selection.skillNames.every((n) => skills.has(n)) && selection.toolIds.every((id) => tools.has(id));
}

/**
 * 组装创建运行请求体；选择不可提交时返回 null（调用方据此禁用提交）。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 * @param message 用户任务说明（已裁剪空白）
 * @param idempotencyKey 调用方生成的幂等键
 * @param actionCode 步骤动作编码；不在当前能力包 actionCodes 里时不提交，避免整次运行被拒绝
 * @param actionSkillNames 该动作在目录上的技能；只并入能力包里可用的名字
 */
export function buildRunInput(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
  message: string,
  idempotencyKey: string,
  actionCode?: string,
  actionSkillNames: readonly string[] = [],
): CreateAgentRunInput | null {
  const pack = findSelectedPack(capabilities, selection);
  if (!pack || !selection.modelConfigId || !isSelectionSubmittable(capabilities, selection)) return null;
  const text = message.trim();
  if (!text) return null;
  const allowedSkills = new Set(pack.skills.filter((skill) => skill.available).map((skill) => skill.name));
  const skillNames = [...new Set([
    ...selection.skillNames,
    ...actionSkillNames.filter((name) => allowedSkills.has(name)),
  ])];
  const code = actionCode?.trim() ?? '';
  const boundAction = code !== '' && pack.actionCodes.includes(code) ? code : undefined;
  return {
    capabilityPackCode: pack.code,
    capabilityPackVersion: pack.version,
    modelConfigId: selection.modelConfigId,
    skillNames,
    toolIds: [...selection.toolIds],
    ...(boundAction ? { actionCode: boundAction } : {}),
    message: text,
    idempotencyKey,
  };
}
