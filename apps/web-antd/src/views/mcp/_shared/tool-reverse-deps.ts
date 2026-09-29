/**
 * 反向依赖索引（Track E1/E3 共用纯函数）。
 *
 * <p>数据源 = 既有 `agentList`（AgentVO 携带 mcpToolIds / skillNames），
 * **客户端计算反向索引，零后端改动**（约束 #20：不绕过后端契约发明读接口）。
 * 结果按 agentName 字典序 + id 升序排序，保证渲染与断言确定性。
 */

/** AgentVO 的最小结构依赖（只取反向索引需要的键，不 import model 保持纯函数）。 */
export interface AgentBinding {
  agentName: string;
  id: number;
  mcpToolIds?: null | number[];
  skillNames?: null | string[];
}

/** 反向依赖条目（哪个 Agent 绑了这个工具/技能）。 */
export interface ReverseDep {
  agentId: number;
  agentName: string;
}

export type ToolReverseDepMap = Map<number, ReverseDep[]>;
export type SkillReverseDepMap = Map<string, ReverseDep[]>;

function pushDep<K>(map: Map<K, ReverseDep[]>, key: K, dep: ReverseDep): void {
  const list = map.get(key);
  if (list) {
    list.push(dep);
  } else {
    map.set(key, [dep]);
  }
}

function sortDeps(deps: ReverseDep[]): ReverseDep[] {
  return [...deps].sort(
    (a, b) => a.agentName.localeCompare(b.agentName) || a.agentId - b.agentId,
  );
}

/** 工具 id → 绑定该工具的 Agent 列表（mcpToolIds 为 null/空则该 Agent 不入任何键）。 */
export function buildToolReverseDeps(agents: AgentBinding[]): ToolReverseDepMap {
  const map: ToolReverseDepMap = new Map();
  for (const agent of agents) {
    const ids = agent.mcpToolIds ?? [];
    for (const toolId of ids) {
      if (typeof toolId !== 'number' || !Number.isFinite(toolId)) continue;
      pushDep(map, toolId, { agentId: agent.id, agentName: agent.agentName });
    }
  }
  return map;
}

/** 技能名 → 绑定该技能的 Agent 列表（skillNames 为 null/空则该 Agent 不入任何键）。 */
export function buildSkillReverseDeps(
  agents: AgentBinding[],
): SkillReverseDepMap {
  const map: SkillReverseDepMap = new Map();
  for (const agent of agents) {
    const names = agent.skillNames ?? [];
    for (const skillName of names) {
      if (typeof skillName !== 'string' || skillName === '') continue;
      pushDep(map, skillName, { agentId: agent.id, agentName: agent.agentName });
    }
  }
  return map;
}

/** 取反向依赖（未知键返回空数组；返回排序副本，调用方不可变体被污染）。 */
export function reverseDepsOf<K>(map: Map<K, ReverseDep[]>, key: K): ReverseDep[] {
  return sortDeps(map.get(key) ?? []);
}
