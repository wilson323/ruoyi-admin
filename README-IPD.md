# IPD 正式管理前端

本目录是用户选定的独立RuoYi Vue管理工程，来源ageerle/ruoyi-admin，固定基线`04bb27d409ed81a96af897f826ac70d5266d34b5`（MIT）。实际应用为Vben5.5.9 / Ant Design Vue，Node22.22.3 / pnpm10.14.0。

框架类型检查、生产构建、3项实际组件测试及本机登录布局均已验证；49页IPD业务尚未由框架准备任务实现。产品权威与任务SSOT位于后端`/Users/mac/Documents/ruoyi-ai`，不要从旧React原型复制已过期业务规则或新建并行看板。

本机开发入口：http://127.0.0.1:15666/auth/login。Vite只监听loopback，后端固定127.0.0.1:16039；IPD `/api/v1`保留前缀，框架`/api`代理去前缀。不要接线上API。

完整恢复/运行命令及证据见[正式前端工程记录](/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/前端对接/正式前端工程-20260905.md)。API契约见[DOC-06](/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/工程合同/DOC-06.md)。IPD用独立code0/message包络，不复用框架code200/msg和默认角色。

```sh
export PATH="/Users/mac/Documents/ruoyi-ai/.codex/ruflo/swarm-20260905-decisions/frontend/tools/bin:$PATH"
pnpm run check:type
pnpm exec vitest run --config vitest.ipd.config.mts
pnpm run build:antd
pnpm --filter @vben/web-antd run dev
```

当前15666服务由DOC-09启动；复用已存在服务。依赖恢复保持pnpm10.14.0及frozen-lockfile，禁用未审阅生命周期脚本。未经用户明确要求不提交、推送或新建业务分支。
