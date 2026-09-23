/**
 * vitest 启动钩子（vitest.ipd.config.mts → setupFiles 加载）。
 *
 * 目的：消除 `Failed to resolve directive: access` 警告并使测试环境与生产环境行为一致。
 *
 * 背景：v-access 指令在生产环境由 `apps/web-antd/src/bootstrap.ts`
 *   → `registerAccessDirective()`（@vben/access）注册到 Vue app；测试环境
 *   `@vue/test-utils` 的 mount 不会触发 bootstrap，因此 v-access:code
 *   指令不解析（不影响渲染，仅打印警告）。本文件提供测试版指令 stub。
 *
 * 策略：默认通过（不删除元素），与生产 useAccess() hasAccessByCodes 默认行为对齐——
 *   - 不破坏现有断言「按钮文本存在 / 触发后调用 fetch」
 *   - 测试如需验证「无权时按钮隐藏」，在该测试 mount 时通过 `directives` 选项覆盖：
 *     mount(Index, { directives: { access: { mounted(el) { el.remove(); } } } })
 *
 * @see packages/effects/access/src/directive.ts 真实实现
 */
import { config } from '@vue/test-utils';

config.global.directives ??= {};
config.global.directives.access = {
  mounted() {
    // 测试环境默认放行；与 useAccess() hasAccessByCodes 默认 true 对齐。
  },
};