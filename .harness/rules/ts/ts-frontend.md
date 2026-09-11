---
description: "TypeScript 前端开发通用规范"
globs: "**/*.{ts,tsx,vue}"
alwaysApply: true
---

# TypeScript 前端开发规范

## 一、架构约束（硬性红线）

1. 严格遵循组件分层：`views/`（页面）vs `components/`（可复用组件）
2. 所有 HTTP 请求集中在 `src/api/`，禁止组件内直接 fetch/axios
3. 请求/响应类型必须与后端契约一致（`ApiResponse<T>` 等）
4. 禁止跨 feature 直接 import，走 shared/ 或 composables/

## 二、代码风格

1. 统一 `Composition API` + `<script setup>`（Vue）或函数组件 + hooks（React）
2. 命名：文件名 kebab-case，变量/函数 camelCase，常量 UPPER_SNAKE_CASE，类型/接口 PascalCase
3. **原则上禁止 `any`**，确需使用必须注释说明原因
4. 样式使用 scoped + CSS 变量，禁止全局污染

## 三、交互完整性（AI 生成 UI 必须覆盖）

每一个交互元素必须定义全部状态：

| 状态 | 必须定义 |
|---|---|
| default | 默认视觉 |
| hover | 悬停反馈（过渡 0.2s） |
| active | 点击反馈 |
| disabled | 禁用视觉 + 阻止交互 |
| loading | 骨架屏或 loading 态 |
| empty | 空状态提示 |
| error | 错误提示 + 一键重试 |

**禁止**：只描述 default 状态；用"简约/高级/干净"等主观词代替具体数值（必须给色值、间距、圆角、字号）。

## 四、性能约束

1. 所有可点击事件必须防抖/防重复提交
2. 列表渲染必须使用 key，长列表考虑虚拟滚动
3. 图片必须懒加载 + 尺寸声明

## 五、开发行为

1. 每个组件完成后立即 `pnpm type-check && pnpm lint`
2. 新增功能必须同步编写单元测试
3. 涉及 UI 变更必须跑 `visual-verify`（浏览器实际验证，不能用"CDP 不可用"当过关理由）