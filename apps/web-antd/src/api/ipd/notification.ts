/**
 * 站内通知接口（页03 站内信 / OPS-05，看板卡 df7eba96）。
 *
 * 真值：NotificationController /api/v1/notifications 消费侧 4 端点（2026-09-06 磁盘核实）：
 * GET /（收件箱，unreadOnly 可选）、GET /unread-count（红点计数）、
 * POST /{id}/read（单条已读；他人 ID 按 NOT_FOUND 拒绝，杜绝探测）、
 * POST /read-all（全部已读，返回 updated 计数）。
 * dispatch-pending / async-dispatch 为超管运维触发端点，前端消费侧不接。
 * 发布端无 HTTP 入口（业务服务事务内 publish），receiver 恒从会话推导（SEC-API-01）。
 */
import { ipdGet, ipdPost } from './http';

/** 站内通知事件（notification_events 投影；kind：FYI 跨组知会 / ACTION 可执行行动）。 */
export interface IpdNotification {
  actionUrl: null | string;
  content: null | string;
  createTime: null | string;
  deliveryStatus: null | string;
  eventType: null | string;
  id: string;
  kind: null | string;
  /** "0"=未读 / "1"=已读（unread-count 口径：count(readFlag="0")）。 */
  readAt: null | string;
  readFlag: null | string;
  sourceId: null | string;
  sourceType: null | string;
  title: null | string;
}

export async function listNotifications(unreadOnly = false): Promise<IpdNotification[]> {
  const data = await ipdGet<IpdNotification[]>('/notifications', { unreadOnly });
  return Array.isArray(data) ? data : [];
}

export async function fetchUnreadCount(): Promise<number> {
  const data = await ipdGet<{ count: number | string }>('/notifications/unread-count');
  // 后端 Long 走全局字符串序列化（真机联测实测 count="0"），统一 Number 化防红点永不亮
  return Number(data?.count ?? 0) || 0;
}

export async function markNotificationRead(id: string): Promise<IpdNotification> {
  return ipdPost<IpdNotification>(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<number> {
  const data = await ipdPost<{ updated: number | string }>('/notifications/read-all');
  return Number(data?.updated ?? 0) || 0;
}
