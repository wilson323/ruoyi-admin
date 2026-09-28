/**
 * useApprovalQueue 单测（D-3⑧）：队列状态机契约——
 * canLoad 短路零请求、加载错误提示、行操作 busy 防重入、ID 字符串透传、
 * remove/replace 本地更新、onDone 回调、失败兜底文案。
 * 不挂载组件（message 打桩，聚焦纯状态逻辑，与 use-filter-sync.test.ts 同风格）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useApprovalQueue } from './use-approval-queue';

// vi.mock 工厂被提升：stub 必须经 vi.hoisted 同批提升，否则初始化顺序竞炸（vitest 惯例）。
const { messageStub } = vi.hoisted(() => ({
  messageStub: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('ant-design-vue', () => ({ message: messageStub }));

interface Row {
  id: string;
  name: string;
}

const rowsFixture = (): Row[] => [
  { id: '1234567890123456789', name: 'A' },
  { id: '9876543210987654321', name: 'B' },
];

function makeQueue(fetchList: () => Promise<Row[]>, canLoad?: () => boolean) {
  return useApprovalQueue<Row>({
    canLoad,
    fetchList,
    getId: (row) => String(row.id ?? ''),
  });
}

beforeEach(() => {
  messageStub.error.mockClear();
  messageStub.success.mockClear();
});

describe('load 队列加载', () => {
  it('成功：rows 填充 + loading 归位', async () => {
    const queue = makeQueue(async () => rowsFixture());
    await queue.load();
    expect(queue.rows.value).toHaveLength(2);
    expect(queue.loading.value).toBe(false);
    expect(messageStub.error).not.toHaveBeenCalled();
  });

  it('canLoad=false 短路：零请求零赋值', async () => {
    const fetcher = vi.fn(async () => rowsFixture());
    const queue = makeQueue(fetcher, () => false);
    await queue.load();
    expect(fetcher).not.toHaveBeenCalled();
    expect(queue.rows.value).toEqual([]);
  });

  it('失败：Error.message 进 errorMsg + message.error', async () => {
    const queue = makeQueue(async () => {
      throw new Error('后端 50002 状态冲突');
    });
    await queue.load();
    expect(queue.errorMsg.value).toBe('后端 50002 状态冲突');
    expect(messageStub.error).toHaveBeenCalledWith('后端 50002 状态冲突');
  });

  it('失败非 Error：兜底文案（默认「加载列表失败」）', async () => {
    const queue = makeQueue(async () => {
      throw 'boom';
    });
    await queue.load();
    expect(messageStub.error).toHaveBeenCalledWith('加载列表失败');
  });
});

describe('runRowAction 行级操作', () => {
  it('long ID 字符串透传：action 收到的 id 无精度丢失（drift-guard 红线）', async () => {
    const queue = makeQueue(async () => rowsFixture());
    await queue.load();
    const seen: string[] = [];
    const action = vi.fn(async (id: string) => {
      seen.push(id);
      return { id, status: 'DONE' };
    });
    await queue.runRowAction({
      action,
      row: rowsFixture()[0]!,
      successText: 'ok',
    });
    expect(seen).toEqual(['1234567890123456789']); // 字符串原文，非 Number 化
    expect(seen[0]).not.toMatch(/e\+/i); // 未发生科学计数法失真
  });

  it('bodyCell 宽松 record 形态：record.id 提取为字符串', async () => {
    const queue = makeQueue(async () => rowsFixture());
    const action = vi.fn(async (id: string) => ({ id }));
    await queue.runRowAction({
      action,
      row: { id: '42', name: 'loose' } as Record<string, any>,
      successText: 'ok',
    });
    expect(action).toHaveBeenCalledWith('42');
  });

  it('空 id / busy 中：短路返回 null 零调用', async () => {
    const queue = makeQueue(async () => rowsFixture());
    expect(
      await queue.runRowAction({ action: async () => 1, row: '', successText: 'ok' }),
    ).toBeNull();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const busyAction = vi.fn(async () => gate.then(() => ({ ok: true })));
    const first = queue.runRowAction({ action: busyAction, row: '1', successText: 'ok' });
    const second = await queue.runRowAction({
      action: busyAction,
      row: '2',
      successText: 'ok',
    });
    expect(second).toBeNull(); // busy 防重入：第二笔直接短路
    expect(busyAction).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("outcome='remove'：成功先摘行再 reload", async () => {
    let list = rowsFixture();
    const queue = makeQueue(async () => list);
    await queue.load();
    expect(queue.rows.value).toHaveLength(2);
    list = [list[1]!]; // 服务端已移除 A1
    const result = await queue.runRowAction({
      action: async (id) => ({ id, purged: true }),
      outcome: 'remove',
      row: '1234567890123456789',
      successText: '已彻底清除，该记录不可恢复',
    });
    expect(result).toEqual({ id: '1234567890123456789', purged: true });
    expect(messageStub.success).toHaveBeenCalledWith('已彻底清除，该记录不可恢复');
    expect(queue.rows.value).toHaveLength(1); // reload 后终态
    expect(queue.busyId.value).toBe(''); // finally 释放
  });

  it("outcome='replace'：结果行原位替换 + onDone 回调 + reload 权威覆盖", async () => {
    // 存量页 withdrawRow 语义：先原位替换（即时反馈），再 reload 以服务端权威为准。
    let list = rowsFixture();
    const queue = makeQueue(async () => list);
    await queue.load();
    const done: unknown[] = [];
    const updated: Row = { id: '1234567890123456789', name: 'A-final' };
    await queue.runRowAction({
      action: async (id) => {
        list = list.map((r) => (r.id === id ? updated : r)); // 模拟服务端同步
        return updated;
      },
      onDone: (r) => {
        done.push(r);
        // reload 前窗口：本地已原位替换（乐观反馈生效）
        expect(queue.rows.value[0]!.name).toBe('A-final');
      },
      outcome: 'replace',
      row: '1234567890123456789',
      successText: (r) => `状态=${(r as Row).name}`,
      toRow: (r) => r,
    });
    expect(queue.rows.value[0]!.name).toBe('A-final'); // reload 后终态一致
    expect(done).toEqual([updated]);
    expect(messageStub.success).toHaveBeenCalledWith('状态=A-final');
  });

  it('失败：默认兜底文案 + errorMsg + busy 释放，不 reload', async () => {
    const fetcher = vi.fn(async () => rowsFixture());
    const queue = makeQueue(fetcher);
    await queue.load();
    fetcher.mockClear();
    const result = await queue.runRowAction({
      action: async () => {
        throw new Error('端点 409');
      },
      row: '1',
      successText: 'ok',
    });
    expect(result).toBeNull();
    expect(queue.errorMsg.value).toBe('端点 409');
    expect(messageStub.error).toHaveBeenCalledWith('端点 409');
    expect(queue.busyId.value).toBe('');
    expect(fetcher).not.toHaveBeenCalled(); // 失败不 reload
  });

  it('空 successText 不弹 success toast（调用方自持文案场景）', async () => {
    const queue = makeQueue(async () => []);
    await queue.runRowAction({ action: async () => 1, row: '7', successText: '' });
    expect(messageStub.success).not.toHaveBeenCalled();
  });
});
