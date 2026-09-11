---
description: "Go 后端开发通用规范"
globs: "**/*.go"
alwaysApply: true
---

# Go 后端开发规范

## 一、架构约束（硬性红线）

1. 严格遵循分层架构：`Controller → Service → Repository → Model`
2. 禁止在 Controller 层编写业务逻辑，Controller 只负责参数校验和响应封装
3. 所有数据库操作必须通过 Repository 层，禁止在 Service 中直接写 SQL
4. 所有对外 API 必须包含 Swagger 注解
5. Entity 不依赖框架（tRPC / gin 等），Logic 通过接口使用 Repo

## 二、代码风格

1. 函数/方法必须有 GoDoc 注释说明用途
2. 错误处理不允许使用 `_` 忽略，必须显式处理或向上传递
3. 变量命名 camelCase，常量 ALL_CAPS，导出方法 GoDoc 完整
4. **单个函数不超过 80 行**，超过则拆分
5. import 分组：标准库 / 第三方 / 本项目

## 三、并发与资源

1. goroutine 必须有明确的退出路径（context 或 done channel）
2. 所有 channel 使用必须有明确的关闭方
3. 共享状态用 mutex 或 channel 保护，禁止裸读写

## 四、开发行为

1. 每个逻辑单元完成后立即 `go build ./... && go vet ./...`
2. 新增功能必须同步编写单元测试
3. 涉及 DB 变更优先生成 SQL 变更脚本
4. commit 信息格式：`<type>(<scope>): <subject>`，中文不超过 50 字