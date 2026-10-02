import type { RouteRecordRaw } from 'vue-router';

import { describe, expect, it } from 'vitest';

import { PAGE_PERMISSIONS } from './ipd-permission-codes';
import { ipdLayoutRoute } from '../../../router/routes/modules/ipd';

/**
 * 导航收敛：常用入口五项，其余一级路由仍登记但不进侧栏。
 */
const PRIMARY: Array<[string, string, number]> = [
  ['IpdWorkbench', '我的工作台', 1],
  ['IpdProductLines', '产品线', 2],
  ['IpdProductCatalog', '产品目录', 3],
  ['IpdProjects', '我的项目', 4],
  ['IpdDocuments', '资料库', 5],
];

const HIDDEN = [
  'IpdRequirements',
  'IpdProducts',
  'IpdBids',
  'IpdChanges',
  'IpdReviews',
  'IpdPerformance',
  'IpdTimeline',
  'IpdReports',
  'IpdHandover',
  'IpdAiAssistant',
  'IpdIdentitySync',
  'IpdAdmin',
  'IpdOperation',
] as const;

function pageAccess(path: string): readonly string[] {
  const codes = PAGE_PERMISSIONS[path];
  if (!codes) {
    throw new Error(`缺少页面权限 ${path}`);
  }
  return codes;
}

function child(name: string): RouteRecordRaw {
  const found = ipdLayoutRoute.children?.find((route) => route.name === name);
  if (!found) {
    throw new Error(`缺少路由 ${name}`);
  }
  return found;
}

describe('IPD 常用入口', () => {
  it('五项按工作台、产品线、产品目录、我的项目、资料库显示', () => {
    const visible = (ipdLayoutRoute.children ?? [])
      .filter((route) => route.meta?.hideInMenu !== true && route.meta?.order != null)
      .sort((left, right) => Number(left.meta?.order) - Number(right.meta?.order));
    expect(visible.map((route) => route.meta?.title)).toEqual([
      '我的工作台',
      '产品线',
      '产品目录',
      '我的项目',
      '资料库',
    ]);
    for (const [name, title, order] of PRIMARY) {
      const route = child(name);
      expect(route.meta?.hideInMenu).not.toBe(true);
      expect(route.meta?.title).toBe(title);
      expect(route.meta?.order).toBe(order);
    }
  });

  it('产品目录仍只给超管，项目和产品空间权限码还在', () => {
    expect(child('IpdProductCatalog').meta?.authority).toEqual(['SUPER_ADMIN']);
    expect(child('IpdProjects').meta?.access).toEqual(pageAccess('/ipd/projects'));
    expect(child('IpdProducts').meta?.access).toEqual(pageAccess('/ipd/products'));
    expect(child('IpdProductLines').meta?.access).toEqual(pageAccess('/ipd/product-lines'));
  });

  it('招募、绩效、报表、移交和产品空间不进侧栏，路径还在', () => {
    expect(child('IpdProducts').path).toBe('products');
    expect(child('IpdBids').path).toBe('bids');
    expect(child('IpdPerformance').path).toBe('performance');
    expect(child('IpdReports').path).toBe('reports');
    expect(child('IpdHandover').path).toBe('handover');
    for (const name of HIDDEN) {
      expect(child(name).meta?.hideInMenu).toBe(true);
    }
  });
});
