/**
 * 审批/任务队列「列表 + 行级操作」共享 composable（D-3⑧ schema 抽取第一批）。
 *
 * <p>消除的重复面（deletion/review、deletion/my-requests、deletion/archive、
 * admin/p0-escalation 等页逐字重复的骨架）：
 * <ul>
 *   <li>列表态：rows + loading + load()（canLoad 权限门短路 + try/catch message.error）</li>
 *   <li>行操作：busyId 防重入 + 成功 message.success + 本地更新（remove/replace/reload）
 *       + 失败 message.error + finally 释放</li>
 *   <li>ID 一律字符串透传（drift-guard 红线：禁 Number() 转换，long ID 精度丢失教训）</li>
 * </ul>
 *
 * <p>设计边界（防过度抽象）：端点调用（action 闭包）与文案由页面传入，角色分流
 * （leader/admin 派发不同端点）留在页面侧——composable 只管队列状态机，不懂业务语义。
 * 存量页渐进改造，示范页：deletion/archive（纯队列）+ deletion/review（队列 + 决策表单）。
 */
import { ref, type Ref } from 'vue';

import { message } from 'ant-design-vue';

/** Table bodyCell 插槽的 record 是宽松对象；行操作入参统一接受三种形态。 */
export type RowLike<T> = Record<string, any> | T | string;

/** 行操作成功后的本地队列更新方式。 */
export type RowOutcome = 'reload' | 'remove' | 'replace';

export interface ApprovalQueueOptions<T> {
  /** 队列查询端点（返回值需含可提取 id 的行；泛型由页面收窄）。 */
  fetchList: () => Promise<T[]>;
  /** 行 id 提取器：返回字符串（禁数值化）。 */
  getId: (row: T) => string;
  /** 加载守卫（角色/权限门，false 时 load 零请求，与存量页 isAdmin 短路一致）。 */
  canLoad?: () => boolean;
  /** 加载失败兜底文案（Error.message 缺席时）。 */
  loadErrorFallback?: string;
}

export interface RunRowActionOptions<T, R = unknown> {
  /** 行数据（DeletionRequest 全文 / bodyCell record / 仅 id 字符串均可）。 */
  row: RowLike<T>;
  /** 真实端点调用：入参为提取后的字符串 id，角色派发由页面在闭包内完成。 */
  action: (id: string) => Promise<R>;
  /** 成功提示文案（字符串或按结果生成）。 */
  successText: ((result: R) => string) | string;
  /** 本地更新方式：remove=成功后先摘行再 reload；replace=结果行原位替换再 reload；默认 reload。 */
  outcome?: RowOutcome;
  /** outcome='replace' 必填：端点结果 → 列表行的映射。 */
  toRow?: (result: R) => T;
  /** 成功后附加回调（如页面「最近一次结果」回显）。 */
  onDone?: (result: R) => void;
  /** 操作失败兜底文案（Error.message 缺席时）。 */
  errorFallback?: string;
}

export interface ApprovalQueue<T> {
  rows: Ref<T[]>;
  loading: Ref<boolean>;
  /** 正在执行行操作的行 id（'' = 空闲）；与存量页 decidingRowId/purgingId 同语义。 */
  busyId: Ref<string>;
  /** 错误文案（空串 = 无错误）；页面可选渲染，message.error 已同步弹出。 */
  errorMsg: Ref<string>;
  load: () => Promise<void>;
  runRowAction: <R>(options: RunRowActionOptions<T, R>) => Promise<R | null>;
}

/** 行入参 → 字符串 id（三形态归一：字符串直接用，对象一律经页面 getId 提取）。 */
function extractId<T>(row: RowLike<T>, getId: (row: T) => string): string {
  if (typeof row === 'string') return row.trim();
  return String(getId(row as T) ?? '').trim();
}

/**
 * 队列状态机入口。页面用法：
 * <pre>
 * const { rows, loading, busyId, load, runRowAction } = useApprovalQueue&lt;DeletionRequest&gt;({
 *   fetchList: listDeletionArchive,
 *   getId: (row) => String(row.id ?? ''),
 *   canLoad: () => isAdmin.value,
 * });
 * </pre>
 */
export function useApprovalQueue<T>(options: ApprovalQueueOptions<T>): ApprovalQueue<T> {
  const { fetchList, getId, canLoad, loadErrorFallback = '加载列表失败' } = options;

  const rows = ref([]) as Ref<T[]>;
  const loading = ref(false);
  const busyId = ref('');
  const errorMsg = ref('');

  async function load(): Promise<void> {
    if (canLoad && !canLoad()) {
      rows.value = [];
      return;
    }
    loading.value = true;
    errorMsg.value = '';
    try {
      rows.value = await fetchList();
    } catch (error) {
      const text = error instanceof Error ? error.message : loadErrorFallback;
      errorMsg.value = text;
      message.error(text);
    } finally {
      loading.value = false;
    }
  }

  function errorTextOf(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  async function runRowAction<R>(opts: RunRowActionOptions<T, R>): Promise<R | null> {
    const id = extractId(opts.row, getId);
    if (!id || busyId.value) return null;
    busyId.value = id;
    errorMsg.value = '';
    try {
      const result = await opts.action(id);
      const success = typeof opts.successText === 'function'
        ? opts.successText(result)
        : opts.successText;
      if (success) message.success(success);
      // 本地更新（与存量页行为对齐：remove 先摘行、replace 原位替换，随后都 reload 防脏读）
      if (opts.outcome === 'remove') {
        rows.value = rows.value.filter((it) => String(getId(it)) !== id);
      } else if (opts.outcome === 'replace' && opts.toRow) {
        const idx = rows.value.findIndex((it) => String(getId(it)) === id);
        if (idx >= 0) rows.value[idx] = opts.toRow(result);
      }
      opts.onDone?.(result);
      await load();
      return result;
    } catch (error) {
      const text = errorTextOf(error, opts.errorFallback ?? '操作失败，请稍后重试');
      errorMsg.value = text;
      message.error(text);
      return null;
    } finally {
      busyId.value = '';
    }
  }

  return { busyId, errorMsg, load, rows, runRowAction, loading };
}
