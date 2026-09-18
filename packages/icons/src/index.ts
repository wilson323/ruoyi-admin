export * from './iconify';
export * from './iconify-offline';
export { default as EmptyIcon } from './icons/empty-icon.vue';
export * from './svg';
export { VbenIcon } from '@vben-core/shadcn-ui';

// 2026-09-18：iconify 默认 CDN 出口不可达，由 vite dev 中间件拦截 /iconify-api/{prefix}.json
// 改走本地 @iconify/json；在此 re-export 让前端可通过 @vben/icons 调用 addAPIProvider。
export { addAPIProvider } from '@vben-core/icons';
