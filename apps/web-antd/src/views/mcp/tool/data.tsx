import type { FormSchemaGetter } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

export const querySchema: FormSchemaGetter = () => [
  {
    component: 'Input',
    fieldName: 'name',
    label: '工具名称',
  },
  {
    component: 'Select',
    componentProps: {
      options: [
        { label: '本地工具', value: 'LOCAL' },
        { label: '远程工具', value: 'REMOTE' },
        { label: '内置工具', value: 'BUILTIN' },
      ],
    },
    fieldName: 'type',
    label: '工具类型',
  },
  {
    component: 'Select',
    componentProps: {
      options: [
        { label: '启用', value: 'ENABLED' },
        { label: '禁用', value: 'DISABLED' },
      ],
    },
    fieldName: 'status',
    label: '状态',
  },
];

export const columns: VxeGridProps['columns'] = [
  { type: 'checkbox', width: 60 },
  {
    title: 'ID',
    field: 'id',
    // width: 80,
    visible: false,
  },
  {
    title: '工具名称',
    field: 'name',
    showOverflow: true,
    // E1 三栏：名称列渲染为选中链接（写回 index.vue 的 activeTool），高亮当前详情列
    slots: { default: 'name' },
    width: 200,
  },
  {
    title: '工具描述',
    field: 'description',
    showOverflow: true,
  },
  {
    title: '工具类型',
    field: 'type',
    width: 100,
    formatter({ cellValue }) {
      const typeMap: Record<string, string> = {
        LOCAL: '本地工具',
        REMOTE: '远程工具',
        BUILTIN: '内置工具',
      };
      return typeMap[cellValue] || cellValue;
    },
  },
  {
    title: '状态',
    field: 'status',
    width: 100,
    slots: {
      default: 'status',
    },
  },
  {
    title: '创建时间',
    field: 'createTime',
    width: 160,
  },
  {
    field: 'action',
    fixed: 'right',
    slots: { default: 'action' },
    title: '操作',
    resizable: false,
    width: 'auto',
  },
];

export const drawerSchema: FormSchemaGetter = () => [
  {
    component: 'Input',
    dependencies: {
      show: () => false,
      triggerFields: [''],
    },
    fieldName: 'id',
    label: 'id',
  },
  {
    component: 'Input',
    fieldName: 'name',
    label: '工具名称',
    rules: 'required',
    formItemClass: 'col-span-2',
  },
  {
    component: 'Textarea',
    componentProps: {
      rows: 3,
    },
    fieldName: 'description',
    formItemClass: 'col-span-2',
    label: '工具描述',
  },
  {
    component: 'Select',
    componentProps: {
      options: [
        { label: '本地工具', value: 'LOCAL' },
        { label: '远程工具', value: 'REMOTE' },
      ],
    },
    fieldName: 'type',
    label: '工具类型',
    rules: 'selectRequired',
  },
  {
    component: 'RadioGroup',
    componentProps: {
      buttonStyle: 'solid',
      options: [
        { label: '启用', value: 'ENABLED' },
        { label: '禁用', value: 'DISABLED' },
      ],
      optionType: 'button',
    },
    defaultValue: 'ENABLED',
    fieldName: 'status',
    label: '状态',
  },
  // Track E5：schema 不再存在任何 configJson 输入（表单域与 write-only 契约解耦，
  // 连接配置完全由 McpConnectionForm 结构化承接；#19 凭据 write-only 红线）。
];
