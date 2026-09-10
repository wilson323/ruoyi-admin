// PostCSS 配置（2026-09-10 恢复）：
// 本文件在整合提交 e70e6ef 被删除（原因「pnpm monorepo 下 jiti 找不到 cssnano」），
// 代价是 Vite 不再加载 Tailwind 管线 → @tailwind 指令不展开 → 平台页面（对话管理/
// 厂商管理等）全部 Tailwind 工具类失效、布局错乱。根因是 cssnano 只存在于 pnpm store
// 与 internal/tailwind-config/node_modules，未按本仓约定（autoprefixer/tailwindcss 同款）
// 挂在根 devDependencies，导致 NODE_ENV=production 时字符串插件名解析失败。
// 修复：根 package.json 增加 cssnano 依赖 + 恢复本文件，行为与上游 @vben/tailwind-config 一致。
export { default } from '@vben/tailwind-config/postcss';
