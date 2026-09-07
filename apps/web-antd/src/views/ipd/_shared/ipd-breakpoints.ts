/**
 * IPD 唯一断点常量（V12-F3 断点归一）
 *
 * 两档体系（对齐 V12 走查报告 §1.4 裁决 + ZK-IPD 真理源移动端布局）：
 * - MOBILE  = 768 —— 移动端：列表卡片化单列 / 表单纵向 / 按钮全宽；
 * - TABLET  = 1024 —— 平板：中间档网格（仅个别双断点页面使用，如 demand/index.vue）。
 *
 * 为什么不是 CSS var：CSS 自定义属性不能用于 @media 前置条件；IPD 页面
 * <style> 块均为纯 CSS（无 SCSS 预处理器），故媒体查询内写字面量
 * `768px` / `1024px`，由 ipd-breakpoints.test.ts 对 views/ipd/** 全量静态扫描强制——
 * 出现 768/1024 之外的 max-width 断点即测试失败。
 *
 * JS 侧（matchMedia / useBreakpoint 等响应式逻辑）必须引用本常量，禁止裸写数字。
 */
export const IPD_BREAKPOINT_MOBILE = 768;
export const IPD_BREAKPOINT_TABLET = 1024;

/** 静态扫描允许的字面量全集（与上方常量保持一致，测试双向校验） */
export const IPD_ALLOWED_BREAKPOINTS: readonly number[] = [
  IPD_BREAKPOINT_MOBILE,
  IPD_BREAKPOINT_TABLET,
];
