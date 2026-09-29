/**
 * 市场工具元数据 → Schema 树（Track E2，AntD 等价 21st 参照 29970 Schema Viewer）。
 *
 * <p>纯函数层：不 import api/组件。metadataView 缺席（E2-BE-1 未落地）时返回
 * available=false，渲染层出诚实空态，不伪造字段（约束 #7）。树深度/节点数双护栏，
 * 超限截断为「…」占位节点（标注真实截断事实，非 TODO 占位符）。
 */

/** 树节点（scalar=叶子；object/array=容器带 children）。 */
export interface MetadataNode {
  children: MetadataNode[];
  key: string;
  kind: 'array' | 'object' | 'scalar';
  value: string;
}

export interface MetadataView {
  available: boolean;
  nodes: MetadataNode[];
}

export const METADATA_MAX_DEPTH = 6;
export const METADATA_MAX_NODES = 200;

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

interface BuildBudget {
  emitted: number;
  /** 节点上限截断标记只允许产出一次（验收断言：nodes.length ≤ MAX+1）。 */
  overflowNoted: boolean;
}

function buildNode(
  key: string,
  value: unknown,
  depth: number,
  budget: BuildBudget,
): null | MetadataNode {
  if (budget.emitted >= METADATA_MAX_NODES) {
    if (budget.overflowNoted) return null;
    budget.overflowNoted = true;
    return { children: [], key: `${key}（已达 ${METADATA_MAX_NODES} 节点上限，余下截断）`, kind: 'scalar', value: '…' };
  }
  budget.emitted += 1;
  if (value !== null && typeof value === 'object' && depth >= METADATA_MAX_DEPTH) {
    return { children: [], key: `${key}（已达 ${METADATA_MAX_DEPTH} 层深度上限，深层截断）`, kind: 'scalar', value: '…' };
  }
  if (Array.isArray(value)) {
    return {
      children: value
        .map((item, index) => buildNode(String(index), item, depth + 1, budget))
        .filter((node): node is MetadataNode => node !== null),
      key,
      kind: 'array',
      value: `Array(${value.length})`,
    };
  }
  if (value !== null && typeof value === 'object') {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => buildNode(childKey, childValue, depth + 1, budget))
      .filter((node): node is MetadataNode => node !== null);
    return { children, key, kind: 'object', value: `Object(${children.length})` };
  }
  return { children: [], key, kind: 'scalar', value: scalarText(value) };
}

/**
 * metadataView → 树视图。raw 非对象（null/undefined/数组/字符串）一律 available=false
 * （该键由后端白名单投影保证是对象；异常形态不带病渲染）。
 */
export function parseMetadataView(raw: unknown): MetadataView {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { available: false, nodes: [] };
  }
  const budget: BuildBudget = { emitted: 0, overflowNoted: false };
  const nodes = Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => buildNode(key, value, 0, budget))
    .filter((node): node is MetadataNode => node !== null);
  return { available: nodes.length > 0, nodes };
}
