import { ipdGet } from '../ipd/http';

/**
 * @description: 菜单meta
 * @param title 菜单名
 * @param icon 菜单图标
 * @param noCache 是否不缓存
 * @param link 外链链接
 */
export interface MenuMeta {
  icon: string;
  link?: string;
  noCache: boolean;
  title: string;
}

/**
 * @description: 菜单
 * @param name 菜单名
 * @param path 菜单路径
 * @param hidden 是否隐藏
 * @param component 组件名称 Layout
 * @param alwaysShow 总是显示
 * @param query 路由参数(json形式)
 * @param meta 路由信息
 * @param children 子路由信息
 */
export interface Menu {
  alwaysShow?: boolean;
  children: Menu[];
  component: string;
  hidden: boolean;
  meta: MenuMeta;
  name: string;
  path: string;
  query?: string;
  redirect?: string;
}

/**
 * 获取用户所有菜单
 * `/api/v1/system/menu/getRouters`（requestIpd 拼 /api/v1 前缀 + IPD 业务票）。
 * 前一版用 requestClient 直写 '/api/v1/...' 有两个致命错：
 * ① baseURL='/api' 拼出 '/api/api/v1/...' 双前缀；② requestClient 带 accessStore 的
 * 平台票，而 IpdMenuController 是 @SaCheckLogin(type=ipd)，平台票调它必 401。
 * 后端返回 code=0/message 包络（ApiV1Response），requestIpd 校验后回传 data。
 * 旧平台菜单 `/system/menu/getRouters` 走平台 sa-token，IPD 票调它同样 401，已废弃。

 */
export async function getAllMenusApi() {
  return ipdGet<Menu[]>('/system/menu/getRouters');
}
