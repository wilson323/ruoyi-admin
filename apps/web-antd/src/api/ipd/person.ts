/**
 * 人员治理 API（页44 人员管理·超管；后端 PersonController /api/v1/persons）。
 *
 * R215 WP3.1 批次2（ORPHAN-A11）接线：
 * - POST /persons/{id}/resign        离职冻结（AC-USER-08；HR 或本人）
 * - POST /persons/{id}/rehire        复职（AC-USER-09；R215 GAP-F3 补线，HR=SUPER_ADMIN/GROUP_LEADER）
 * - POST /persons/{id}/wecom/unbind  企微解绑联动（AC-USER-10；HR=SUPER_ADMIN/GROUP_LEADER）
 * - GET  /persons/active             在职人员清单（R118 契约 / R128 P0 #2；供内部角色选择器的在职名册）
 *                                    返回 data.persons[]{id,name,personType,groupId}，id 后端恒字符串（禁 Number()）。
 *
 * 状态机（PersonService.java 2026-09 实码）：
 * resign 置 employment=RESIGNED + account=FROZEN_PENDING_HANDOVER → 移交完成终态 DISABLED；
 * rehire 仅接受 employment=RESIGNED 且 account≠DISABLED（DISABLED 需先走解禁，直接复职被
 * 50002 拒「账户已禁用，需先解禁后再复职」PersonService.java:320-323；ACTIVE 同拒 :316-319）。
 *
 * 后端真值（PersonController/PersonService 2026-09 实码 + R215 实测）：
 * - resign 返回 ResignView：幂等标记 + 待移交项目数 + 企微解绑/会话撤销/通知数副作用；
 * - unbind 返回 PersonView：weComUserId 后端脱敏为 "***"；**实测联动 account_status→DISABLED**
 *   （PersonService AC-USER-10：清 wecom_user_id + 账号 DISABLED，无企微无法扫码登录）；
 *   且 DISABLED 后再 resign 会被 50002 拒（状态机互斥：unbind 先行会阻塞 resign）；
 * - reason 均 @NotBlank @Size(max=200)。
 */
import { ipdGet, ipdPost } from './http';

/** 离职冻结结果（PersonController.ResignView）。 */
export interface ResignResultView {
  /** 幂等标记：重复触发离职时 true（人员已 DISABLED）。 */
  idempotent: boolean;
  /** 待移交项目数（batch-04:556 全部移交完才终态 DISABLED 的依据）。 */
  pendingProjects: number;
  message: null | string;
  /** 联动副作用标记（附录 D6：离职→企微解绑）。 */
  wecomUnbound: boolean;
  /** 会话撤销标记（SEC：离职即时失效）。 */
  sessionsRevoked: boolean;
  /** 已发送通知数。 */
  notificationsSent: number;
}

/** 企微解绑后的人员视图（PersonView；weComUserId 后端脱敏"***"）。 */
export interface PersonOperationView {
  id: string;
  name: null | string;
  employmentStatus: null | string;
  /** 实测：unbind 联动后为 DISABLED（无企微无法扫码登录）。 */
  accountStatus: null | string;
  wecomUserId: null | string;
}

/** 在职人员轻量项（PersonController.ActivePersonView；供内部角色选择器分组）。 */
export interface ActivePersonView {
  /** 雪花 ID 字符串透传（后端 String.valueOf，禁 Number() 转换）。 */
  id: string;
  name: string;
  personType: string;
  /** 分组 ID（可空）。 */
  groupId: null | string;
}

/** 离职冻结（POST /persons/{id}/resign；HR 或本人；reason 必填 1~200 字）。 */
export function resignPerson(personId: string, reason: string): Promise<ResignResultView> {
  return ipdPost<ResignResultView>(`/persons/${encodeURIComponent(personId)}/resign`, { reason });
}

/** 企微解绑联动（POST /persons/{id}/wecom/unbind；HR=超管/组长；reason 必填 1~200 字）。 */
export function unbindWecom(personId: string, reason: string): Promise<PersonOperationView> {
  return ipdPost<PersonOperationView>(`/persons/${encodeURIComponent(personId)}/wecom/unbind`, { reason });
}

/**
 * 复职（POST /persons/{id}/rehire；AC-USER-09；HR=超管/组长，requireLeaderOrAdmin）。
 * note 选填：省略时 body 传 {}（禁空串 ''——后端 @Valid 无 @NotBlank 但审计字段留空串脏）。
 * PersonView.id 后端恒 String.valueOf（PersonController.java:61），无 number 形态分支。
 */
export function rehirePerson(personId: string, note?: string): Promise<PersonOperationView> {
  return ipdPost<PersonOperationView>(`/persons/${encodeURIComponent(personId)}/rehire`, note ? { note } : {});
}

/** 在职人员轻量项归一（id 纯字符串透传；groupId 可空 → null）。 */
const normalizeActivePerson = (value: unknown): ActivePersonView => {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    id: String(record.id ?? ''),
    name: typeof record.name === 'string' ? record.name : '',
    personType: typeof record.personType === 'string' ? record.personType : '',
    groupId: typeof record.groupId === 'string' ? record.groupId : null,
  };
};

/**
 * 在职人员清单（GET /persons/active；R118 契约 / R128 P0 #2 补端点）。
 * 后端返回 data.persons[]{id,name,personType,groupId}；供内部角色选择器做在职名册。
 * 缺失/非数组归一为空数组（不抛错），调用方无 loading 闪烁。
 */
export async function listActivePersons(): Promise<ActivePersonView[]> {
  const data = await ipdGet<{ persons?: unknown }>('/persons/active');
  return Array.isArray(data?.persons) ? data.persons.map(normalizeActivePerson) : [];
}
