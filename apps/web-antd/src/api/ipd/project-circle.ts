/**
 * 项目协作圈接口（页：项目空间-协作圈 Tab / 原型 /api/project-circle/*，看板卡 c5254e23）。
 *
 * 真值：ProjectCircleController /api/v1/project-circle 6 端点（2026-09-06 磁盘核实）：
 * GET /{projectId}（视图：项目+成员+动态含评论+canManage+readOnly）、
 * GET /{projectId}/candidates（可加协作人候选，仅管理人）、
 * POST /{projectId}/members（加协作人，幂等 upsert 圈角色，需 STATUS_CHANGE 权限）、
 * POST /{projectId}/posts（发动态 2-3000 字，可关联业务对象）、
 * POST /posts/{id}/comments（评论 2-2000 字，楼中楼 parentId 可选）、
 * GET /{projectId}/members（成员列表透传）。
 * 圈角色三档（normalizeCircleRole）：COMMENTER / CONTRIBUTOR / 默认 FOLLOWER。
 * ID 一律字符串（IPD /api/v1 规约），金额类不涉及。
 */
import { ipdGet, ipdPost } from './http';

/** 协作圈成员（project_circle_followers 投影，对齐 ProjectCircleService.view 的 members 结构）。 */
export interface CircleMember {
  addedAt: null | string;
  circleRole: null | string;
  level: null | string;
  name: null | string;
  personType: null | string;
  userId: string;
}

/** 动态评论（楼中楼 parentId 指向父评论 ID）。 */
export interface CircleComment {
  authorId: string;
  authorName: null | string;
  content: string;
  createdAt: null | string;
  id: string;
  parentId: null | string;
}

/** 协作圈动态。 */
export interface CirclePost {
  authorId: string;
  authorName: null | string;
  commentCount: number;
  comments: CircleComment[];
  content: string;
  createdAt: null | string;
  id: string;
  objectId: null | string;
  objectType: null | string;
}

/** 协作圈视图（GET /{projectId}，对齐 ProjectCircleService.view 返回结构）。 */
export interface CircleView {
  canManage: boolean;
  members: CircleMember[];
  posts: CirclePost[];
  project: Record<string, unknown>;
  readOnly: boolean;
}

/** 可加协作人候选（在职未入圈；仅管理人可拉取）。 */
export interface CircleCandidate {
  id: string;
  name: null | string;
  personType: null | string;
}

/** 圈角色：评论者 / 贡献者 / 关注者（默认）。 */
export type CircleRole = 'COMMENTER' | 'CONTRIBUTOR' | 'FOLLOWER';

export async function viewCircle(projectId: string): Promise<CircleView> {
  return ipdGet<CircleView>(`/project-circle/${projectId}`);
}

export async function listCircleMembers(projectId: string): Promise<CircleMember[]> {
  const data = await ipdGet<CircleMember[]>(`/project-circle/${projectId}/members`);
  return Array.isArray(data) ? data : [];
}

export async function listCircleCandidates(projectId: string): Promise<CircleCandidate[]> {
  const data = await ipdGet<{ candidates: CircleCandidate[] }>(
    `/project-circle/${projectId}/candidates`,
  );
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

export async function addCircleMember(
  projectId: string,
  userId: string,
  circleRole?: CircleRole,
): Promise<Record<string, unknown>> {
  return ipdPost(`/project-circle/${projectId}/members`, {
    circleRole: circleRole ?? null,
    userId,
  });
}

export async function createCirclePost(
  projectId: string,
  content: string,
  objectType?: string,
  objectId?: string,
): Promise<{ id: string }> {
  return ipdPost(`/project-circle/${projectId}/posts`, {
    content,
    objectId: objectId ?? null,
    objectType: objectType ?? null,
  });
}

export async function createCircleComment(
  postId: string,
  content: string,
  parentId?: string,
): Promise<{ id: string }> {
  return ipdPost(`/project-circle/posts/${postId}/comments`, {
    content,
    parentId: parentId ?? null,
  });
}
