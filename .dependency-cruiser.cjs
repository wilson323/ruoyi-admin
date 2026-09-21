// @ts-check
// R155-D dependency-cruiser 配置（前端仓 ruoyi-ipd-web）
//
// 适配后端仓 `.agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs` 模式：
// 每个 `apps/web-antd/src/api/ipd/<module>.ts` 是 entry point；
// `apps/web-antd/src/views/ipd/<module>/` 是 UI 实现层。
//
// 落地步骤：
//   1. pnpm add -D dependency-cruiser -w   ← owner 拍板后启用
//   2. pnpm exec depcruise apps/web-antd/src --config .dependency-cruiser.cjs
//   3. 接入 turbo.json + .github/workflows/dependency-cruiser.yml
//
// 当前状态：2026-09-21 config 落档（commit R155-D），未装包，CI 未激活。
//   - R155-D 不装包 = 不改 package.json/lock
//   - R155-D 不接 CI = 不在 .github/workflows/ 新增文件
//   - owner 拍板后单 PR 装包 + 激活 baseline

/** ipd API 模块根：每个 <module>.ts 是 entry point */
const IPD_API = "apps/web-antd/src/api/ipd";

/** ipd UI 实现层：<module>/ 子目录 */
const IPD_VIEWS = "apps/web-antd/src/views/ipd";

/** shared 工具层（_shared/ipd-error-text.ts 等） */
const IPD_SHARED = "apps/web-antd/src/_shared";

// type annotation commented out; restore after pnpm add -D dependency-cruiser
// /** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      // R1: views/ 只能 import api 模块入口（<module>.ts），不能 import api 内部
      name: "views-import-api-entrypoint-only",
      comment:
        "views/ipd/<module>/ 只能 import api/ipd/<module>.ts 入口；不能 import api 内部子文件（当前 flat 模式无内部，但守住防未来加子目录时漂移）",
      severity: "error",
      from: { path: `^${IPD_VIEWS}/([^/]+)/` },
      to: { path: `^${IPD_API}/([^/]+)/[^/]+` }, // 不匹配根 .ts（无子目录的 flat），仅挡未来子目录
    },
    {
      // R2: 不同 api 模块互相 import 仅走 entry point
      name: "api-cross-module-via-entry",
      comment: "api/ipd/<a>.ts import api/ipd/<b> 只走 <b>.ts 入口（flat 模式无内部，但规则占位）",
      severity: "error",
      from: { path: `^${IPD_API}/([^/]+)\\.ts$` },
      to: { path: `^${IPD_API}/([^/]+)/[^/]+` },
    },
    {
      // R3: shared/ 工具可被 views/ 引用，禁止 api/ 反向 import views/
      name: "no-api-to-views-back",
      comment: "api/ 是底层，views/ 是上层；禁止 api 模块 import views/",
      severity: "error",
      from: { path: `^${IPD_API}/` },
      to: { path: `^${IPD_VIEWS}/` },
    },
    {
      // R4: _shared/ 是工具层，可被 views/ + api/ 引用，禁止 _shared/ 内部 import 自检
      name: "no-shared-self-import",
      comment: "_shared/ 工具不应互相 import 形成依赖网",
      severity: "warn",
      from: { path: `^${IPD_SHARED}/` },
      to: { path: `^${IPD_SHARED}/` },
    },
    {
      // R5: 禁止循环依赖（ipd 范围）
      name: "no-ipd-circular",
      comment: "ipd 命名空间内禁止循环依赖",
      severity: "error",
      from: { path: `^${IPD_API}/|^${IPD_VIEWS}/` },
      to: { circular: true, path: `^${IPD_API}/|^${IPD_VIEWS}/` },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};