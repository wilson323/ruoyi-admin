/**
 * @deprecated 自 2026-09-06 根因分析后：本文件统一为 product.ts 的 re-export。
 * 历史重复（listProductGroups、IpdProductGroup 等）已迁入 product.ts。
 * 消费方应改 import 自 './product'，本文件保留仅供旧 import 兼容。
 *
 * 治理依据：docs/ipd-系统说明/前端架构规约-20260906.md §3
 * 守护机制：.claude/helpers/ipd-frontend-drift-guard.cjs + scripts/check-ipd-frontend-drift.sh
 */
export type { ProductGroup as IpdProductGroup, ProductGroupLeaderReq as IpdProductGroupLeaderReq } from './product';
export {
  listProductGroups,
  getProductGroup,
  updateProductGroupLeader,
} from './product';
