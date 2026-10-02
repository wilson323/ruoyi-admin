# scripts/__fixtures__ — Track D 门禁自证能红夹具

只读夹具（不含业务代码），供三条门禁的「红→清理→绿」自证；验证命令见各脚本头部注释。

| 目录 | 对应门禁 | 期望退出码 |
|---|---|---|
| `color-gate-clean/` | D-G02 干净态（token 用法 + 两处同值） | 0 |
| `color-gate-red/` | D-G02 违规态（#1677ff + `:root{--primary:…}` + 两处不同值 ） | 1 |

（原 D-G04 mcp-gates 两套夹具与 check-mcp-config-gates.mjs 已于 2026-10-02 随 LangChain4jMcpToolProviderService 删除而退役）

D-G05 的孤儿夹具不在本目录（须落在 `apps/web-antd/src` 树内才被发现）：
验证时临时放 `apps/web-antd/src/views/agent/orphan-fixture/orphan.test.ts`
（`views/mcp/**` 与 `views/agent/agent/**` 已在 include 白名单，须选白名单外路径）→ exit 1 → 删除。
