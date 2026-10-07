/**
 * 「把 MCP 工具加入自己的智能体」共享逻辑（Track E 补口，零新增后端端点）。
 *
 * <p>与既有语义对齐的硬约束：
 * - 绑定值只用 **mcp_tool_info.id**（即市场工具的 localToolId）；绝不使用
 *   mcp_market_tool.id / marketId 作为智能体 mcpToolIds（M1 审计「易踩坑 #5」）；
 * - 保存采用「读全量 → 合并 → 写回」，保证 modelId / skillNames / knowledgeIds
 *   等既有字段不被覆盖（agentUpdate 为全量更新）；
 * - 已绑定则不重复写入（幂等）；单项失败不抛出，返回结果供 UI 诚实汇总。
 */
import type { AgentVO } from '#/api/agent/agent/model';

import { agentInfo, agentUpdate } from '#/api/agent/agent';

/** 归一工具编号：接受 number 或字符串数字（行 id 字符串化场景），非法值返回 null。 */
export function normalizeToolId(toolId: number | string): null | number {
  const n = Number(toolId);
  return Number.isFinite(n) ? n : null;
}

/** 合并工具编号：保留既有顺序 + 追加去重；过滤非数值脏值；不修改入参。 */
export function mergeMcpToolIds(
  existing: null | (number | string)[] | undefined,
  toolId: number,
): { changed: boolean; ids: number[] } {
  // 既有值必须经 normalizeToolId 归一：后端将 Long 序列化为字符串
  // （GET /agent/agent/{id} 实测返回 "mcpToolIds":["9","10"]），
  // 若按 typeof === 'number' 过滤会把既有绑定整段丢弃 → 幂等失效 + 既有工具被覆盖（实测回归）。
  const base = Array.isArray(existing)
    ? existing
        .map((n) => normalizeToolId(n))
        .filter((n): n is number => n !== null)
    : [];
  if (base.includes(toolId)) {
    return { changed: false, ids: [...base] };
  }
  return { changed: true, ids: [...base, toolId] };
}

/** 由智能体全量视图生成「追加一个 MCP 工具」的更新载荷（其余字段原样保留）。 */
export function buildAgentUpdatePayload(
  vo: Partial<AgentVO>,
  toolId: number,
): { changed: boolean; payload: Partial<AgentVO> } {
  const { changed, ids } = mergeMcpToolIds(vo.mcpToolIds, toolId);
  // 2026-10-07 修复「请求参数格式错误」400：agentInfo 回包中的 createTime/updateTime
  // 为「yyyy-MM-dd HH:mm:ss」空格格式字符串，而后端 @Primary ObjectMapper
  // （IpdPrimaryBeansConfig）对 java.util.Date 只认 ISO 格式，回写必失败
  // （历史成功的编辑请求均不含这两个字段）。故回写前剔除，其余字段仍全量回传。
  const rest = { ...vo };
  delete rest.createTime;
  delete rest.updateTime;
  return { changed, payload: { ...rest, mcpToolIds: ids } };
}

export type AddToolToAgentResult = 'added' | 'already' | 'failed';

/** 把本地工具加入单个智能体：读全量 → 合并 → 写回；失败返回 failed（不抛）。 */
export async function addToolToAgent(
  agentId: number | string,
  toolId: number | string,
): Promise<AddToolToAgentResult> {
  const normalizedToolId = normalizeToolId(toolId);
  if (normalizedToolId === null) {
    return 'failed';
  }
  try {
    const vo = await agentInfo(agentId);
    const { changed, payload } = buildAgentUpdatePayload(vo, normalizedToolId);
    if (!changed) {
      return 'already';
    }
    await agentUpdate(payload);
    return 'added';
  } catch {
    return 'failed';
  }
}

export interface AddToolBatchItem {
  agentId: number | string;
  agentName?: string;
  result: AddToolToAgentResult;
}

/** 批量加入（串行；数量小；逐项独立成败，供 UI 汇总展示，不弄虚成一次全成功）。 */
export async function addToolToAgents(
  toolId: number,
  agents: Array<{ agentName?: string; id: number | string }>,
): Promise<AddToolBatchItem[]> {
  const outcomes: AddToolBatchItem[] = [];
  for (const agent of agents) {
    // 串行执行：逐个读改写，避免并发覆盖同一智能体的 mcpToolIds
    const result = await addToolToAgent(agent.id, toolId);
    outcomes.push({
      agentId: agent.id,
      agentName: agent.agentName,
      result,
    });
  }
  return outcomes;
}
