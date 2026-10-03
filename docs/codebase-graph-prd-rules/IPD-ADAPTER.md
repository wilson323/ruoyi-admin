# IPD 适配

冲突时以本文件为准。上游正文不改。

- 图谱只导航。事实只来自当前源码、SQL/XML、配置。EXTRACTED、INFERRED、注释不能写成已确认规则。静态检查通过不等于运行已验证。
- 三层不混：资格过滤、候选排序（字段、方向、空值、并列、后置过滤、终止）、运行时控制。
- 只分析、只写文档。未经当次明确授权，不改业务代码、不改库、不调真实下游、不打印凭据。
- 不要另建事实源。后端业务权威仍是 `ruoyi-ai/docs/ipd-系统说明/工程合同` 与当前代码。抽出的规则是分析稿，不能覆盖开发说明、看板镜像、`AGENTS.md`、`CLAUDE.md`。用户当次要求扫描时，文档写到 `ruoyi-ai/docs/ipd-系统说明/` 下新增文件，不要改 `docs/开发说明/`。
- 执行计划只认画布 `/Users/mac/.cursor/projects/Users-mac-Documents-ruoyi-ipd-web/canvases/ipd-execution-plan.canvas.tsx`。这两个 skill 不是第二份计划。
- 没有 Graphify 或没有 LLM 凭据时，用结构检索（已有 repowise / zvec / 源码阅读）导航，并写明限制。不要为此安装全局依赖，不要现在跑全项目扫描。
- ZK-IPD 不接入。
- 一个明确模块用 `codebase-graph-module-rules`；没有单模块边界的全量梳理才用 `codebase-graph-business-rules`。

上游 `https://github.com/xsoway/codebase-graph-prd-rules`，`git clone --depth 1` 的 HEAD 为 `98d6a7222b3bdce3c2fbdd78bfa818b4ed2d50aa`。仓库另有 tag `v1.0.0`（`27873915daf7f8504f8f6a1bbe2ed8bebaf41342`），本次按默认分支 HEAD 接入。
