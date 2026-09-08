# IPD dev 登录演示账号（单一信源）

登录页「演示账号快捷选择」的账号清单、角色与密码配置方法，以本文档为唯一信源。
对应代码：`apps/web-antd/src/views/ipd/auth/login.vue`。

## 账号清单（真库 ipd_dev 实存）

| 用户名 | 界面标签 | personType | personId |
|---|---|---|---|
| ipd-admin | 超管 | SUPER_ADMIN | 900101 |
| ipd-leader | 组长 | GROUP_LEADER | 900102 |
| ipd-market | 市场 PM | MARKET_PM | 900103 |
| ipd-rd | 研发 PM | RD_PM | 900104 |

运行时真源（账号是否存在、hash 是否匹配）在后端仓 gitignored 文件：
`ruoyi-ai/.codex/ipd-dev/config/bootstrap-accounts.json`（passwordHash 已脱敏治理，明文不落盘）。

## 密码配置（不进版本库）

密码已轮换且互不相同，**不写进源码、不入任何文档**。本地开发配置方法：

1. 创建 `apps/web-antd/.env.development.local`（该路径已被 .gitignore，且受
   sensitive-field-guard hook 保护——AI 会话不可写，需开发者手动创建）；
2. 内容为单行 env（值请向后端会话/owner 当面获取）：

   ```
   VITE_IPD_DEMO_PASSWORDS="ipd-admin=各账号密码,ipd-leader=…,ipd-market=…,ipd-rd=…"
   ```

3. 重启 vite（必须 `node node_modules/vite/bin/vite.js` 直起，不要 pnpm 包装）。

## 行为约定

- 已配置：点演示账号按钮 → 用户名+密码自动填充 → 登录跳转 `/ipd/workspace`。
- 未配置：演示区块显示黄字提示「未配置 VITE_IPD_DEMO_PASSWORDS」，快捷选择只填
  用户名；提交空密码会被前端守卫拦截并提示「请输入用户名和密码」，不会打到后端
  换来误导性的「用户名或密码不对」。
- 仅 dev 构建渲染演示区块；生产 bundle 中账号字面量被 Vite DCE 抹除。

## 端到端冒烟

```bash
IPD_SMOKE_USER=ipd-admin IPD_SMOKE_PASS=<密码> node scripts/ipd-smoke.mjs
# 或（前端账号）：IPD_SMOKE_USER=sysadmin …
```

脚本校验：SPA 非空 HTML、登录 code=0、envelope 带 traceId、/auth/me、
/workbench/today 全链路走 15666 前端代理。
