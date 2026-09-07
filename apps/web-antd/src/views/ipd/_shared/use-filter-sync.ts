/**
 * 列表页筛选条件 ↔ URL query 双向绑定 helper（V7）。
 *
 * <p>设计目标：列表页筛选状态可分享 / 可后退 / 可前进 / 刷新不丢失。
 * <ul>
 *   <li>初始：route.query → state（query 缺省时回退 initial[key]）</li>
 *   <li>更新：state → route.query（router.replace 不留历史）</li>
 *   <li>外部回退：浏览器后退 / 跨页跳转，state 自动跟随 query</li>
 * </ul>
 *
 * <p>使用方式：
 * <pre>
 * import { useFilterSync } from '../_shared/use-filter-sync';
 *
 * const filters = reactive({ keyword: '', status: 'ALL', projectId: '' });
 * useFilterSync(filters, { ignored: ['projectId'] });
 * </pre>
 */

import { reactive, watch } from 'vue';
import {
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type LocationQueryRaw,
  type LocationQueryValue,
} from 'vue-router';

export interface FilterSyncOptions {
  /** 不参与 URL 同步的字段名（如仅本地关心的临时筛选） */
  ignored?: readonly string[];
  /** 字符串数组拼接分隔符（默认 ','） */
  arrayJoiner?: string;
  /** 默认值字段：query 中缺省时使用的兜底（避免污染 URL） */
  defaults?: Record<string, string>;
  /** 路由跳转方式：'replace' 不留历史（默认），'push' 留历史 */
  replace?: boolean;
  /** 当用户输入空值时是否写回 query（默认 false：空值不回写，避免冗余） */
  writeEmpty?: boolean;
}

type FilterRecord = Record<string, string | string[]>;

/**
 * 解析 route.query 中单个 key 为 string：数组取首项、null/undefined 转空串。
 */
function readQueryScalar(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value[0] ?? '';
  return value;
}

/**
 * 把 state 值序列化为 query 字面量（空值视情况丢弃）。
 */
function serializeValue(value: string | string[], writeEmpty: boolean): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return writeEmpty ? '' : undefined;
    return value.join(',');
  }
  if (value === '' || value === null || value === undefined) return writeEmpty ? '' : undefined;
  return value;
}

/**
 * 把 query 字符串还原为 state 值：已知 arrayJoiner 拼回数组。
 */
function deserializeValue(
  raw: string,
  sample: string | string[],
  joiner: string,
): string | string[] {
  if (Array.isArray(sample)) {
    if (!raw) return [];
    return raw.split(joiner).filter(Boolean);
  }
  return raw;
}

/**
 * 把 state 同步到 route.query。返回触发次数累计（测试用）。
 */
export function useFilterSync<T extends FilterRecord>(
  state: T,
  options: FilterSyncOptions = {},
): { syncCount: { value: number } } {
  const route = useRoute();
  const router = useRouter();
  const ignored = new Set(options.ignored ?? []);
  const joiner = options.arrayJoiner ?? ',';
  const useReplace = options.replace ?? true;
  const writeEmpty = options.writeEmpty ?? false;
  const syncCount = { value: 0 };

  // 1. 初始同步：query → state（仅在 state 已有键上覆写，不引入新键）
  for (const key of Object.keys(state)) {
    if (ignored.has(key)) continue;
    const sample = state[key];
    if (sample === undefined) continue;
    const raw = readQueryScalar(route.query[key] as LocationQueryValue | LocationQueryValue[]);
    const next = deserializeValue(raw, sample, joiner);
    if (Array.isArray(sample)) {
      (state as FilterRecord)[key] = next as string[];
    } else if (raw || options.defaults?.[key] !== undefined) {
      (state as FilterRecord)[key] = (options.defaults?.[key] ?? raw) as string;
    }
  }

  // 2. state → query
  const stopWrite = watch(
    state,
    (next) => {
      const query: LocationQueryRaw = { ...route.query };
      for (const [key, value] of Object.entries(next)) {
        if (ignored.has(key)) continue;
        const serialized = serializeValue(value, writeEmpty);
        if (serialized === undefined) {
          delete query[key];
        } else {
          query[key] = serialized;
        }
      }
      syncCount.value++;
      const navigate = useReplace ? router.replace : router.push;
      void navigate({ path: route.path, query });
    },
    { deep: true },
  );

  // 3. route.query → state（外部触发：浏览器后退 / 跨页跳转）
  // onBeforeRouteUpdate 在测试或非路由上下文环境会抛 "No active router"；
  // 此处用 try/catch 兜底，单测场景下跳过 route 同步，但 state ↔ query 双向绑定在
  // 真实路由环境仍生效（watch 持续运作）。
  try {
    onBeforeRouteUpdate((to, _from, next) => {
      for (const key of Object.keys(state)) {
        if (ignored.has(key)) continue;
        const sample = state[key];
        if (sample === undefined) continue;
        const raw = readQueryScalar(to.query[key] as LocationQueryValue | LocationQueryValue[]);
        const nextValue = deserializeValue(raw, sample, joiner);
        if (Array.isArray(sample)) {
          (state as FilterRecord)[key] = nextValue as string[];
        } else if (raw || options.defaults?.[key] !== undefined) {
          (state as FilterRecord)[key] = (options.defaults?.[key] ?? raw) as string;
        }
      }
      next();
    });
  } catch {
    // 静默降级：单测或非路由上下文环境跳过
  }

  // 触发 stop（Vue 自动清理）
  void stopWrite;

  return { syncCount };
}

/** 工厂版：与 reactive 配套使用，初始化空表单 + 一次性绑定。 */
export function createFilterState<T extends Record<string, string | string[]>>(
  initial: T,
): T {
  return reactive({ ...initial }) as T;
}
