import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      hideInMenu: true,
      title: '编辑工作流',
    },
    name: 'WorkflowEdit',
    path: '/aiflow/edit/:uuid',
    component: () => import('#/views/aiflow/edit.vue'),
  },
  {
    meta: {
      hideInMenu: true,
      title: '运行工作流',
    },
    name: 'WorkflowRun',
    path: '/aiflow/run/:uuid',
    component: () => import('#/views/aiflow/run.vue'),
  },
];

export default routes;
