/**
 * IPD 全站展示格式化工具（全局一致性的落点之一）。
 *
 * 约定：
 * - 后端 ID/金额均为字符串，前端不做数值化；金额展示统一两位小数 + 千分位；
 * - 未知值一律显示「待补充 / 未配置」（G-06 禁止空白与绝对化承诺）；
 * - 时间只做显式格式化，不做递归转换；
 * - 涉钱数字使用 tabular-nums（配合 class="tabular-nums"）。
 */

export const PENDING_TEXT = '待补充';
export const UNCONFIGURED_TEXT = '未配置';

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
}

/** 金额：字符串/数字统一两位小数 + 千分位；空值显示「待补充」。 */
export function formatMoney(value: null | number | string, fallback = PENDING_TEXT): string {
  if (isBlank(value)) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 百分比：自动归一化——传 0.6 / 60 / 120 都会得到合理的「XX%」输出；空值显示「待补充」。 */
export function formatPercent(value: null | number | string, fallback = PENDING_TEXT): string {
  if (isBlank(value)) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  // 自动归一化：<=1 且非整数的判定为小数（0.6 → 60%）；整数视为已是百分数（60 → 60%；120 → 120%）
  const normalized = num <= 1 && !Number.isInteger(num) ? num * 100 : num;
  return `${normalized.toFixed(2).replace(/\.?0+$/, '')}%`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function toDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 日期时间：ISO 字符串 → `YYYY-MM-DD HH:mm`；空值显示「待补充」。 */
export function formatDateTime(value: null | number | string | undefined, fallback = PENDING_TEXT): string {
  if (isBlank(value)) return fallback;
  const raw = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : toDate(String(value));
  if (!raw) return fallback;
  return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())} ${pad(raw.getHours())}:${pad(raw.getMinutes())}`;
}

/** 日期：ISO 字符串 → `YYYY-MM-DD`；空值显示「待补充」。 */
export function formatDate(value: null | number | string | undefined, fallback = PENDING_TEXT): string {
  const full = formatDateTime(value, '');
  return full ? full.slice(0, 10) : fallback;
}

/** 深管/轻管管理类型标签文案（术语表：不得写作"重点/普通动作"）。 */
export function managementTypeText(type: null | string | undefined): string {
  if (type === 'DEEP') return '深管动作';
  if (type === 'LIGHT') return '轻管动作';
  return PENDING_TEXT;
}
