/**
 * P0 升级链 API（R215 GAP-F4；后端 P0EscalationController，R149 batch2b C4 / AC-C4 决策）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/P0EscalationController.java：
 * - GET  /p0/escalation-chain?projectId=   升级链列表（ipd:p0-escalation:read + requireLeaderOrAdmin :50）
 * - POST /p0/escalation-chain/check        手动触发扫描（同码 + requireAdmin 仅超管 :60）
 * - POST /p0/escalation-chain/{id}/resolve 标记 RESOLVED（同码 + requireLeaderOrAdmin :72；
 *        remark 走 @RequestParam query，无 body——Controller :70-71）
 *
 * 边界：业务记录（P0 超期未升级 +1 count）由后端服务层 recordP0Unresolved 内部调用，
 * 刻意不暴露 HTTP 端点（Controller 头注 :32-33 防越权伪造）→ 前端无「新建升级链」入口。
 *
 * 契约口径：id/projectId/p0EventId 三 Long 经全局 BigNumberSerializer 双形态
 * （>2^53 string / 安全区间 number）→ 一律 String() 归一禁 Number()（19 位雪花精度）；
 * escalationCount 为 Integer 计数类才 Number()；状态机 PENDING→ESCALATED→RESOLVED
 * （P0EscalationService.java:54-56），未知值原样透传不炸列表。
 */
import { ipdGet, ipdPost } from './http';

/** 升级链状态（P0EscalationService 状态机 :53-56；未知值透传兜底 string）。 */
export type P0EscalationStatus = 'ESCALATED' | 'PENDING' | 'RESOLVED' | string;

/** 升级链行（P0EscalationChain 实体归一：三 Long ID string 透传，escalationCount 计数 Number）。 */
export interface P0EscalationChainView {
  escalationCount: number;
  id: string;
  lastEscalationAt: null | string;
  nextThresholdAt: null | string;
  p0EventId: string;
  projectId: string;
  remark: null | string;
  status: string;
}

/** check 扫描响应（Map.of("escalated", int)；int 计数归一 number）。 */
export interface EscalationCheckResult {
  escalated: number;
}

/** resolve 响应（Map.of("id", Long, "resolved", boolean)；id string 归一）。 */
export interface EscalationResolveResult {
  id: string;
  resolved: boolean;
}

/** P0EscalationChain 行归一（仿 hr-sync.ts normalize 范式；Date 字段 string 透传不做 Date()）。 */
function normalizeChain(raw: unknown): P0EscalationChainView {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    escalationCount: Number(row.escalationCount ?? 0), // Integer 计数类，唯一 Number 归一点
    id: String(row.id ?? ''),
    lastEscalationAt: row.lastEscalationAt == null ? null : String(row.lastEscalationAt),
    nextThresholdAt: row.nextThresholdAt == null ? null : String(row.nextThresholdAt),
    p0EventId: String(row.p0EventId ?? ''),
    projectId: String(row.projectId ?? ''),
    remark: row.remark == null ? null : String(row.remark),
    status: String(row.status ?? ''),
  };
}

/**
 * 列出升级链（组长/超管可读；projectId 选填过滤，后端 @RequestParam(required=false) :49）。
 * projectId 19 位雪花 string 逐字符透传，缺省/空串不拼 query。
 */
export async function listEscalationChains(projectId?: string): Promise<P0EscalationChainView[]> {
  const query = projectId !== undefined && projectId !== '' ? { projectId } : undefined;
  const rows = await ipdGet<unknown[]>('/p0/escalation-chain', query);
  return (rows ?? []).map(normalizeChain);
}

/**
 * 手动触发升级扫描（仅 SUPER_ADMIN，requireAdmin :60；运维/测试用，正常轮询待 scheduler）。
 * 返回本次升级条数（escalationCount>=2 的 PENDING 记录触发双方组长通知）。
 */
export async function checkEscalation(): Promise<EscalationCheckResult> {
  const r = await ipdPost<Record<string, unknown>>('/p0/escalation-chain/check');
  const row = r ?? {};
  return { escalated: Number(row.escalated ?? 0) };
}

/**
 * 标记升级链 RESOLVED（组长/超管；处置完成后关闭）。
 * remark 选填走 @RequestParam query（后端无 body 形参，Controller :71）→ ipdPost 第三参，
 * 缺省/空串不拼 query；id 路径段 encodeURIComponent，禁任何数值化。
 */
export async function resolveEscalationChain(id: string, remark?: string): Promise<EscalationResolveResult> {
  const query = remark !== undefined && remark !== '' ? { remark } : undefined;
  const r = await ipdPost<Record<string, unknown>>(
    `/p0/escalation-chain/${encodeURIComponent(id)}/resolve`,
    undefined,
    query,
  );
  const row = r ?? {};
  return { id: String(row.id ?? id), resolved: row.resolved === true };
}
