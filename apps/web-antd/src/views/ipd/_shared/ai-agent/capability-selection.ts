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

/**
 * 动作入口默认候选工具的说明。只使用后端目录中该能力包内可用的工具。
 */
export const ACTION_TOOL_GAP_NOTE =
  '工具只来自当前能力包内的可用目录。可在加号里选择，智能体会按项目信息和任务需要调用已选工具。';

/**
 * 去掉空白和重复，保留小阶段目录给出的技能名顺序。
 *
 * @param names 目录 skillNames
 */
/**
 * 当前选择是否仍是「选中该包时默认勾上的全部可用技能和工具」。
 * 这种选择来自清单先加载、动作还没到，加号里还没有改过。
 *
 * @param selection 当前选择
 * @param pack 该动作唯一命中的可用包
 */
function isUntouchedPackFill(
  selection: AgentCapabilitySelection,
  pack: AgentCapabilityPack,
): boolean {
  if (selection.packCode !== pack.code || selection.packVersion !== pack.version) return false;
  const skills = pack.skills.filter((skill) => skill.available).map((skill) => skill.name);
  const tools = pack.tools.filter((tool) => tool.available).map((tool) => tool.id);
  return sameList(selection.skillNames, skills) && sameList(selection.toolIds, tools);
}

/**
 * 按顺序比较两份名单。加号改过一项就不会相等。
 *
 * @param left 当前名单
 * @param right 对照名单
 */
function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function approvedSkillList(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 动作入口的默认选择。
 *
 * 加号里改过的能力包保持不动。带了动作时，只在恰好一个可用包包含该动作、且目录里的
 * 已批准技能都能用时，才写入该包、这些技能和包内可用工具。若当前仍是该包的整包默认勾选，
 * 也改写成目录技能。
 * 没有动作时，仅在清单里只剩一个可用包才自动选中该包的全部可用技能和工具。
 * 已启用且可用的模型只在恰好一个时写入，多个时不猜默认。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 * @param actionCode 待办或动作带入的编码，可空
 * @param approvedSkillNames 小阶段目录里该动作的 skillNames
 */
export function applyEntryDefaults(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
  actionCode?: string,
  approvedSkillNames: readonly string[] = [],
): AgentCapabilitySelection {
  let next = selection;
  const packs = capabilities?.packs.filter((pack) => pack.available) ?? [];
  const code = actionCode?.trim() ?? '';
  if (code !== '') {
    const matched = packs.filter((pack) => pack.actionCodes.includes(code));
    const approved = approvedSkillList(approvedSkillNames);
    const pack = matched.length === 1 ? matched[0] : undefined;
    const available = new Set(pack?.skills.filter((skill) => skill.available).map((skill) => skill.name) ?? []);
    const canBind = Boolean(pack && approved.length > 0 && approved.every((name) => available.has(name)));
    // 清单先到、动作后到时，仅改写未被用户调整的默认选择；主动取消的工具不回填。
    if (canBind && pack && (next.packCode === null || isUntouchedPackFill(next, pack))) {
      next = {
        ...next,
        packCode: pack.code,
        packVersion: pack.version,
        skillNames: approved,
        toolIds: pack.tools.filter((tool) => tool.available).map((tool) => tool.id),
      };
    }
  } else if (next.packCode === null && packs.length === 1) {
    next = selectPackByKey(capabilities, next, packKey(packs[0]!));
  }
  const models = capabilities?.models.filter((model) => model.available) ?? [];
  if (next.modelConfigId === null && models.length === 1) {
    next = { ...next, modelConfigId: models[0]!.id };
  }
  return next;
}

/**
 * 带动作进入时不能开工的原因。空字符串表示当前选择可以提交。
 * 没有动作时不阻断，仍由调用方按「未选齐」处理。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 * @param actionCode 待办或动作带入的编码，可空
 * @param approvedSkillNames 小阶段目录里该动作的 skillNames
 */
export function describeActionEntryBlock(
  capabilities: null | ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
  actionCode?: string,
  approvedSkillNames: readonly string[] = [],
): string {
  const code = actionCode?.trim() ?? '';
  if (!code) return '';
  if (!capabilities) return '能力清单尚未加载，还不能绑定该动作。';
  const blocks: string[] = [];
  const pack = findSelectedPack(capabilities, selection);
  if (!pack) {
    blocks.push(unselectedPackBlock(capabilities, code, approvedSkillNames));
  } else if (!pack.actionCodes.includes(code)) {
    blocks.push(`当前能力包不包含动作 ${code}，发送不会绑定该动作。请改选包含该动作的能力包。`);
  } else if (!pack.available) {
    blocks.push(`能力包不可用：${pack.unavailableReason || '服务端未说明原因'}。`);
  } else if (selection.skillNames.length === 0) {
    blocks.push(`动作 ${code} 还没有选中技能，不能用空配置发送。`);
  } else if (!skillsAndToolsFit(pack, selection)) {
    blocks.push('当前技能或工具不在能力包可用范围内。');
  }
  const modelBlock = enabledModelBlock(capabilities, selection);
  if (modelBlock) blocks.push(modelBlock);
  return blocks.join('');
}

/**
 * 还没选中能力包时，说明是范围、技能还是多个包挡住了自动绑定。
 *
 * @param capabilities 能力清单
 * @param code 动作编码
 * @param approvedSkillNames 目录技能
 */
function unselectedPackBlock(
  capabilities: ProjectAgentCapabilities,
  code: string,
  approvedSkillNames: readonly string[],
): string {
  const matched = capabilities.packs.filter((item) => item.available && item.actionCodes.includes(code));
  if (matched.length > 1) {
    return `动作 ${code} 对应多个可用能力包，请在加号里选定一个后再发送。`;
  }
  if (matched.length === 0) {
    const unavailable = capabilities.packs.filter((item) => !item.available && item.actionCodes.includes(code));
    if (unavailable.length === 1) {
      return `动作 ${code} 所在能力包不可用：${unavailable[0]!.unavailableReason || '服务端未说明原因'}。`;
    }
    return `动作 ${code} 不在任何可用能力包内，不能绑定。未改用其他能力包。`;
  }
  const approved = approvedSkillList(approvedSkillNames);
  const available = new Set(matched[0]!.skills.filter((skill) => skill.available).map((skill) => skill.name));
  if (approved.length === 0) {
    return `动作 ${code} 在小阶段目录里没有已批准技能，不能用空技能绑定。可在加号里自行选择后再发送。`;
  }
  const missing = approved.filter((name) => !available.has(name));
  if (missing.length > 0) {
    return `动作 ${code} 已批准的技能未全部可用：${missing.join('、')}。未改用其他技能。`;
  }
  return '动作入口尚未写入能力包。';
}

/**
 * 已启用且可用的模型不是恰好一个、或当前选择不可用时的原因。
 *
 * @param capabilities 能力清单
 * @param selection 当前选择
 */
function enabledModelBlock(
  capabilities: ProjectAgentCapabilities,
  selection: AgentCapabilitySelection,
): string {
  const models = capabilities.models.filter((model) => model.available);
  const chosen = capabilities.models.find((model) => model.id === selection.modelConfigId);
  if (chosen?.available) return '';
  if (models.length > 1) return '有多个已启用模型，没有唯一默认配置，请在加号里选定。';
  if (models.length === 0) {
    const reason = capabilities.models.find((model) => model.reason)?.reason ?? '';
    return reason ? `没有已启用且可用的默认模型（${reason}）。` : '没有已启用且可用的默认模型。';
  }
  if (selection.modelConfigId) return '所选模型未启用，不能作为默认配置。';
  return '';
}

/**
 * 已选技能和工具是否都落在该包的可用项里。
 *
 * @param pack 当前能力包
 * @param selection 当前选择
 */
function skillsAndToolsFit(
  pack: AgentCapabilityPack,
  selection: AgentCapabilitySelection,
): boolean {
  const skills = new Set(pack.skills.filter((skill) => skill.available).map((skill) => skill.name));
  const tools = new Set(pack.tools.filter((tool) => tool.available).map((tool) => tool.id));
  return selection.skillNames.every((name) => skills.has(name))
    && selection.toolIds.every((id) => tools.has(id));
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
