# ruoyi-ipd-web

本目录是用户明确选定的IPD正式RuoYi Vue管理前端，固定来源与运行命令见[README-IPD.md](README-IPD.md)。实际UI库为Ant Design Vue，pnpm固定10.14.0。不得用旧React原型、AI聊天前端或框架默认admin身份代替IPD实现。

- 本项目任务仍以 `/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/开发计划-看板镜像.md` 为唯一事项源，本机看板为 `http://127.0.0.1:62250`。复用后端项目 Ruflo / ruoyi-vibe-kanban 技能，先认领及确认allowedPaths，再实现和验收；不在本仓另建台账或发布GitHub事项。
- 业务权威是后端 `docs/ipd-系统说明/工程合同/业务决策确认-20260905.md`、DOC-01～06及49页原规格。旧原稿只读，文档中的“已实现”不能替代当前HTTP/DB/浏览器证据。
- IPD `/api/v1` 使用code0/message包络、字符串ID及真实Person会话；不复用框架code200/msg、角色快照或递归日期转换。首登和冻结不得绕过导航与后端权限。
- 本机前端只监听127.0.0.1:15666，后端只代理127.0.0.1:16039；复用已运行的本项目服务，不杀其他端口进程，不接线上业务API。凭据不打印、不入版本库。
- **vite 必须 `node node_modules/vite/bin/vite.js` 直起，不要用 pnpm 包装**（pnpm 起的 vite 在 macOS 下会卡 read syscall，主线程 event loop 锁死，HTTP 全超时，代理不响应）。`pnpm run check:type / vitest / build:antd` 三条不受此坑影响。
- `pnpm run check:type`、`pnpm exec vitest run --config vitest.ipd.config.mts`、`pnpm run build:antd`。构建退出0仍要检查日志内TS诊断及声明产物；曾有TS4058把scrollbarRef声明降为any。不得放宽tsconfig、跳过文件或假绿。
- 未经用户明确要求不提交、推送、创建业务分支或发布。保留同目录未提交工作；跨Java/SQL修改须回原卡确认范围。
