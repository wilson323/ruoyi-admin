/**
 * .vue 模块兜底声明：只服务未加载 Vue 语言插件的 tsserver（编辑器内 *.ts 引 *.vue 报 TS2307 的噪音源）。
 * vue-tsc 走真实 SFC 解析，.vue 相对导入先解析到虚拟文件、本兜底不生效（精度不受损：
 * 负向探针验证于 2026-09-27，故意传错 props 时 vue-tsc 仍报 TS2769）。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}
