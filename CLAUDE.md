# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

IPD (Integrated Product Development) is the **single product** this codebase serves. It is the RuoYi Vue admin frontend (forked from `ageerle/ruoyi-admin`, Vben 5.5.9 + Ant Design Vue + Vite 7) wired to a Java backend at `/Users/mac/Documents/ruoyi-ai`. The framework's AI admin / chat / knowledge base surfaces are not the product here — IPD is.

**Read first, in this order**, before doing anything else:
1. `README-IPD.md` — fixed baseline, ports, dev/build commands, canonical paths
2. `AGENTS.md` — workflow guardrails (kanban, auth envelope, port discipline, do-nots)
3. `apps/web-antd/src/router/routes/modules/ipd.ts` — the **only** place IPD routes are registered
4. `apps/web-antd/src/views/ipd/_shared/` — shared enums, permission codes, state machines, theme

Backend authoritative documents live at `/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/工程合同/` (not in this repo). The local kanban at `http://127.0.0.1:62250` is the task source — claim from there, do not create a parallel tracker.

## Local environment (fixed)

| Tool   | Version    |
|--------|------------|
| Node   | 22.22.3    |
| pnpm   | 10.14.0    |
| Vite   | 7.x        |

Ports (loopback only — never bind 0.0.0.0, never proxy a hosted API):
- Frontend dev: `127.0.0.1:15666`
- Backend proxy target: `127.0.0.1:16039`
- Kanban: `127.0.0.1:62250`

`UPSTREAM_HOST` is set in `apps/web-antd/.env.local` → `127.0.0.1:16039`. Vite proxies `/api/v1` with **prefix preserved** (IPD contracts keep it) and `/api` with **prefix rewritten** (framework's `/api/...` calls). See `apps/web-antd/vite.config.mts` lines 66–84.

## Commands

All commands run from repo root unless noted.

```bash
# Install (frozen lockfile, no lifecycle scripts)
pnpm install --frozen-lockfile

# Typecheck — prefer the direct subpackage command, not `pnpm run check:type`,
# because the turbo wrapper folds vue-tsc's stderr and you lose the diagnostics.
# Must exit 0 with zero errors. Baseline was 21 historical errors per
# docs/typecheck-baseline.md; the W3-TYPE-01 governance wave reduced it to 0
# on 2026-09-07. If typecheck ever shows errors again, fix the source — do NOT
# loosen tsconfig or skip files.
pnpm --filter @vben/web-antd run typecheck

# IPD unit tests (happy-dom, only IPD-scoped files + the workflow designer test)
pnpm exec vitest run --config vitest.ipd.config.mts

# Production build of the IPD app
pnpm run build:antd

# Local dev server
pnpm --filter @vben/web-antd run dev
# → http://127.0.0.1:15666/auth/login

# One-shot convenience (replicates README-IPD.md)
pnpm --filter @vben/web-antd run typecheck
pnpm exec vitest run --config vitest.ipd.config.mts
pnpm run build:antd
```

Framework-wide (rarely needed for IPD work):
- `pnpm test:unit` — vitest with `--dom` over the whole monorepo
- `pnpm run lint` / `pnpm run check:circular` / `pnpm run check:dep` / `pnpm run check:cspell`
- `pnpm run build` — turbo build across all packages

`scripts/typecheck-error-count.mjs` parses `vue-tsc` output and compares against the 0-error baseline (used by `.github/workflows/typecheck-no-new-errors.yml`). When BASELINE env is `0`, the gate is effectively "must stay green".

## High-level architecture

```
apps/
  web-antd/                ← the only meaningful app for IPD work
    src/
      api/                 ← request layer (split: api/ipd/** = IPD, api/** = framework)
      views/ipd/           ← page components grouped by domain (project/, kpi/, incentive/, …)
        _shared/           ← enums, permission codes, state machines, theme, composables
      layouts/ipd.vue      ← custom shell (NOT Vben's basic.vue) — strict 1:1 ZK-IPD prototype
      router/
        routes/modules/ipd.ts   ← sole IPD route registry
        ipd-guard.ts            ← auth navigation guard (identityDestination, handover freeze)
      store/
        ipd-auth.ts        ← IPD session store + platform-token bridge
        auth.ts            ← framework session store
packages/
  @core/{base,composables,preferences,ui-kit}     ← framework primitives
  effects/{access,common-ui,hooks,layouts,plugins,request}
  {constants,icons,locales,preferences,stores,styles,types,utils}
internal/
  {lint-configs,node-utils,tailwind-config,tsconfig,vite-config}
```

`★ Insight ─────────────────────────────────────`
**Two layouts coexist on purpose.** `layouts/basic.vue` is Vben's stock admin shell; `layouts/ipd.vue` is a hand-built shell that mirrors the ZK-IPD React prototype's topbar/sidebar/stage-rail at pixel level. `router/routes/modules/ipd.ts` mounts everything under `/ipd/*` against `ipd.vue` directly (line 26: `component: () => import('#/layouts/ipd.vue')`) — it never touches `basic.vue`. If you change navigation chrome, edit `ipd.vue` and its three dialogs in `_shared/use-focus-trap.ts`.
`─────────────────────────────────────────────────`

## IPD-specific conventions (enforced by code, not docs)

**API envelope is `code=0` / `message`**, not the framework's `code=200/msg`. See `apps/web-antd/src/api/ipd/auth.ts` `BUSINESS_CODE_MESSAGES` table — codes 10001, 20001–20003, 30001, 40001–40013, 40401, 50001–50002, 90001 are the IPD business codes. Don't fall back to framework defaults when these fail.

**IDs are strings** (string-person IDs from backend), **money stays as strings** (no recursive coercion). `apps/web-antd/src/api/ipd/http.ts` has the comment: "ID 一律按字符串处理，金额保持字符串原样，不做递归转换".

**Two auth stores, one bridge.** `store/ipd-auth.ts` owns the IPD session (`sessionStorage` key `ruoyi-ipd.session`); `store/auth.ts` owns the framework session used by the AI platform. The bridge is `useIpdAuthStore().renewPlatformSession(force)` — it trades an IPD token for a platform token at `/auth/platform-token`, caches it under `ruoyi-ipd.platform`, and only succeeds for `scope === 'FULL'`. When the platform token 401s, `apps/web-antd/src/api/request.ts` `doReAuthenticate()` calls `renewPlatformSession(true)`; if that fails the user lands at `/ipd/workbench` and the IPD guard takes over.

**Login error text is pinned by exact string.** `IPD_LOGIN_CREDENTIAL_ERROR = '用户名或密码错误'` is the **only** authoritative "wrong password" signal — different messages (disabled / rate-limited) share code 400+10001, so match the envelope message, not the code. See comment on line 32–36 of `apps/web-antd/src/api/ipd/auth.ts`.

**Login errors travel two paths — do not assume `ipdErrorText()` can see them.** The login page reads `error.message` directly off the `IpdRequestError` thrown by `requestIpd` (which short-circuits `status===401 && path==='/auth/login' && code===10001` to set `error.message = IPD_LOGIN_CREDENTIAL_TEXT`). Non-login views route their errors through `apps/web-antd/src/views/ipd/_shared/ipd-error-text.ts:ipdErrorText(error)`, whose `http` branch **ignores `error.message` and looks up codes by number only** — so `ipdErrorText(loginErr)` will never contain `'用户名或密码错误'`. Tests pinning this rule live in `_shared/ipd-error-text.test.ts` "与 auth.ts 的一致性" describe block. Same-code text drift between `auth.ts: BUSINESS_CODE_MESSAGES` and `ipd-error-text.ts: IPD_COMMON_CODE_TEXTS` is logged in `docs/反思-前端文案漂移-20260907.md` (10 codes currently differ — owner decision pending).

**Permission codes live in one file.** Every `meta.access` in `router/routes/modules/ipd.ts` references a constant from `apps/web-antd/src/views/ipd/_shared/ipd-permission-codes.ts` — no bare string literals. `authority` is the role-level (`personType`) gate (`GROUP_LEADER` / `MARKET_PM` / `RD_PM` / `SUPER_ADMIN`).

**Nav guard identity rules** are a pure function (`identityDestination` in `ipd-guard.ts`) and are unit-tested. Don't inline the rules in components — call the guard. Public paths are `/portal/*`, `/auth/login`, `/login`. Handover-frozen accounts are pinned to `/ipd/handover` + `/ipd/account`. First-login accounts are pinned to `/auth/change-password`.

**A11y, breakpoints, state machines have unit tests.** `views/ipd/_shared/ipd-breakpoints.test.ts`, `ipd-enums.test.ts`, `ipd-state-machines.test.ts`, `ipd-permission-codes.test.ts`, `ipd-a11y.test.ts`, `use-focus-trap.test.ts` exist for a reason — when you change enums or guard logic, update these tests in the same diff.

**`parseIdentity` requires explicit `mustChangePwd` and `scope`.** Both fields are **mandatory** in the identity payload — `apps/web-antd/src/api/ipd/auth.ts:parseIdentity` throws `IpdRequestError` if either is missing or has the wrong type. Do NOT default them client-side; the backend dictates these values. Tests pinning every rejection path live in `apps/web-antd/src/api/ipd/auth.test.ts` ("C. parseIdentity rejection" describe block, 44 effective cases).

**`http.ts` exposes exactly 3 verbs: `ipdGet` / `ipdPost` / `ipdPut`.** There is **no `ipdDelete`** — and `IpdRequestOptions.method` is typed `'GET' | 'POST' | 'PUT'`. Don't add DELETE helpers without first extending the type and the auth store's request surface. Contract tests in `apps/web-antd/src/api/ipd/http.test.ts` (4 describe / 14 it) lock this surface.

**Testing antd-vue 4.x components in happy-dom has two gotchas (F8):**
- `Alert`: the `:description` prop **takes precedence** over the `#description` slot. Slot contents (e.g. a "重新加载" Button) **do not render** in the happy-dom test environment. Assert on `description` prop text and the Alert's header (`type="error"` / `type="warning"`), not on slot-injected buttons. Retry semantics can still be tested via any always-rendered button (e.g. a toolbar "刷新" button also wired to `load()`).
- `Select`: dropdown options **cannot be opened** in happy-dom (the popup teleports to `<body>` and options aren't rendered). Drive the v-model directly: `findComponent({ name: 'ASelect' }).vm.$emit('update:value', 'BONUS')`. This pattern was confirmed working across C7a / C7b / C7c / C7d in 2026-09-07.

## How to add IPD work safely

1. **Claim a kanban card** from `http://127.0.0.1:62250` (or whichever the user points to). Don't create parallel trackers or GitHub issues.
2. **Frontend route registration goes in `apps/web-antd/src/router/routes/modules/ipd.ts`** and nowhere else (comment block at the top of that file is the rule book). Match ZK-IPD prototype navItems 15 items — if your page is prototype-level, it gets a `meta.order`; if it's a sub-route or drilldown, it gets `hideInMenu: true` and an `activePath`.
3. **API client** lives in `apps/web-antd/src/api/ipd/<domain>.ts`, sibling test in `<domain>.test.ts`. Use `ipdGet / ipdPost / ipdPut` from `api/ipd/http.ts` — don't reinvent the envelope handling.
4. **Page components** go in `apps/web-antd/src/views/ipd/<domain>/<page>/index.vue`. Pull shared UI from `views/ipd/_shared/` (enums, focus trap, filter sync, theme CSS).
5. **Verify locally before claiming done:**
   - `pnpm --filter @vben/web-antd run typecheck` — must exit 0 with zero errors (see `docs/typecheck-baseline.md`).
   - `pnpm exec vitest run --config vitest.ipd.config.mts` — must stay green; the IPD test suite is the contract.
   - `pnpm run build:antd` — must exit 0. **Even on exit 0, scan the log for TS diagnostics** — there's precedent (TS4058 in scrollbarRef) where a "successful" build quietly degrades a declaration to `any`.
   - Browser smoke test against `http://127.0.0.1:15666` if the change is user-visible.

## Do NOT (from AGENTS.md)

- Don't use the old React prototype, the AI chat frontend, or the framework's default admin identity as a substitute for IPD implementations.
- Don't kill other port processes, don't connect to hosted business APIs, don't accept online API.
- Don't bypass navigation or backend auth (first login / handover freeze must go through the guard).
- Don't commit, push, create business branches, or publish — wait for explicit user request.
- Don't relax `tsconfig`, skip files, or fake green tests.
- Don't print or commit credentials. Demo passwords live in `.env.development.local` only (gitignored) and read via `import.meta.env.VITE_IPD_DEMO_PASSWORDS`.

`★ Insight ─────────────────────────────────────`
The `apps/web-antd/.env.local` file (gitignored) carries `UPSTREAM_HOST` and `VITE_APP_NAMESPACE=ruoyi-ipd-web`. Without it, Vite falls back to the committed `.env` which points at `ruoyi-ai-backend:6039` — a Docker-network host that doesn't exist on loopback. If `pnpm dev` starts but the login button throws "network error", check `.env.local` first.
`─────────────────────────────────────────────────`
