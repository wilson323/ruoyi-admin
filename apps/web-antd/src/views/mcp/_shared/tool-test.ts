/**
 * MCP 工具连接测试三态视图模型（Track E1）。
 *
 * <p>三态词汇与 `views/ipd/_shared/ai-cards/copilotkit-render.ts` 的 CardToolStatus
 * 同构（inProgress=待执行 / executing=请求飞行中 / complete=结果已达），跨轨共用同一
 * 状态词汇，不发明第四态。本文件为纯函数层：不 import 任何 api/组件，可被 vitest
 * 直接加载（白名单见 E5-⑥：views/mcp/** 已扩入 include）。
 *
 * <p>修 §0.5 痛点④：测试结果不再只弹一行 message toast，而是 normalize 成结构化
 * 视图状态（三态 + 成败 + 耗时 + 结果键值行），由 tool-test-panel.vue 渲染。
 *
 * <p>颜色红线（Global Constraints #21）：本层零样式；渲染层只用 `var(--ipd-*)`。
 */

/** 测试生命周期三态（= CardToolStatus 字面量联合）。 */
export type ToolTestPhase = 'complete' | 'executing' | 'inProgress';

/** 结果载荷展开行（对象逐键展开；非对象值 JSON 序列化为单行）。 */
export interface ToolTestPayloadRow {
  key: string;
  value: string;
}

/** 连接测试面板状态（纯数据，无 Vue 依赖）。 */
export interface ToolTestViewState {
  /** 耗时毫秒；未测过为 null。 */
  durationMs: null | number;
  /** 结果说明（normalize 时补齐成败缺省文案，绝不留空占位）。 */
  message: null | string;
  phase: ToolTestPhase;
  payloadRows: ToolTestPayloadRow[];
  /** 成功 true / 失败 false / 未测 null。 */
  success: null | boolean;
  /** ISO 时间戳；未测过为 null（hasResult 判据）。 */
  testedAt: null | string;
}

/**
 * 后端 McpToolTestResult 的结构等价形态（`api/mcp/tool/model.d.ts`：
 * `{ success: boolean; message: string; data?: any }`）。用结构类型而非 import，
 * 保持纯函数层零运行时依赖。
 */
export interface ToolTestResponse {
  data?: unknown;
  message?: null | string;
  success: boolean;
}

/** 结果行上限：防超大 payload 撑爆渲染（超出截断，行内不伪造补位行）。 */
export const TOOL_TEST_PAYLOAD_ROW_LIMIT = 50;

/** 未测初始态（phase=inProgress、testedAt=null）。 */
export function idleToolTestState(): ToolTestViewState {
  return {
    durationMs: null,
    message: null,
    phase: 'inProgress',
    payloadRows: [],
    success: null,
    testedAt: null,
  };
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // BigInt/循环引用等极端值走字面兜底，不断渲染
    return String(value);
  }
}

/**
 * 载荷 → 展示行：对象逐键展开（截断至 TOOL_TEST_PAYLOAD_ROW_LIMIT）；
 * 数组/标量折叠为单行 `result`；null/undefined 返回空数组（面板显示空态文案）。
 */
export function payloadToRows(data: unknown): ToolTestPayloadRow[] {
  const rows: ToolTestPayloadRow[] = [];
  if (data === null || data === undefined) return rows;
  if (typeof data !== 'object' || Array.isArray(data)) {
    rows.push({ key: 'result', value: stringifyValue(data) });
    return rows;
  }
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (rows.length >= TOOL_TEST_PAYLOAD_ROW_LIMIT) break;
    rows.push({ key, value: stringifyValue(value) });
  }
  return rows;
}

/** 后端结果 → 终态（phase=complete；message 缺省按成败补诚实文案）。 */
export function normalizeToolTestResult(
  response: ToolTestResponse,
  durationMs: number,
  testedAt: string,
): ToolTestViewState {
  const success = response.success === true;
  const rawMessage =
    typeof response.message === 'string' ? response.message.trim() : '';
  return {
    durationMs,
    message:
      rawMessage === ''
        ? success
          ? '连接测试通过'
          : '连接测试失败'
        : rawMessage,
    phase: 'complete',
    payloadRows: payloadToRows(response.data),
    success,
    testedAt,
  };
}

/** 请求异常 → 失败终态（网络/服务异常也走 complete+success=false，不断面板）。 */
export function failedToolTestState(
  message: string,
  durationMs: number,
  testedAt: string,
): ToolTestViewState {
  return {
    durationMs,
    message,
    phase: 'complete',
    payloadRows: [],
    success: false,
    testedAt,
  };
}

/** 耗时展示（null = 未测，输出长横线，不输出 0ms 误导）。 */
export function formatDuration(durationMs: null | number): string {
  return durationMs === null ? '—' : `${durationMs} ms`;
}
